import express from "express";
import { config } from "../lib/env.js";
import { generatePassword } from "../lib/crypto.js";
import { badRequest, forbidden, notFound, route } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { multipartBody } from "../lib/multipart.js";
import { countDocs, deleteAllDocs, listDocs } from "../lib/db.js";
import { assertBatchAccess, loadUser, requireAuth, requireFreshPassword, requirePermission } from "../middleware/auth.js";
import {
  ROLES,
  assertCanManage,
  can,
  createUser,
  deleteUser,
  findUserById,
  listUsers,
  normalizeBatchScope,
  publicUser,
  roleLevel,
  setPassword,
  updateUser,
  validateUsername
} from "../domain/users.js";
import {
  FOLLOW_UP_STATES,
  STATUSES,
  alumniSummary,
  alumniView,
  appendNameHistory,
  findAlumniById,
  listAlumni,
  listAllAlumni,
  normalizeText,
  parseBatch,
  parseBatchList,
  saveAlumni,
  syncSubmission,
  validateContacts,
  validateFollowUp
} from "../domain/alumni.js";
import {
  buildExportWorkbook,
  buildImportTemplate,
  importAlumniWorkbook,
  parseImportWorkbook,
  recordImportJob,
  writeImportRows
} from "../domain/excel.js";
import { generateSampleRows } from "../domain/sample-data.js";
import { deleteAllPhotos } from "../domain/photos.js";
import {
  buildDataMergeCsv,
  buildHandoffRows,
  buildHandoffWorkbook,
  buildReadme,
  handoffSummary,
  streamPhotoArchive
} from "../domain/handoff.js";
import { getSettings, updateSettings } from "../domain/settings.js";

const router = express.Router();

router.use(loadUser, requireAuth, requireFreshPassword);

/* ------------------------------- dashboard ------------------------------- */

router.get("/summary", requirePermission("alumni.read"), route(async (req, res) => {
  const summary = await alumniSummary();
  if (req.user.batchScope?.length) {
    summary.byBatch = summary.byBatch.filter((item) => req.user.batchScope.includes(item.batch));
  }
  const [userCount, lastImports] = await Promise.all([
    listUsers({ limit: 500 }).then((users) => users.length),
    listDocs(config.collections.importJobs, { orderBy: ["startedAt", "desc"], limit: 5 })
  ]);
  res.json({ ...summary, userCount, lastImports });
}));

/* ------------------------------ user accounts ---------------------------- */

router.get("/users", requirePermission("users.manage"), route(async (_req, res) => {
  const users = await listUsers({ limit: 500 });
  res.json({ users: users.map(publicUser), roles: Object.entries(ROLES).map(([name, meta]) => ({ name, ...meta })) });
}));

router.post("/users", requirePermission("users.manage"), route(async (req, res) => {
  const role = String(req.body?.role || "").trim();
  assertCanManage(req.user, role);

  const username = validateUsername(req.body?.username);
  const password = String(req.body?.password || "").trim() || generatePassword(14);
  const alumniId = String(req.body?.alumniId || "").trim() || null;

  if (role === "alumni") {
    if (!alumniId) throw badRequest("บัญชีนิสิตเก่าต้องระบุรหัสระเบียนนิสิตเก่า");
    const record = await findAlumniById(alumniId);
    if (!record) throw notFound("ไม่พบระเบียนนิสิตเก่าที่ระบุ");
  }

  const user = await createUser({
    username,
    password,
    displayName: req.body?.displayName,
    email: req.body?.email,
    role,
    batchScope: req.body?.batchScope,
    alumniId,
    mustChangePassword: req.body?.mustChangePassword !== false,
    createdBy: req.user.uid
  });

  await audit(req, "users.create", { targetType: "user", targetId: user.id, meta: { role, username } });
  // The generated password is returned exactly once and never stored in clear text.
  res.status(201).json({ user: publicUser(user), initialPassword: req.body?.password ? null : password });
}));

router.patch("/users/:uid", requirePermission("users.manage"), route(async (req, res) => {
  const target = await findUserById(req.params.uid);
  if (!target) throw notFound("ไม่พบบัญชีผู้ใช้");
  if (target.id === req.user.uid && req.body?.status === "suspended") throw badRequest("ไม่สามารถระงับบัญชีของตนเองได้");
  if (roleLevel(target.role) >= roleLevel(req.user.role) && target.id !== req.user.uid) throw forbidden("ไม่สามารถแก้ไขบัญชีที่มีสิทธิ์เท่ากันหรือสูงกว่า");

  const patch = {};
  if (req.body?.displayName !== undefined) patch.displayName = normalizeText(req.body.displayName);
  if (req.body?.email !== undefined) patch.email = String(req.body.email || "").trim().toLowerCase();
  if (req.body?.status !== undefined) {
    if (!["active", "suspended"].includes(req.body.status)) throw badRequest("สถานะบัญชีไม่ถูกต้อง");
    patch.status = req.body.status;
  }
  if (req.body?.batchScope !== undefined) patch.batchScope = normalizeBatchScope(req.body.batchScope);
  if (req.body?.role !== undefined && req.body.role !== target.role) {
    assertCanManage(req.user, req.body.role);
    patch.role = req.body.role;
    patch.tokenVersion = (target.tokenVersion || 1) + 1;
  }

  const updated = await updateUser(target.id, patch, req.user.uid);
  await audit(req, "users.update", { targetType: "user", targetId: target.id, meta: { fields: Object.keys(patch) } });
  res.json({ user: publicUser(updated) });
}));

router.post("/users/:uid/reset-password", requirePermission("users.manage"), route(async (req, res) => {
  const target = await findUserById(req.params.uid);
  if (!target) throw notFound("ไม่พบบัญชีผู้ใช้");
  if (roleLevel(target.role) >= roleLevel(req.user.role)) throw forbidden("ไม่สามารถรีเซ็ตรหัสผ่านของบัญชีที่มีสิทธิ์เท่ากันหรือสูงกว่า");

  const password = String(req.body?.password || "").trim() || generatePassword(14);
  await setPassword(target.id, password, { mustChangePassword: true, actorUid: req.user.uid });
  await audit(req, "users.resetPassword", { targetType: "user", targetId: target.id });
  res.json({ ok: true, temporaryPassword: req.body?.password ? null : password });
}));

router.delete("/users/:uid", requirePermission("users.manage"), route(async (req, res) => {
  const target = await findUserById(req.params.uid);
  if (!target) throw notFound("ไม่พบบัญชีผู้ใช้");
  if (target.id === req.user.uid) throw badRequest("ไม่สามารถลบบัญชีของตนเองได้");
  if (roleLevel(target.role) >= roleLevel(req.user.role)) throw forbidden("ไม่สามารถลบบัญชีที่มีสิทธิ์เท่ากันหรือสูงกว่า");
  await deleteUser(target.id);
  await audit(req, "users.delete", { targetType: "user", targetId: target.id, meta: { username: target.username } });
  res.json({ ok: true });
}));


/** Read a "45, 46" batch list from the query string and check the caller's scope. */
function requestedBatches(req) {
  const raw = req.query.batch ?? req.query.batches ?? "";
  if (!String(raw).trim()) return [];
  const batches = parseBatchList(raw);
  if (batches === null || !batches.length) throw badRequest(`ระบุรุ่นไม่ถูกต้อง — ใส่เป็นตัวเลข 1-${config.maxBatch} คั่นด้วยเครื่องหมายจุลภาค เช่น 45, 46`);
  if (batches.length > 88) throw badRequest("ระบุรุ่นได้สูงสุด 88 รุ่น");
  batches.forEach((batch) => assertBatchAccess(req.user, batch));
  return batches;
}

/* ------------------------------ alumni records --------------------------- */

router.get("/alumni", requirePermission("alumni.read"), route(async (req, res) => {
  const batches = requestedBatches(req);
  if (!batches.length && req.user.batchScope?.length) throw badRequest("กรุณาระบุรุ่นที่ต้องการดู");
  const status = STATUSES.includes(String(req.query.status)) ? String(req.query.status) : undefined;
  const page = await listAlumni({
    batches,
    status,
    query: req.query.q ? String(req.query.q) : undefined,
    limit: Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000),
    offset: Math.max(Number(req.query.offset) || 0, 0)
  });
  res.json({
    records: page.records.map(alumniView),
    total: page.total,
    offset: page.offset,
    limit: page.limit,
    searched: page.searched
  });
}));

router.get("/alumni/:id", requirePermission("alumni.read"), route(async (req, res) => {
  const record = await findAlumniById(req.params.id);
  if (!record) throw notFound("ไม่พบระเบียนนิสิตเก่า");
  assertBatchAccess(req.user, record.batch);
  res.json({ record: alumniView(record) });
}));

router.patch("/alumni/:id", requirePermission("alumni.write"), route(async (req, res) => {
  const record = await findAlumniById(req.params.id);
  if (!record) throw notFound("ไม่พบระเบียนนิสิตเก่า");
  assertBatchAccess(req.user, record.batch);

  const patch = { updatedBy: req.user.username };
  if (req.body?.currentFirstName !== undefined || req.body?.currentLastName !== undefined) {
    const firstName = normalizeText(req.body.currentFirstName ?? record.currentFirstName);
    const lastName = normalizeText(req.body.currentLastName ?? record.currentLastName);
    if (!firstName || !lastName) throw badRequest("ต้องระบุทั้งชื่อและนามสกุล");
    patch.nameHistory = appendNameHistory(record, firstName, lastName, req.user.username);
    patch.currentFirstName = firstName;
    patch.currentLastName = lastName;
  }
  if (req.body?.bio !== undefined) patch.bio = normalizeText(req.body.bio).slice(0, 500);
  if (req.body?.contacts !== undefined) patch.contacts = validateContacts(req.body.contacts);
  if (req.body?.status !== undefined) {
    if (!STATUSES.includes(req.body.status)) throw badRequest("สถานะไม่ถูกต้อง");
    patch.status = req.body.status;
  }
  if (req.body?.reviewNote !== undefined) patch.reviewNote = normalizeText(req.body.reviewNote).slice(0, 500);
  patch.reviewedBy = req.user.username;

  const updated = await saveAlumni(record.id, patch);
  await syncSubmission({ ...record, ...updated });
  await audit(req, "alumni.update", { targetType: "alumni", targetId: record.id, meta: { fields: Object.keys(patch) } });
  res.json({ record: alumniView(updated) });
}));

/**
 * Follow-up state — the batch representative's own record of the chase.
 *
 * Separate from `PATCH /alumni/:id` on purpose: a representative may record
 * that someone has passed away or cannot be reached, but must not be able to
 * mark a submission as confirmed on that person's behalf.
 */
router.patch("/alumni/:id/follow-up", requirePermission("alumni.followUp"), route(async (req, res) => {
  const record = await findAlumniById(req.params.id);
  if (!record) throw notFound("ไม่พบระเบียนนิสิตเก่า");
  assertBatchAccess(req.user, record.batch);

  const followUp = validateFollowUp(String(req.body?.state || ""), req.body?.note, req.user);
  const updated = await saveAlumni(record.id, { followUp });
  await syncSubmission({ ...record, ...updated });
  await audit(req, "alumni.followUp", { targetType: "alumni", targetId: record.id, meta: { state: followUp.state } });
  res.json({ record: alumniView(updated) });
}));

router.get("/follow-up/states", requirePermission("alumni.followUp"), route(async (_req, res) => {
  res.json({ states: Object.entries(FOLLOW_UP_STATES).map(([key, meta]) => ({ key, ...meta })) });
}));

/* -------------------------------- import --------------------------------- */

/**
 * Blank template for entering real data, and the same template pre-filled with
 * synthetic rows so an administrator can rehearse the whole import at scale.
 */
router.get("/import/template.xlsx", requirePermission("alumni.import"), route(async (req, res) => {
  const requested = Number(req.query.rows) || 0;
  const rows = requested > 0 ? generateSampleRows(Math.min(requested, 20000)) : [];
  const filename = rows.length ? `alumni-sample-${rows.length}.xlsx` : "alumni-import-template.xlsx";
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(Buffer.from(await buildImportTemplate({ rows })));
}));

router.post("/import", requirePermission("alumni.import"), multipartBody({ maxFiles: 1 }), route(async (req, res) => {
  const file = req.files?.file;
  if (!file?.buffer?.length) throw badRequest("ไม่พบไฟล์ Excel ที่อัปโหลด");
  const job = await importAlumniWorkbook({
    buffer: file.buffer,
    filename: file.filename,
    actor: req.user,
    dryRun: String(req.body?.dryRun) === "true"
  });
  await audit(req, job.dryRun ? "alumni.import.preview" : "alumni.import", {
    targetType: "importJob",
    targetId: job.jobId,
    meta: { totalRows: job.totalRows, inserted: job.inserted, updated: job.updated, skipped: job.skipped }
  });
  res.json({ job });
}));

/* ---- chunked import: lets the console show a real progress bar ---- */

/** Step 1 — parse and validate the file. Writes nothing. */
router.post("/import/prepare", requirePermission("alumni.import"), multipartBody({ maxFiles: 1 }), route(async (req, res) => {
  const file = req.files?.file;
  if (!file?.buffer?.length) throw badRequest("ไม่พบไฟล์ Excel ที่อัปโหลด");
  const parsed = await parseImportWorkbook({ buffer: file.buffer, filename: file.filename });
  await audit(req, "alumni.import.prepare", {
    targetType: "importJob",
    targetId: parsed.jobId,
    meta: { totalRows: parsed.totalRows, validRows: parsed.validRows, skipped: parsed.skipped }
  });
  res.json({ job: parsed });
}));

/** Step 2 — write one slice. Called repeatedly; each call reports its own counts. */
router.post("/import/chunk", requirePermission("alumni.import"), route(async (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  if (!entries.length) throw badRequest("ไม่พบข้อมูลที่จะบันทึก");
  if (entries.length > 1000) throw badRequest("ส่งข้อมูลได้ครั้งละไม่เกิน 1,000 แถว");
  const result = await writeImportRows({
    entries,
    actor: req.user,
    jobId: String(req.body?.jobId || "").slice(0, 64),
    filename: String(req.body?.filename || "").slice(0, 200)
  });
  res.json(result);
}));

/** Step 3 — record the finished job so it shows in the import history. */
router.post("/import/commit", requirePermission("alumni.import"), route(async (req, res) => {
  const body = req.body || {};
  const job = await recordImportJob({
    jobId: String(body.jobId || "").slice(0, 64),
    filename: String(body.filename || "").slice(0, 200),
    headers: Array.isArray(body.headers) ? body.headers.slice(0, 50) : [],
    dryRun: false,
    startedAt: String(body.startedAt || new Date().toISOString()),
    finishedAt: new Date().toISOString(),
    status: body.status === "failed" ? "failed" : "completed",
    uploadedBy: req.user.uid,
    uploadedByUsername: req.user.username,
    totalRows: Number(body.totalRows) || 0,
    validRows: Number(body.validRows) || 0,
    inserted: Number(body.inserted) || 0,
    updated: Number(body.updated) || 0,
    duplicateRows: Number(body.duplicateRows) || 0,
    skipped: Number(body.skipped) || 0,
    errors: Array.isArray(body.errors) ? body.errors.slice(0, 200) : []
  });
  await audit(req, "alumni.import", {
    targetType: "importJob",
    targetId: job.jobId,
    meta: { totalRows: job.totalRows, inserted: job.inserted, updated: job.updated, skipped: job.skipped, status: job.status }
  });
  res.json({ job });
}));

router.get("/import/jobs", requirePermission("alumni.import"), route(async (_req, res) => {
  const jobs = await listDocs(config.collections.importJobs, { orderBy: ["startedAt", "desc"], limit: 25 });
  res.json({ jobs });
}));

/* -------------------------------- export --------------------------------- */

router.get("/export.xlsx", requirePermission("alumni.export"), route(async (req, res) => {
  const batches = requestedBatches(req);
  // Follow-up contact details are opt-in and limited to owner/admin, so the
  // default download stays safe to hand to the design team.
  const includeOutreach = String(req.query.includeOutreach) === "true";
  if (includeOutreach && !can(req.user, "alumni.write")) throw forbidden("ไม่มีสิทธิ์ส่งออกข้อมูลติดต่อสำหรับติดตาม");

  const records = await listAllAlumni({ batches, status: STATUSES.includes(String(req.query.status)) ? String(req.query.status) : undefined });
  await audit(req, "alumni.export", { meta: { count: records.length, batches: batches.length ? batches : "all", includeOutreach } });
  const suffix = batches.length === 1 ? `-batch-${batches[0]}` : batches.length ? `-${batches.length}batches` : "";
  res.setHeader("Content-Disposition", `attachment; filename=yearbook-2569${suffix}${includeOutreach ? "-followup" : ""}.xlsx`);
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(Buffer.from(await buildExportWorkbook(records, { includeOutreach })));
}));

/* --------------------- handoff package for the design team ---------------- */

/**
 * Only records the alumnus actually confirmed go to the design team — a
 * "pending" record has no consent behind it and must never be laid out.
 */
async function handoffRowsFor(req) {
  const batches = requestedBatches(req);
  const records = await listAllAlumni({ batches, status: "submitted" });
  return { batches, rows: buildHandoffRows(records) };
}

router.get("/handoff/summary", requirePermission("alumni.export"), route(async (req, res) => {
  const { batches, rows } = await handoffRowsFor(req);
  res.json({ batches, ...handoffSummary(rows) });
}));

router.get("/handoff/data.xlsx", requirePermission("alumni.export"), route(async (req, res) => {
  const { batches, rows } = await handoffRowsFor(req);
  if (!rows.length) throw badRequest("ยังไม่มีข้อมูลที่ยืนยันแล้วสำหรับส่งมอบ");
  await audit(req, "handoff.data", { meta: { count: rows.length, batches: batches.length ? batches : "all" } });
  res.setHeader("Content-Disposition", "attachment; filename=yearbook-2569-handoff.xlsx");
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .send(Buffer.from(await buildHandoffWorkbook(rows, { generatedBy: req.user.username, generatedAt: new Date().toISOString() })));
}));

router.get("/handoff/data-merge.csv", requirePermission("alumni.export"), route(async (req, res) => {
  const { batches, rows } = await handoffRowsFor(req);
  if (!rows.length) throw badRequest("ยังไม่มีข้อมูลที่ยืนยันแล้วสำหรับส่งมอบ");
  await audit(req, "handoff.csv", { meta: { count: rows.length, batches: batches.length ? batches : "all" } });
  res.setHeader("Content-Disposition", "attachment; filename=data-merge.csv");
  res.type("text/csv; charset=utf-8").send(buildDataMergeCsv(rows));
}));

router.get("/handoff/readme.txt", requirePermission("alumni.export"), route(async (req, res) => {
  const { batches, rows } = await handoffRowsFor(req);
  res.setHeader("Content-Disposition", "attachment; filename=readme.txt");
  res.type("text/plain; charset=utf-8").send(buildReadme(rows, { generatedBy: req.user.username, generatedAt: new Date().toISOString(), batches }));
}));

/**
 * Photos for one batch, streamed as a ZIP.
 *
 * One batch at a time on purpose: a full 10,000-portrait archive is several
 * gigabytes, which no single HTTP response should carry. Per batch it is tens
 * of megabytes, resumable by simply clicking again, and matches how a designer
 * works through the book anyway.
 */
router.get("/handoff/photos.zip", requirePermission("alumni.export"), route(async (req, res) => {
  const batch = parseBatch(req.query.batch);
  if (batch === null) throw badRequest("กรุณาระบุรุ่นที่ต้องการดาวน์โหลดรูป ครั้งละหนึ่งรุ่น");
  assertBatchAccess(req.user, batch);

  const records = await listAllAlumni({ batches: [batch], status: "submitted" });
  const rows = buildHandoffRows(records);
  const withPhotos = rows.filter((row) => row.hasPhoto);
  if (!withPhotos.length) throw badRequest(`รุ่น ${batch} ยังไม่มีรูปถ่ายที่ส่งเข้ามา`);

  await audit(req, "handoff.photos", { meta: { batch, photos: withPhotos.length } });
  res.setHeader("Content-Disposition", `attachment; filename=yearbook-2569-photos-batch-${batch}.zip`);
  res.type("application/zip");
  await streamPhotoArchive(res, rows, { batch, generatedBy: req.user.username, generatedAt: new Date().toISOString() });
}));

/* ------------------------------- settings -------------------------------- */

router.get("/settings", requirePermission("settings.manage"), route(async (_req, res) => {
  res.json({ settings: await getSettings() });
}));

router.put("/settings", requirePermission("settings.manage"), route(async (req, res) => {
  const settings = await updateSettings(req.body || {}, req.user);
  await audit(req, "settings.update", { meta: { fields: Object.keys(req.body || {}) } });
  res.json({ settings });
}));

/* ----------------------------- danger zone ------------------------------- */

const RESET_PHRASE = "ล้างข้อมูลทั้งหมด";

/**
 * Wipe every alumni record, submission, import job and stored photo so the
 * association can start the real round with a clean database after testing.
 *
 * Deliberately preserved: user accounts, system settings, and the audit log —
 * the record that this wipe happened must survive the wipe.
 */
router.post("/reset", requirePermission("data.reset"), route(async (req, res) => {
  if (String(req.body?.confirm || "").trim() !== RESET_PHRASE) {
    throw badRequest(`เพื่อยืนยัน กรุณาพิมพ์ข้อความ "${RESET_PHRASE}" ให้ตรงทุกตัวอักษร`);
  }

  const before = await countDocs(config.collections.alumni);
  const [alumni, submissions, importJobs, photos] = [
    await deleteAllDocs(config.collections.alumni),
    await deleteAllDocs(config.collections.submissions),
    await deleteAllDocs(config.collections.importJobs),
    await deleteAllPhotos()
  ];

  await audit(req, "data.reset", { meta: { alumni, submissions, importJobs, photos, before } });
  res.json({ ok: true, deleted: { alumni, submissions, importJobs, photos } });
}));

/* ------------------------------- audit log ------------------------------- */

router.get("/audit", requirePermission("audit.read"), route(async (req, res) => {
  const logs = await listDocs(config.collections.auditLogs, {
    where: req.query.action ? [["action", "==", String(req.query.action)]] : [],
    orderBy: ["at", "desc"],
    limit: Math.min(Number(req.query.limit) || 100, 500)
  });
  res.json({ logs });
}));

export default router;
