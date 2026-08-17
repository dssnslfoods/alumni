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
  parseBatch,
  saveAlumni,
  searchAlumni,
  searchResult,
  selfView,
  syncSubmission,
  validateContacts,
  verifyIdCard
} from "../domain/alumni.js";
import { deletePhoto, normalizePhoto, storePhoto } from "../domain/photos.js";
import { loadUser } from "../middleware/auth.js";

const router = express.Router();
const searchLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 200 });

/**
 * The attack worth stopping is guessing one person's 5 digits, so the tight
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

router.post("/search", route(async (req, res) => {
  if (!searchLimiter(clientIp(req))) throw tooMany("ค้นหาถี่เกินไป กรุณารอสักครู่");
  const batch = parseBatch(req.body?.batch);
  if (batch === null) throw badRequest(`กรุณาระบุรุ่นเป็นตัวเลข 1-${effectiveMaxBatch()}`);
  const matches = await searchAlumni(batch, req.body?.query);
  res.json({ matches: matches.map(searchResult) });
}));

router.post("/verify", route(async (req, res) => {
  const alumniId = String(req.body?.alumniId || "").slice(0, 64);
  if (!verifyPerRecordLimiter(`rec:${alumniId}`)) throw tooMany("ยืนยันตัวตนของรายชื่อนี้หลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่");
  if (!verifyPerIpLimiter(clientIp(req))) throw tooMany("มีการยืนยันตัวตนจำนวนมากจากเครือข่ายนี้ กรุณารอสักครู่แล้วลองใหม่");
  const record = await findAlumniById(alumniId);
  if (!record || !verifyIdCard(record, req.body?.idCardLast5)) {
    await audit(req, "public.verify.failed", { targetType: "alumni", targetId: alumniId });
    throw notFound("ข้อมูลยืนยันตัวตนไม่ตรงกับฐานข้อมูลอ้างอิง");
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
    contacts: [],
    pdpa: { consent: false, consentAt: "", version: settings.pdpaVersion, withdrawnAt: now },
    submittedAt: "",
    updatedBy: "self"
  };

  await saveAlumni(record.id, patch);
  await syncSubmission({ ...record, ...patch });
  await audit(req, "public.decline", { targetType: "alumni", targetId: record.id, meta: { hadSubmitted } });
  res.json({ ok: true, hadSubmitted });
}));

router.post("/submit", multipartBody({ maxFiles: 1 }), route(async (req, res) => {
  if (!submitLimiter(clientIp(req))) throw tooMany();
  const settings = await getSettings();
  if (!settings.submissionOpen) throw forbidden(settings.closedMessage);

  const record = await recordFromSubmitToken(req);
  const firstName = normalizeText(req.body?.currentFirstName);
  const lastName = normalizeText(req.body?.currentLastName);
  const bio = normalizeText(req.body?.bio);
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
  const patch = {
    currentFirstName: firstName,
    currentLastName: lastName,
    nameHistory: appendNameHistory(record, firstName, lastName, "self"),
    bio,
    contacts,
    photo,
    status: "submitted",
    pdpa: { consent: true, consentAt: now, version: settings.pdpaVersion },
    submittedAt: now,
    updatedBy: "self"
  };

  await saveAlumni(record.id, patch);
  await syncSubmission({ ...record, ...patch });
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
