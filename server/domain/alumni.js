import crypto from "node:crypto";
import { config } from "../lib/env.js";
import { countDocs, getDoc, listDocs, setDoc, updateDoc } from "../lib/db.js";
import { hashIdCardLast5 } from "../lib/crypto.js";
import { badRequest } from "../lib/http.js";
import { effectiveMaxBatch } from "./settings.js";

const { alumni: ALUMNI, submissions: SUBMISSIONS } = config.collections;

export const CONTACT_TYPES = ["facebook", "instagram", "line", "phone"];
export const STATUSES = ["pending", "submitted", "declined"];

/**
 * Follow-up state, tracked by the batch representative.
 *
 * Deliberately separate from `status`: `status` records what the alumnus
 * decided inside the system, while this records what the representative
 * learned by phoning around. Folding "deceased" into `status` would erase the
 * fact that the person had already consented to appear in the book.
 */
export const FOLLOW_UP_STATES = {
  none: { label: "ยังไม่ได้ติดตาม", tone: "neutral" },
  contacted: { label: "ติดต่อแล้ว รอส่งข้อมูล", tone: "wait" },
  unreachable: { label: "ติดต่อไม่ได้", tone: "warn" },
  abroad: { label: "อยู่ต่างประเทศ", tone: "wait" },
  declinedByPhone: { label: "แจ้งไม่ประสงค์ลง (ทางโทรศัพท์)", tone: "warn" },
  deceased: { label: "เสียชีวิต", tone: "memorial" }
};

export const FOLLOW_UP_KEYS = Object.keys(FOLLOW_UP_STATES);

export function validateFollowUp(state, note, actor) {
  if (!FOLLOW_UP_KEYS.includes(state)) throw badRequest("สถานะการติดตามไม่ถูกต้อง");
  return {
    state,
    note: normalizeText(note).slice(0, 300),
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.username || "system"
  };
}

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
  if (!Number.isInteger(batch) || batch < 1 || batch > effectiveMaxBatch()) return null;
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
    reviewNote: "",
    followUp: { state: "none", note: "", updatedAt: "", updatedBy: "" }
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

/**
 * Contact rules, shared with the browser so the hint text and the validation
 * can never drift apart.
 *
 * Everything is normalized to one canonical form before storage — people type
 * "@somchai", "line.me/ti/p/somchai" and "  Somchai " for the same ID, and the
 * printed book has to read consistently.
 */
export const CONTACT_RULES = {
  facebook: {
    label: "Facebook",
    placeholder: "somchai.jaidee หรือ facebook.com/somchai.jaidee",
    hint: "ใส่ชื่อผู้ใช้ หรือวางลิงก์โปรไฟล์ก็ได้",
    example: "somchai.jaidee"
  },
  instagram: {
    label: "Instagram",
    placeholder: "somchai_j",
    hint: "ใส่ชื่อผู้ใช้ ไม่ต้องใส่ @",
    example: "somchai_j"
  },
  line: {
    label: "LINE ID",
    placeholder: "somchai2569",
    hint: "ใส่ LINE ID ไม่ต้องใส่ @ (ถ้าเป็นบัญชีทางการให้ใส่ @ ด้วย)",
    example: "somchai2569"
  },
  phone: {
    label: "โทรศัพท์",
    placeholder: "081-234-5678",
    hint: "ตัวเลข 9-10 หลัก ระบบจัดรูปแบบให้อัตโนมัติ",
    example: "081-234-5678"
  }
};

/** 0812345678 → 081-234-5678, 021234567 → 02-123-4567 */
function formatThaiPhone(digits) {
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  return digits;
}

/**
 * Pull the handle out of a pasted profile link.
 *
 * Takes the LAST path segment, because the handle sits at different depths per
 * service — instagram.com/<id> but line.me/ti/p/<id>.
 */
function handleFromUrl(value, hosts) {
  const match = String(value).match(/^(?:https?:\/\/)?(?:www\.)?([^/\s]+)\/(.+)$/i);
  if (!match || !hosts.some((host) => match[1].toLowerCase().includes(host))) return null;

  const segments = match[2].split(/[/?#&]/).filter(Boolean);
  const numericId = segments.find((segment) => /^id=\d+$/.test(segment));
  const last = numericId ? numericId.slice(3) : segments[segments.length - 1] || "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function normalizeContact(type, raw) {
  const value = normalizeText(raw).replace(/\s+/g, type === "phone" ? "" : " ").trim();
  if (!value) throw badRequest(`กรุณากรอก${CONTACT_RULES[type].label}`);

  if (type === "phone") {
    const digits = onlyDigits(value);
    if (digits.length < 9 || digits.length > 10) throw badRequest("หมายเลขโทรศัพท์ต้องเป็นตัวเลข 9-10 หลัก เช่น 081-234-5678");
    if (!digits.startsWith("0")) throw badRequest("หมายเลขโทรศัพท์ต้องขึ้นต้นด้วย 0");
    return formatThaiPhone(digits);
  }

  if (type === "line") {
    // LINE official accounts legitimately start with @; personal IDs do not.
    const official = value.startsWith("@");
    const id = (handleFromUrl(value, ["line.me", "line.naver"]) || value).replace(/^@/, "").trim();
    if (/\s/.test(id)) throw badRequest("LINE ID ต้องไม่มีช่องว่าง กรุณาตรวจสอบอีกครั้ง");
    if (!/^[A-Za-z0-9._-]{2,32}$/.test(id)) {
      throw badRequest("LINE ID ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีดกลาง และขีดล่าง ยาว 2-32 ตัว");
    }
    return official ? `@${id}` : id;
  }

  if (type === "instagram") {
    const handle = (handleFromUrl(value, ["instagram.com"]) || value).replace(/^@/, "").trim();
    if (/\s/.test(handle)) throw badRequest("ชื่อผู้ใช้ Instagram ต้องไม่มีช่องว่าง กรุณาตรวจสอบอีกครั้ง");
    if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) {
      throw badRequest("Instagram ใช้ได้เฉพาะ a-z, 0-9, จุด และขีดล่าง ยาวไม่เกิน 30 ตัว");
    }
    return handle;
  }

  // Facebook allows Thai vanity names and numeric profile ids, so keep the
  // handle as typed once the URL wrapper and stray @ are removed.
  const handle = (handleFromUrl(value, ["facebook.com", "fb.com", "fb.me"]) || value).replace(/^@/, "").trim();
  if (handle.length < 2 || handle.length > 80) throw badRequest("ชื่อผู้ใช้ Facebook ยาว 2-80 ตัวอักษร");
  if (/\s{2,}|[<>"']/.test(handle)) throw badRequest("ชื่อผู้ใช้ Facebook มีอักขระที่ไม่รองรับ");
  return handle;
}

export function validateContacts(input) {
  const contacts = Array.isArray(input) ? input : [];
  if (contacts.length > CONTACT_TYPES.length) throw badRequest("เลือกช่องทางติดต่อได้สูงสุด 4 ช่องทาง");
  const seen = new Set();
  return contacts.map((contact) => {
    const type = String(contact?.type || "").toLowerCase();
    if (!CONTACT_TYPES.includes(type)) throw badRequest("ช่องทางติดต่อไม่ถูกต้อง");
    if (seen.has(type)) throw badRequest("เลือกช่องทางติดต่อซ้ำกัน");
    seen.add(type);
    return { type, value: normalizeContact(type, contact?.value) };
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
/**
 * Aggregate figures for the public welcome page.
 *
 * The landing page is the most-visited page in the system, so this must never
 * scan the collection: at 10,000 records that would be 10,000 document reads
 * per visitor. Instead it uses Firestore count aggregations (billed per 1,000
 * matched documents, not per document) and caches the result, so a busy day
 * costs a few hundred reads in total.
 *
 * Nothing personal is exposed — only counts per batch.
 */
let statsCache = { value: null, at: 0 };
const STATS_TTL_MS = 5 * 60 * 1000;

export async function publicStats({ force = false } = {}) {
  if (!force && statsCache.value && Date.now() - statsCache.at < STATS_TTL_MS) return statsCache.value;

  const maxBatch = effectiveMaxBatch();
  const [roster, submitted] = await Promise.all([countDocs(ALUMNI), countDocs(ALUMNI, [["status", "==", "submitted"]])]);

  const batches = [];
  const numbers = Array.from({ length: maxBatch }, (_, index) => index + 1);
  for (let start = 0; start < numbers.length; start += 20) {
    const chunk = numbers.slice(start, start + 20);
    const counted = await Promise.all(chunk.map(async (batch) => {
      const [batchRoster, batchSubmitted] = await Promise.all([
        countDocs(ALUMNI, [["batch", "==", batch]]),
        countDocs(ALUMNI, [["batch", "==", batch], ["status", "==", "submitted"]])
      ]);
      return { batch, roster: batchRoster, submitted: batchSubmitted };
    }));
    counted.forEach((item) => { if (item.roster > 0) batches.push(item); });
  }

  const withRate = batches.map((item) => ({ ...item, rate: item.roster ? Math.round((item.submitted / item.roster) * 100) : 0 }));
  const value = {
    roster,
    submitted,
    rate: roster ? Math.round((submitted / roster) * 100) : 0,
    batchCount: withRate.length,
    // Batches worth celebrating, and batches worth nudging. A batch needs a few
    // people on the register before a percentage means anything.
    topByRate: [...withRate].filter((item) => item.roster >= 5 && item.submitted > 0).sort((left, right) => right.rate - left.rate || right.submitted - left.submitted).slice(0, 3),
    topByCount: [...withRate].filter((item) => item.submitted > 0).sort((left, right) => right.submitted - left.submitted).slice(0, 3),
    needNudge: [...withRate].filter((item) => item.roster >= 5).sort((left, right) => left.rate - right.rate || right.roster - left.roster).slice(0, 3),
    updatedAt: new Date().toISOString()
  };

  statsCache = { value, at: Date.now() };
  return value;
}

/** เรียกเมื่อมีการส่งข้อมูลใหม่ เพื่อให้ตัวเลขบนหน้าแรกขยับตามจริง */
export function invalidatePublicStats() {
  statsCache = { value: null, at: 0 };
}

/** นับตามสถานะการติดตาม สำหรับแดชบอร์ดและหน้ารายชื่อ */
export function summariseFollowUp(records) {
  const counts = Object.fromEntries(FOLLOW_UP_KEYS.map((key) => [key, 0]));
  records.forEach((record) => {
    const state = record.followUp?.state;
    counts[FOLLOW_UP_KEYS.includes(state) ? state : "none"] += 1;
  });
  return counts;
}

export async function alumniSummary() {
  const [total, submitted, pending, declined] = await Promise.all([
    countDocs(ALUMNI),
    countDocs(ALUMNI, [["status", "==", "submitted"]]),
    countDocs(ALUMNI, [["status", "==", "pending"]]),
    countDocs(ALUMNI, [["status", "==", "declined"]])
  ]);

  const all = await listDocs(ALUMNI, { limit: 60000 });
  const followUp = summariseFollowUp(all);
  const byBatch = new Map();
  let withPhoto = 0;
  let withoutPhoto = 0;
  let withContacts = 0;
  let withBio = 0;
  let nameChanged = 0;
  let photoBytes = 0;
  const recent = [];

  all.forEach((record) => {
    const stats = byBatch.get(record.batch) || { batch: record.batch, roster: 0, submitted: 0, pending: 0, declined: 0, photos: 0, deceased: 0 };
    stats.roster += 1;
    stats[record.status] = (stats[record.status] || 0) + 1;
    if (record.followUp?.state === "deceased") stats.deceased += 1;

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
    followUp,
    deceased: followUp.deceased,
    unreachable: followUp.unreachable,
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
