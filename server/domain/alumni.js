import crypto from "node:crypto";
import { config } from "../lib/env.js";
import { countDocs, getDoc, listDocs, setDoc, updateDoc } from "../lib/db.js";
import { hashIdCardLast5 } from "../lib/crypto.js";
import { badRequest } from "../lib/http.js";

const { alumni: ALUMNI, submissions: SUBMISSIONS } = config.collections;

export const CONTACT_TYPES = ["facebook", "instagram", "line", "phone"];
export const STATUSES = ["pending", "submitted", "declined"];

export function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/** Search key: lower-cased, whitespace removed, Unicode-normalized. */
export function searchKey(value) {
  return normalizeText(value).normalize("NFC").toLocaleLowerCase("th-TH").replace(/\s+/g, "");
}

export function onlyDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function parseBatch(value) {
  const batch = Number(onlyDigits(value));
  if (!Number.isInteger(batch) || batch < 1 || batch > config.maxBatch) return null;
  return batch;
}

/** Stable document id so re-importing the same sheet updates instead of duplicating. */
export function alumniId({ studentId, batch, firstName, lastName }) {
  const student = onlyDigits(studentId);
  if (student) return `s-${student}`;
  const fingerprint = crypto.createHash("sha1").update(`${batch}|${searchKey(firstName)}|${searchKey(lastName)}`).digest("hex").slice(0, 16);
  return `n-${fingerprint}`;
}

/** Reference fields owned by the imported master list. */
export function referenceFields({ studentId, batch, firstName, lastName, idCardLast5, title = "", outreachEmail = "", outreachPhone = "", note = "" }) {
  const first = normalizeText(firstName);
  const last = normalizeText(lastName);
  return {
    studentId: onlyDigits(studentId),
    batch,
    title: normalizeText(title),
    legalFirstName: first,
    legalLastName: last,
    searchFirst: searchKey(first),
    searchLast: searchKey(last),
    searchFull: `${searchKey(first)}${searchKey(last)}`,
    idCardLast5Hash: hashIdCardLast5(idCardLast5),
    // ช่องทางสำหรับผู้ดูแล "ตามงาน" เท่านั้น — คนละส่วนกับ contacts ที่เจ้าตัวยินยอมให้ลงหนังสือ
    outreach: { email: normalizeText(outreachEmail).toLowerCase(), phone: onlyDigits(outreachPhone), note: normalizeText(note) }
  };
}

/** Yearbook fields owned by the alumnus. Only applied when creating a new record. */
export function defaultSubmissionFields({ firstName, lastName }) {
  return {
    currentFirstName: normalizeText(firstName),
    currentLastName: normalizeText(lastName),
    nameHistory: [],
    status: "pending",
    photo: null,
    contacts: [],
    bio: "",
    pdpa: { consent: false, consentAt: "", version: "" },
    submittedAt: "",
    reviewedBy: "",
    reviewNote: ""
  };
}

export async function findAlumniById(id) {
  return getDoc(ALUMNI, id);
}

export function verifyIdCard(record, idCardLast5) {
  const digits = onlyDigits(idCardLast5);
  if (digits.length !== 5 || !record?.idCardLast5Hash) return false;
  return hashIdCardLast5(digits) === record.idCardLast5Hash;
}

/**
 * Batch-scoped name search. Uses Firestore range queries for prefix matches
 * (indexed, cheap at 10,000+ records) and falls back to an in-batch substring
 * scan so that searching by the middle of a name still works.
 */
export async function searchAlumni(batch, rawQuery, { limit = 10 } = {}) {
  const query = searchKey(rawQuery);
  if (query.length < 2) throw badRequest("กรุณากรอกชื่อหรือนามสกุลอย่างน้อย 2 ตัวอักษร");

  const prefixEnd = `${query}\uf8ff`;
  const [byFirst, byLast] = await Promise.all([
    listDocs(ALUMNI, { where: [["batch", "==", batch], ["searchFirst", ">=", query], ["searchFirst", "<=", prefixEnd]], orderBy: ["searchFirst"], limit: limit * 2 }),
    listDocs(ALUMNI, { where: [["batch", "==", batch], ["searchLast", ">=", query], ["searchLast", "<=", prefixEnd]], orderBy: ["searchLast"], limit: limit * 2 })
  ]);

  const found = new Map();
  [...byFirst, ...byLast].forEach((record) => found.set(record.id, record));

  if (found.size < limit) {
    const inBatch = await listDocs(ALUMNI, { where: [["batch", "==", batch]], limit: 1000 });
    inBatch
      .filter((record) => `${record.searchFirst}${record.searchLast}`.includes(query))
      .forEach((record) => found.set(record.id, record));
  }

  return [...found.values()].slice(0, limit);
}

/** Public search result — no ID-card material, no contact details. */
export function searchResult(record) {
  return {
    id: record.id,
    firstName: record.legalFirstName,
    lastName: record.legalLastName,
    batch: record.batch,
    studentId: record.studentId ? `${record.studentId.slice(0, 2)}xxxx${record.studentId.slice(-1)}` : "",
    alreadySubmitted: record.status === "submitted"
  };
}

/** Full record for an administrator. */
export function alumniView(record) {
  if (!record) return null;
  const { idCardLast5Hash: _hash, ...safe } = record;
  return safe;
}

/**
 * What the alumnus sees about themselves after verifying. Internal
 * administrative fields — outreach contacts, review notes, import provenance —
 * stay out of the public API surface entirely.
 */
export function selfView(record) {
  if (!record) return null;
  const {
    idCardLast5Hash: _hash,
    outreach: _outreach,
    source: _source,
    reviewNote: _reviewNote,
    reviewedBy: _reviewedBy,
    updatedBy: _updatedBy,
    ...safe
  } = record;
  return safe;
}

export function validateContacts(input) {
  const contacts = Array.isArray(input) ? input : [];
  if (contacts.length > CONTACT_TYPES.length) throw badRequest("เลือกช่องทางติดต่อได้สูงสุด 4 ช่องทาง");
  const seen = new Set();
  return contacts.map((contact) => {
    const type = String(contact?.type || "").toLowerCase();
    const value = normalizeText(contact?.value);
    if (!CONTACT_TYPES.includes(type)) throw badRequest("ช่องทางติดต่อไม่ถูกต้อง");
    if (!value) throw badRequest("กรุณากรอกข้อมูลในทุกช่องทางติดต่อที่เลือก");
    if (value.length > 120) throw badRequest("ข้อมูลช่องทางติดต่อยาวเกินไป");
    if (type === "phone" && onlyDigits(value).length < 9) throw badRequest("หมายเลขโทรศัพท์ไม่ถูกต้อง");
    if (seen.has(type)) throw badRequest("เลือกช่องทางติดต่อซ้ำกัน");
    seen.add(type);
    return { type, value };
  });
}

export function appendNameHistory(record, firstName, lastName, changedBy) {
  const previous = `${record.currentFirstName || record.legalFirstName} ${record.currentLastName || record.legalLastName}`.trim();
  const next = `${firstName} ${lastName}`.trim();
  const history = Array.isArray(record.nameHistory) ? [...record.nameHistory] : [];
  if (searchKey(previous) !== searchKey(next) && !history.some((item) => searchKey(item.fullName) === searchKey(previous))) {
    history.push({ fullName: previous, changedAt: new Date().toISOString(), changedBy: changedBy || "self" });
  }
  return history;
}

export async function saveAlumni(id, patch) {
  return updateDoc(ALUMNI, id, { ...patch, updatedAt: new Date().toISOString() });
}

/**
 * PII-free mirror used by the design team and by exports. The ID-card hash and
 * the audit metadata never reach this collection.
 */
export async function syncSubmission(record) {
  const { idCardLast5Hash: _hash, source: _source, outreach: _outreach, ...rest } = record;
  return setDoc(SUBMISSIONS, record.id, { ...rest, syncedAt: new Date().toISOString() });
}

export async function alumniSummary() {
  const [total, submitted, pending, declined] = await Promise.all([
    countDocs(ALUMNI),
    countDocs(ALUMNI, [["status", "==", "submitted"]]),
    countDocs(ALUMNI, [["status", "==", "pending"]]),
    countDocs(ALUMNI, [["status", "==", "declined"]])
  ]);
  const submittedRecords = await listDocs(ALUMNI, { where: [["status", "==", "submitted"]], limit: 60000 });
  const byBatch = new Map();
  submittedRecords.forEach((record) => byBatch.set(record.batch, (byBatch.get(record.batch) || 0) + 1));
  return {
    total,
    submitted,
    pending,
    declined,
    withPhoto: submittedRecords.filter((record) => record.photo?.choice === "upload").length,
    withoutPhoto: submittedRecords.filter((record) => record.photo?.choice !== "upload").length,
    withContacts: submittedRecords.filter((record) => (record.contacts || []).length > 0).length,
    byBatch: [...byBatch.entries()].sort(([a], [b]) => a - b).map(([batch, responses]) => ({ batch, responses }))
  };
}

/**
 * Administrator listing with real pagination.
 *
 * Browsing (no search term) pages straight through Firestore with
 * offset/limit and a separate count, so the number of records the console can
 * reach is not capped — 10,000+ pages fine. Searching uses indexed prefix
 * queries rather than pulling the collection into memory to filter it.
 */
export async function listAlumni({ batch, status, query, limit = 100, offset = 0 } = {}) {
  const where = [];
  if (batch) where.push(["batch", "==", batch]);
  if (status) where.push(["status", "==", status]);

  if (!query) {
    const [records, total] = await Promise.all([
      listDocs(ALUMNI, { where, limit, offset }),
      countDocs(ALUMNI, where)
    ]);
    return { records, total, offset, limit, searched: false };
  }

  const matches = await searchAlumniRecords({ batch, status, query });
  return { records: matches.slice(offset, offset + limit), total: matches.length, offset, limit, searched: true };
}

/** Indexed prefix search across names and student codes. */
async function searchAlumniRecords({ batch, status, query, cap = 5000 }) {
  const base = batch ? [["batch", "==", batch]] : [];
  const key = searchKey(query);
  const digits = onlyDigits(query);
  const found = new Map();

  const queries = [];
  if (digits.length >= 3) {
    queries.push(listDocs(ALUMNI, {
      where: [...base, ["studentId", ">=", digits], ["studentId", "<=", `${digits}\uf8ff`]],
      orderBy: ["studentId"],
      limit: cap
    }));
  }
  if (key.length >= 2) {
    queries.push(
      listDocs(ALUMNI, { where: [...base, ["searchFirst", ">=", key], ["searchFirst", "<=", `${key}\uf8ff`]], orderBy: ["searchFirst"], limit: cap }),
      listDocs(ALUMNI, { where: [...base, ["searchLast", ">=", key], ["searchLast", "<=", `${key}\uf8ff`]], orderBy: ["searchLast"], limit: cap })
    );
  }
  if (!queries.length) return [];

  (await Promise.all(queries)).flat().forEach((record) => found.set(record.id, record));
  const results = [...found.values()];
  return status ? results.filter((record) => record.status === status) : results;
}

/** Every matching record, for export. Pages through in blocks rather than one huge read. */
export async function listAllAlumni({ batch, status } = {}) {
  const where = [];
  if (batch) where.push(["batch", "==", batch]);
  if (status) where.push(["status", "==", status]);

  const all = [];
  const PAGE = 2000;
  for (let offset = 0; ; offset += PAGE) {
    const page = await listDocs(ALUMNI, { where, limit: PAGE, offset });
    all.push(...page);
    if (page.length < PAGE) break;
  }
  return all;
}
