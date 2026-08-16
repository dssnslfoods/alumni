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

/** "45, 46 47" → [45, 46, 47]. Accepts commas, spaces or both. */
export function parseBatchList(value) {
  if (Array.isArray(value)) return [...new Set(value.map(parseBatch).filter((item) => item !== null))].sort((a, b) => a - b);
  const parts = String(value ?? "").split(/[,\s;]+/).filter(Boolean);
  const batches = parts.map(parseBatch);
  if (batches.some((item) => item === null)) return null;
  return [...new Set(batches)].sort((a, b) => a - b);
}

/** Firestore allows at most 30 values in an `in` filter. */
const IN_CHUNK = 30;

function batchClauses(batches) {
  if (!batches?.length) return [[]];
  if (batches.length === 1) return [[["batch", "==", batches[0]]]];
  const chunks = [];
  for (let start = 0; start < batches.length; start += IN_CHUNK) {
    chunks.push([["batch", "in", batches.slice(start, start + IN_CHUNK)]]);
  }
  return chunks;
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

/**
 * Dashboard figures for the association's committee.
 *
 * Everything is derived from two reads: the aggregate counts, and one pass over
 * the records. `byBatch` carries the roster size alongside the response count
 * so the dashboard can show a real response *rate* per batch, not just a total.
 */
export async function alumniSummary() {
  const [total, submitted, pending, declined] = await Promise.all([
    countDocs(ALUMNI),
    countDocs(ALUMNI, [["status", "==", "submitted"]]),
    countDocs(ALUMNI, [["status", "==", "pending"]]),
    countDocs(ALUMNI, [["status", "==", "declined"]])
  ]);

  const all = await listDocs(ALUMNI, { limit: 60000 });
  const byBatch = new Map();
  let withPhoto = 0;
  let withoutPhoto = 0;
  let withContacts = 0;
  let withBio = 0;
  let nameChanged = 0;
  let photoBytes = 0;
  const recent = [];

  all.forEach((record) => {
    const stats = byBatch.get(record.batch) || { batch: record.batch, roster: 0, submitted: 0, pending: 0, declined: 0, photos: 0 };
    stats.roster += 1;
    stats[record.status] = (stats[record.status] || 0) + 1;

    if (record.status === "submitted") {
      if (record.photo?.choice === "upload") {
        withPhoto += 1;
        stats.photos += 1;
        photoBytes += record.photo?.bytes || 0;
      } else {
        withoutPhoto += 1;
      }
      if ((record.contacts || []).length) withContacts += 1;
      if ((record.bio || "").trim()) withBio += 1;
      if ((record.nameHistory || []).length) nameChanged += 1;
      if (record.submittedAt) recent.push({ at: record.submittedAt, batch: record.batch });
    }
    byBatch.set(record.batch, stats);
  });

  recent.sort((left, right) => (left.at < right.at ? 1 : -1));

  // Submissions per day for the last 14 days — shows whether the campaign is
  // still moving or has gone quiet.
  const days = [];
  const today = new Date();
  for (let back = 13; back >= 0; back -= 1) {
    const day = new Date(today.getTime() - back * 86400000).toISOString().slice(0, 10);
    days.push({ day, count: recent.filter((item) => String(item.at).slice(0, 10) === day).length });
  }

  const batches = [...byBatch.values()]
    .sort((left, right) => left.batch - right.batch)
    .map((item) => ({
      ...item,
      responses: item.submitted,
      rate: item.roster ? Math.round((item.submitted / item.roster) * 100) : 0
    }));

  const answered = submitted + declined;
  return {
    total,
    submitted,
    pending,
    declined,
    withPhoto,
    withoutPhoto,
    withContacts,
    withBio,
    nameChanged,
    photoBytes,
    responseRate: total ? Math.round((answered / total) * 100) : 0,
    submittedRate: total ? Math.round((submitted / total) * 100) : 0,
    photoRate: submitted ? Math.round((withPhoto / submitted) * 100) : 0,
    batchesWithData: batches.length,
    lastSubmittedAt: recent[0]?.at || "",
    submittedLast7Days: days.slice(7).reduce((carry, item) => carry + item.count, 0),
    daily: days,
    topBatches: [...batches].filter((item) => item.roster >= 5 && item.submitted > 0).sort((left, right) => right.rate - left.rate || right.submitted - left.submitted).slice(0, 5),
    lowBatches: [...batches].filter((item) => item.roster >= 5).sort((left, right) => left.rate - right.rate || right.pending - left.pending).slice(0, 5),
    byBatch: batches
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
export async function listAlumni({ batches, status, query, limit = 100, offset = 0 } = {}) {
  const list = batches?.length ? batches : [];
  const statusClause = status ? [["status", "==", status]] : [];

  if (query) {
    const matches = await searchAlumniRecords({ batches: list, status, query });
    return { records: matches.slice(offset, offset + limit), total: matches.length, offset, limit, searched: true };
  }

  // One batch (or none) maps to a single indexed query, so paging is unbounded.
  if (list.length <= 1) {
    const where = [...(list.length ? [["batch", "==", list[0]]] : []), ...statusClause];
    const [records, total] = await Promise.all([
      listDocs(ALUMNI, { where, limit, offset }),
      countDocs(ALUMNI, where)
    ]);
    return { records, total, offset, limit, searched: false };
  }

  // Several batches need one query per `in` chunk, then a merge — so the slice
  // happens here rather than in the database.
  const merged = await fetchByBatches(list, statusClause);
  return { records: merged.slice(offset, offset + limit), total: merged.length, offset, limit, searched: false };
}

async function fetchByBatches(batches, extraClauses = [], cap = 20000) {
  const found = new Map();
  for (const clause of batchClauses(batches)) {
    const page = await listDocs(ALUMNI, { where: [...clause, ...extraClauses], limit: cap });
    page.forEach((record) => found.set(record.id, record));
  }
  return [...found.values()].sort(compareForDisplay);
}

/** Batch first, then Thai given name — the order a yearbook is laid out in. */
export function compareForDisplay(left, right) {
  if (left.batch !== right.batch) return left.batch - right.batch;
  const collator = new Intl.Collator("th-TH");
  return collator.compare(left.currentFirstName || left.legalFirstName, right.currentFirstName || right.legalFirstName)
    || collator.compare(left.currentLastName || left.legalLastName, right.currentLastName || right.legalLastName)
    || String(left.id).localeCompare(String(right.id));
}

/** Indexed prefix search across names and student codes. */
async function searchAlumniRecords({ batches = [], status, query, cap = 5000 }) {
  const key = searchKey(query);
  const digits = onlyDigits(query);
  const found = new Map();

  for (const clause of batchClauses(batches)) {
    const queries = [];
    if (digits.length >= 3) {
      queries.push(listDocs(ALUMNI, {
        where: [...clause, ["studentId", ">=", digits], ["studentId", "<=", `${digits}\uf8ff`]],
        orderBy: ["studentId"],
        limit: cap
      }));
    }
    if (key.length >= 2) {
      queries.push(
        listDocs(ALUMNI, { where: [...clause, ["searchFirst", ">=", key], ["searchFirst", "<=", `${key}\uf8ff`]], orderBy: ["searchFirst"], limit: cap }),
        listDocs(ALUMNI, { where: [...clause, ["searchLast", ">=", key], ["searchLast", "<=", `${key}\uf8ff`]], orderBy: ["searchLast"], limit: cap })
      );
    }
    if (!queries.length) continue;
    (await Promise.all(queries)).flat().forEach((record) => found.set(record.id, record));
  }

  const results = [...found.values()].sort(compareForDisplay);
  return status ? results.filter((record) => record.status === status) : results;
}

/** Every matching record, for export. Pages through in blocks rather than one huge read. */
export async function listAllAlumni({ batches, status } = {}) {
  const statusClause = status ? [["status", "==", status]] : [];
  if (batches?.length > 1) return fetchByBatches(batches, statusClause);

  const where = [...(batches?.length ? [["batch", "==", batches[0]]] : []), ...statusClause];
  const all = [];
  const PAGE = 2000;
  for (let offset = 0; ; offset += PAGE) {
    const page = await listDocs(ALUMNI, { where, limit: PAGE, offset });
    all.push(...page);
    if (page.length < PAGE) break;
  }
  return all.sort(compareForDisplay);
}
