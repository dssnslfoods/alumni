import express from "express";
import { config } from "../lib/env.js";
import { signToken, verifyToken } from "../lib/crypto.js";
import { badRequest, clientIp, createRateLimiter, forbidden, notFound, route, tooMany, unauthorized } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { multipartBody } from "../lib/multipart.js";
import { effectiveMaxBatch, getSettings } from "../domain/settings.js";
import {
  appendNameHistory,
  findAlumniById,
  normalizeText,
  searchKey,
  parseBatch,
  bumpPublicStats,
  publicStats,
  saveAlumni,
  searchAlumni,
  searchResult,
  selfView,
  syncSubmission,
  validateContacts
} from "../domain/alumni.js";
import { deletePhoto, normalizePhoto, storePhoto } from "../domain/photos.js";
import { findRepresentatives } from "../domain/users.js";
import { loadUser } from "../middleware/auth.js";

const router = express.Router();
const searchLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 200 });

/**
 * The attack worth stopping is guessing one person's 7-digit code, so the tight
 * limit is per alumni record. Thai mobile networks put thousands of people
 * behind one CGNAT address, so a strict per-IP cap would lock out whole
 * groups of legitimate alumni — the per-IP limit stays deliberately loose and
 * only exists to stop mass scanning.
 */
const verifyPerRecordLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 8 });
const verifyPerIpLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 120 });
const submitLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 200 });

const SUBMIT_TOKEN_MINUTES = 30;

/**
 * After a successful identity check the browser holds a short-lived token
 * scoped to one alumni record, so the ID-card digits are sent exactly once.
 */
function issueSubmitToken(alumniId) {
  return signToken({ sub: alumniId, typ: "submit" }, { expiresInSeconds: SUBMIT_TOKEN_MINUTES * 60 });
}

async function recordFromSubmitToken(req) {
  const token = String(req.headers["x-submit-token"] || req.body?.submitToken || "");
  const payload = verifyToken(token);
  if (!payload || payload.typ !== "submit") throw unauthorized("การยืนยันตัวตนหมดอายุ กรุณายืนยันตัวตนใหม่อีกครั้ง");
  const record = await findAlumniById(payload.sub);
  if (!record) throw notFound("ไม่พบข้อมูลนิสิตเก่า");
  return record;
}

router.get("/settings", route(async (_req, res) => {
  const settings = await getSettings();
  res.json({
    submissionOpen: settings.submissionOpen,
    closedMessage: settings.closedMessage,
    maxBatch: settings.maxBatch,
    bookTitle: settings.bookTitle,
    bioMaxLength: settings.bioMaxLength,
    pdpaVersion: settings.pdpaVersion
  });
}));

/** Aggregate counts for the welcome-page ticker. No personal data, cached server-side. */
router.get("/stats", route(async (_req, res) => {
  // Short enough that the page ticker sees new numbers within a minute.
  res.set("Cache-Control", "public, max-age=30");
  res.json(await publicStats());
}));

router.post("/search", route(async (req, res) => {
  if (!searchLimiter(clientIp(req))) throw tooMany("ค้นหาถี่เกินไป กรุณารอสักครู่");
  const batch = req.body?.batch ? parseBatch(req.body.batch) : null;
  const matches = await searchAlumni(batch, req.body?.query);
  res.json({ matches: matches.map(searchResult) });
}));

/**
 * Who to contact for a given batch.
 *
 * Exists so that closing submissions is not a dead end: an alumnus who arrives
 * late types their batch and gets a real person to call. Only the name and the
 * contact number the representative agreed to publish are returned — never the
 * account, the email, or anything about other batches.
 */
router.get("/representatives", route(async (req, res) => {
  if (!searchLimiter(clientIp(req))) throw tooMany("ค้นหาถี่เกินไป กรุณารอสักครู่");
  const batch = parseBatch(req.query.batch);
  if (batch === null) throw badRequest(`กรุณาระบุรุ่นเป็นตัวเลข 1-${effectiveMaxBatch()}`);

  const staff = await findRepresentatives(batch);
  const linked = await Promise.all(staff.map((user) => (user.alumniId ? findAlumniById(user.alumniId) : null)));

  const representatives = staff.map((user, index) => {
    const record = linked[index];
    return {
      // Prefer the name from the alumni register — that is the name their
      // batch actually knows them by.
      name: record
        ? `${record.currentFirstName || record.legalFirstName} ${record.currentLastName || record.legalLastName}`.trim()
        : user.displayName || user.username,
      formerName: record && record.legalLastName !== record.currentLastName
        ? `${record.legalFirstName} ${record.legalLastName}`
        : "",
      phone: user.phone || ""
    };
  });

  res.json({ batch, representatives });
}));

router.post("/verify", route(async (req, res) => {
  const alumniId = String(req.body?.alumniId || "").slice(0, 64);
  if (!verifyPerRecordLimiter(`rec:${alumniId}`)) throw tooMany("ยืนยันตัวตนของรายชื่อนี้หลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่");
  if (!verifyPerIpLimiter(clientIp(req))) throw tooMany("มีการยืนยันตัวตนจำนวนมากจากเครือข่ายนี้ กรุณารอสักครู่แล้วลองใหม่");
  const record = await findAlumniById(alumniId);
  if (!record) {
    await audit(req, "public.verify.failed", { targetType: "alumni", targetId: alumniId });
    throw notFound("ไม่พบรายชื่อนี้ในฐานข้อมูล");
  }
  const code = String(req.body?.verificationCode || "").trim();
  if (!code) throw badRequest("กรุณาระบุรหัสยืนยันตัวตน");
  if (code !== record.verificationCode) {
    await audit(req, "public.verify.failed", { targetType: "alumni", targetId: alumniId, meta: { code: code.slice(0, 10) } });
    throw badRequest("รหัสยืนยันตัวตนไม่ถูกต้อง");
  }
  await audit(req, "public.verify.success", { targetType: "alumni", targetId: record.id });
  res.json({ submitToken: issueSubmitToken(record.id), expiresInMinutes: SUBMIT_TOKEN_MINUTES, alum: selfView(record) });
}));

/** A signed-in alumni account can edit its record without re-entering the ID digits. */
router.post("/my-record", loadUser, route(async (req, res) => {
  if (!req.user?.alumniId) throw forbidden("บัญชีนี้ไม่ได้ผูกกับข้อมูลนิสิตเก่า");
  const record = await findAlumniById(req.user.alumniId);
  if (!record) throw notFound("ไม่พบข้อมูลนิสิตเก่าที่ผูกกับบัญชีนี้");
  res.json({ submitToken: issueSubmitToken(record.id), expiresInMinutes: SUBMIT_TOKEN_MINUTES, alum: selfView(record) });
}));

/**
 * Decline to appear in the book.
 *
 * This is also the consent-withdrawal path: someone who already submitted and
 * later changes their mind must not be left with a photo and contact details
 * sitting in the export. The roster entry stays (it is the association's own
 * record) but everything that would have been printed is removed.
 */
router.post("/decline", route(async (req, res) => {
  const record = await recordFromSubmitToken(req);
  const settings = await getSettings();
  const hadSubmitted = record.status === "submitted";

  if (record.photo?.storagePath) await deletePhoto(record.photo);

  const now = new Date().toISOString();
  const patch = {
    status: "declined",
    declinedAt: now,
    photo: null,
    bio: "",
    wasFaculty: false,
    facultyTitle: "",
    contacts: [],
    pdpa: { consent: false, consentAt: "", version: settings.pdpaVersion, withdrawnAt: now },
    submittedAt: "",
    updatedBy: "self"
  };

  await saveAlumni(record.id, patch);
  await syncSubmission({ ...record, ...patch });
  if (hadSubmitted) bumpPublicStats(record.batch, -1);
  await audit(req, "public.decline", { targetType: "alumni", targetId: record.id, meta: { hadSubmitted } });
  res.json({ ok: true, hadSubmitted });
}));

router.post("/draft", multipartBody({ maxFiles: 1 }), route(async (req, res) => {
  if (!submitLimiter(clientIp(req))) throw tooMany();
  const record = await recordFromSubmitToken(req);

  const wasFaculty = String(req.body?.wasFaculty) === "yes";
  const entryYearRaw = normalizeText(req.body?.entryYear);
  const entryYear = entryYearRaw === "unknown" ? "unknown" : (parseInt(entryYearRaw, 10) || "");
  const outstandingAlumni = String(req.body?.outstandingAlumni) === "yes";
  const outstandingYearRaw = normalizeText(req.body?.outstandingYear);
  const outstandingYear = outstandingAlumni
    ? (outstandingYearRaw === "n/a" ? "n/a" : (parseInt(outstandingYearRaw, 10) || ""))
    : "";

  const facultyTitle = wasFaculty ? normalizeText(req.body?.facultyTitle) : "";

  const patch = {
    wasFaculty,
    facultyTitle,
    entryYear,
    outstandingAlumni,
    outstandingYear,
    draftAt: new Date().toISOString(),
    updatedBy: "self"
  };

  const firstName = normalizeText(req.body?.currentFirstName);
  const lastName = normalizeText(req.body?.currentLastName);
  if (firstName) patch.currentFirstName = firstName;
  if (lastName) patch.currentLastName = lastName;

  const newLegalFirst = normalizeText(req.body?.legalFirstName);
  const newLegalLast = normalizeText(req.body?.legalLastName);
  if (newLegalFirst && newLegalLast) {
    const legalChanged = searchKey(newLegalFirst) !== searchKey(record.legalFirstName)
      || searchKey(newLegalLast) !== searchKey(record.legalLastName);
    if (legalChanged) {
      if (!record.importedFirstName) {
        patch.importedFirstName = record.legalFirstName;
        patch.importedLastName = record.legalLastName;
      }
      patch.legalFirstName = newLegalFirst;
      patch.legalLastName = newLegalLast;
      patch.searchFirst = searchKey(newLegalFirst);
      patch.searchLast = searchKey(newLegalLast);
      patch.searchFull = `${searchKey(newLegalFirst)}${searchKey(newLegalLast)}`;
    }
  }

  let contacts;
  try {
    contacts = validateContacts(typeof req.body?.contacts === "string" ? JSON.parse(req.body.contacts || "[]") : req.body?.contacts);
    if (contacts.length) patch.contacts = contacts;
  } catch { /* ignore invalid contacts in draft */ }

  const photoChoice = req.body?.photoChoice;
  const uploaded = req.files?.photo;
  if (photoChoice === "placeholder") {
    if (record.photo?.storagePath) await deletePhoto(record.photo);
    patch.photo = { choice: "placeholder", updatedAt: new Date().toISOString() };
  } else if (uploaded) {
    const previous = record.photo;
    patch.photo = await storePhoto(
      { ...record, currentFirstName: firstName || record.currentFirstName, currentLastName: lastName || record.currentLastName },
      await normalizePhoto(uploaded)
    );
    if (previous?.storagePath) await deletePhoto(previous);
  }

  await saveAlumni(record.id, patch);
  await audit(req, "public.draft", { targetType: "alumni", targetId: record.id });
  res.json({ ok: true });
}));

router.post("/submit", multipartBody({ maxFiles: 1 }), route(async (req, res) => {
  if (!submitLimiter(clientIp(req))) throw tooMany();
  const settings = await getSettings();
  if (!settings.submissionOpen) throw forbidden(settings.closedMessage);

  const record = await recordFromSubmitToken(req);
  const firstName = normalizeText(req.body?.currentFirstName);
  const lastName = normalizeText(req.body?.currentLastName);
  const newLegalFirst = normalizeText(req.body?.legalFirstName);
  const newLegalLast = normalizeText(req.body?.legalLastName);
  const bio = normalizeText(req.body?.bio);
  const wasFaculty = String(req.body?.wasFaculty) === "yes";
  const facultyTitle = wasFaculty ? normalizeText(req.body?.facultyTitle) : "";
  const entryYearRaw = normalizeText(req.body?.entryYear);
  const entryYear = entryYearRaw === "unknown" ? "unknown" : (parseInt(entryYearRaw, 10) || "");
  const outstandingAlumni = String(req.body?.outstandingAlumni) === "yes";
  const outstandingYearRaw = normalizeText(req.body?.outstandingYear);
  const outstandingYear = outstandingAlumni
    ? (outstandingYearRaw === "n/a" ? "n/a" : (parseInt(outstandingYearRaw, 10) || ""))
    : "";
  const photoChoice = req.body?.photoChoice === "placeholder" ? "placeholder" : "upload";
  const uploaded = req.files?.photo;

  let contacts;
  try {
    contacts = validateContacts(typeof req.body?.contacts === "string" ? JSON.parse(req.body.contacts || "[]") : req.body?.contacts);
  } catch (error) {
    throw error.status ? error : badRequest("ข้อมูลช่องทางติดต่อไม่ถูกต้อง");
  }

  if (!firstName || !lastName) throw badRequest("กรุณาระบุชื่อและนามสกุลที่จะใช้ในหนังสือ");
  if (firstName.length > 80 || lastName.length > 80) throw badRequest("ชื่อหรือนามสกุลยาวเกินไป");
  if (bio.length > settings.bioMaxLength) throw badRequest(`ประวัติโดยย่อต้องไม่เกิน ${settings.bioMaxLength} ตัวอักษร`);
  if (String(req.body?.pdpaConsent) !== "yes") throw badRequest("ต้องได้รับความยินยอม PDPA ก่อนบันทึกข้อมูล");
  if (photoChoice === "upload" && !uploaded && !record.photo?.storagePath) throw badRequest("กรุณาอัปโหลดรูปภาพ หรือเลือกไม่แสดงรูป");

  let photo = record.photo || null;
  if (photoChoice === "placeholder") {
    if (record.photo) await deletePhoto(record.photo);
    photo = { choice: "placeholder", updatedAt: new Date().toISOString() };
  } else if (uploaded) {
    const previous = record.photo;
    photo = await storePhoto({ ...record, currentFirstName: firstName, currentLastName: lastName }, await normalizePhoto(uploaded));
    if (previous?.storagePath) await deletePhoto(previous);
  }

  const now = new Date().toISOString();
  const legalChanged = newLegalFirst && newLegalLast
    && (searchKey(newLegalFirst) !== searchKey(record.legalFirstName)
      || searchKey(newLegalLast) !== searchKey(record.legalLastName));

  const patch = {
    currentFirstName: firstName,
    currentLastName: lastName,
    nameHistory: legalChanged ? (record.nameHistory || []) : appendNameHistory(record, firstName, lastName, "self"),
    bio,
    wasFaculty,
    facultyTitle,
    entryYear,
    outstandingAlumni,
    outstandingYear,
    contacts,
    photo,
    status: "submitted",
    pdpa: { consent: true, consentAt: now, version: settings.pdpaVersion },
    submittedAt: now,
    updatedBy: "self"
  };

  if (legalChanged) {
    if (!record.importedFirstName) {
      patch.importedFirstName = record.legalFirstName;
      patch.importedLastName = record.legalLastName;
    }
    patch.legalFirstName = newLegalFirst;
    patch.legalLastName = newLegalLast;
    patch.searchFirst = searchKey(newLegalFirst);
    patch.searchLast = searchKey(newLegalLast);
    patch.searchFull = `${searchKey(newLegalFirst)}${searchKey(newLegalLast)}`;
  }

  await saveAlumni(record.id, patch);
  await syncSubmission({ ...record, ...patch });
  if (record.status !== "submitted") bumpPublicStats(record.batch, 1);
  await audit(req, "public.submit", { targetType: "alumni", targetId: record.id, meta: { photoChoice, contactTypes: contacts.map((item) => item.type) } });
  res.json({
    ok: true,
    photoUrl: photo?.downloadUrl || "",
    // Sent back so the browser can show what the optimiser actually produced.
    photo: photo?.choice === "upload"
      ? { width: photo.width, height: photo.height, bytes: photo.bytes, print: photo.print || null }
      : null
  });
}));

export default router;
