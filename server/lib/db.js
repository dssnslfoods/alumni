import fs from "node:fs";
import path from "node:path";
import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { config, firebaseEnabled, localDbDir } from "./env.js";
import { newId } from "./crypto.js";

let firestore = null;
let bucket = null;

if (firebaseEnabled) {
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const options = { storageBucket: config.storageBucket };
  if (credentialPath && fs.existsSync(credentialPath)) {
    options.credential = cert(JSON.parse(fs.readFileSync(credentialPath, "utf8")));
  }
  const app = getApps().length ? getApp() : initializeApp(options);
  firestore = getFirestore(app);
  firestore.settings({ ignoreUndefinedProperties: true });
  bucket = getStorage(app).bucket();
}

export const usingFirestore = Boolean(firestore);
export const storageBucket = bucket;

export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConflictError";
    this.status = 409;
  }
}

/* ------------------------------------------------------------------ *
 * Local JSON fallback — lets `npm run dev` run with no Firebase creds.
 * ------------------------------------------------------------------ */

function localPath(collection) {
  return path.join(localDbDir, `${collection}.json`);
}

function readLocal(collection) {
  const file = localPath(collection);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeLocal(collection, documents) {
  fs.writeFileSync(localPath(collection), JSON.stringify(documents, null, 2));
}

function readPath(source, field) {
  return String(field).split(".").reduce((value, key) => (value == null ? undefined : value[key]), source);
}

function matches(document, [field, operator, expected]) {
  const actual = readPath(document, field);
  switch (operator) {
    case "==": return actual === expected;
    case "!=": return actual !== expected;
    case ">": return actual > expected;
    case ">=": return actual >= expected;
    case "<": return actual < expected;
    case "<=": return actual <= expected;
    case "in": return Array.isArray(expected) && expected.includes(actual);
    case "array-contains": return Array.isArray(actual) && actual.includes(expected);
    case "array-contains-any": return Array.isArray(actual) && expected.some((item) => actual.includes(item));
    default: throw new Error(`ตัวดำเนินการค้นหาไม่รองรับ: ${operator}`);
  }
}

function localQuery(collection, { where = [], orderBy, limit, offset = 0 } = {}) {
  let results = Object.values(readLocal(collection)).filter((document) => where.every((clause) => matches(document, clause)));
  if (orderBy) {
    const [field, direction = "asc"] = orderBy;
    results.sort((left, right) => {
      const a = readPath(left, field);
      const b = readPath(right, field);
      if (a === b) return 0;
      const order = a > b ? 1 : -1;
      return direction === "desc" ? -order : order;
    });
  }
  results = results.slice(offset);
  return typeof limit === "number" ? results.slice(0, limit) : results;
}

/* ------------------------------------------------------------------ *
 * Public data-access API (identical shape for both backends)
 * ------------------------------------------------------------------ */

export async function getDoc(collection, id) {
  if (!id) return null;
  if (firestore) {
    const snapshot = await firestore.collection(collection).doc(String(id)).get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  }
  return readLocal(collection)[String(id)] || null;
}

export async function setDoc(collection, id, data, { merge = false } = {}) {
  const document = { ...data, id: String(id) };
  if (firestore) {
    await firestore.collection(collection).doc(String(id)).set(document, { merge });
    return document;
  }
  const documents = readLocal(collection);
  documents[String(id)] = merge ? deepMerge(documents[String(id)] || {}, document) : document;
  writeLocal(collection, documents);
  return documents[String(id)];
}

/** Create only if absent. Used to enforce username uniqueness. */
export async function createDoc(collection, id, data, conflictMessage = "ข้อมูลนี้ถูกใช้งานแล้ว") {
  const document = { ...data, id: String(id) };
  if (firestore) {
    try {
      await firestore.collection(collection).doc(String(id)).create(document);
    } catch (error) {
      if (error?.code === 6) throw new ConflictError(conflictMessage);
      throw error;
    }
    return document;
  }
  const documents = readLocal(collection);
  if (documents[String(id)]) throw new ConflictError(conflictMessage);
  documents[String(id)] = document;
  writeLocal(collection, documents);
  return document;
}

export async function updateDoc(collection, id, patch) {
  return setDoc(collection, id, patch, { merge: true });
}

export async function deleteDoc(collection, id) {
  if (firestore) {
    await firestore.collection(collection).doc(String(id)).delete();
    return;
  }
  const documents = readLocal(collection);
  delete documents[String(id)];
  writeLocal(collection, documents);
}

export async function addDoc(collection, data, prefix = "doc") {
  const id = newId(prefix);
  return setDoc(collection, id, data);
}

export async function listDocs(collection, options = {}) {
  if (!firestore) return localQuery(collection, options);
  const { where = [], orderBy, limit, offset } = options;
  let query = firestore.collection(collection);
  where.forEach(([field, operator, value]) => { query = query.where(field, operator, value); });
  if (orderBy) query = query.orderBy(orderBy[0], orderBy[1] || "asc");
  if (offset) query = query.offset(offset);
  if (typeof limit === "number") query = query.limit(limit);
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function countDocs(collection, where = []) {
  if (!firestore) return localQuery(collection, { where }).length;
  let query = firestore.collection(collection);
  where.forEach(([field, operator, value]) => { query = query.where(field, operator, value); });
  const snapshot = await query.count().get();
  return snapshot.data().count;
}

/** Upsert many documents efficiently. Safe for a 10,000-row Excel import. */
export async function bulkSet(collection, entries, { merge = true, onProgress } = {}) {
  if (!firestore) {
    const documents = readLocal(collection);
    entries.forEach(({ id, data }) => {
      documents[String(id)] = merge ? deepMerge(documents[String(id)] || {}, { ...data, id: String(id) }) : { ...data, id: String(id) };
    });
    writeLocal(collection, documents);
    onProgress?.(entries.length);
    return entries.length;
  }
  const writer = firestore.bulkWriter();
  writer.onWriteError((error) => error.failedAttempts < 5);
  entries.forEach(({ id, data }) => {
    writer.set(firestore.collection(collection).doc(String(id)), { ...data, id: String(id) }, { merge });
  });
  await writer.close();
  onProgress?.(entries.length);
  return entries.length;
}

/**
 * Delete every document in a collection and return how many were removed.
 * Used only by the administrator "clear all data" action.
 */
export async function deleteAllDocs(collection) {
  if (!firestore) {
    const documents = readLocal(collection);
    const count = Object.keys(documents).length;
    writeLocal(collection, {});
    return count;
  }
  let deleted = 0;
  // Page through the collection so a 10,000-document wipe never holds the
  // whole set in memory at once.
  for (;;) {
    const snapshot = await firestore.collection(collection).limit(500).get();
    if (snapshot.empty) break;
    const writer = firestore.bulkWriter();
    snapshot.docs.forEach((doc) => writer.delete(doc.ref));
    await writer.close();
    deleted += snapshot.size;
    if (snapshot.size < 500) break;
  }
  return deleted;
}

/** Fetch documents by id in chunks — avoids N round trips. */
export async function getDocsByIds(collection, ids) {
  const unique = [...new Set(ids.map(String).filter(Boolean))];
  if (!unique.length) return new Map();
  if (!firestore) {
    const documents = readLocal(collection);
    return new Map(unique.filter((id) => documents[id]).map((id) => [id, documents[id]]));
  }
  const found = new Map();
  for (let start = 0; start < unique.length; start += 300) {
    const refs = unique.slice(start, start + 300).map((id) => firestore.collection(collection).doc(id));
    const snapshots = await firestore.getAll(...refs);
    snapshots.forEach((snapshot) => {
      if (snapshot.exists) found.set(snapshot.id, { id: snapshot.id, ...snapshot.data() });
    });
  }
  return found;
}

function deepMerge(base, patch) {
  const result = { ...base };
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  });
  return result;
}
