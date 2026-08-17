import { config } from "../lib/env.js";
import { getDoc, setDoc } from "../lib/db.js";
import { badRequest } from "../lib/http.js";

const DOC_ID = "system";

const DEFAULTS = {
  submissionOpen: true,
  closedMessage: "ขณะนี้ปิดรับข้อมูลสำหรับหนังสืออนุสรณ์แล้ว กรุณาติดต่อผู้แทนรุ่นของท่าน",
  maxBatch: config.maxBatch,
  pdpaVersion: config.pdpaVersion,
  bookTitle: "หนังสืออนุสรณ์ สภจ. 2569",
  bioMaxLength: 500,
  updatedAt: "",
  updatedBy: ""
};

/**
 * In-process cache of the settings document.
 *
 * `maxBatch` has to be checked by synchronous validators (`parseBatch`) that
 * run on every search, import row and admin filter — reading Firestore there
 * is not an option. So the value is cached and refreshed by `primeSettings()`,
 * which the request pipeline calls at most once a minute per instance.
 */
let cache = { value: { ...DEFAULTS }, at: 0 };
const CACHE_TTL_MS = 60_000;

export async function getSettings() {
  const stored = await getDoc(config.collections.settings, DOC_ID);
  const merged = { ...DEFAULTS, ...(stored || {}) };
  cache = { value: merged, at: Date.now() };
  return merged;
}

/** Refresh the cache when stale. Never throws — a settings read must not break a request. */
export async function primeSettings() {
  if (Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    return await getSettings();
  } catch (error) {
    console.error("prime settings failed", error?.message);
    cache.at = Date.now(); // back off rather than retrying on every request
    return cache.value;
  }
}

/** The batch ceiling actually enforced everywhere. Falls back to the env default. */
export function effectiveMaxBatch() {
  const value = Number(cache.value?.maxBatch);
  return Number.isInteger(value) && value >= 1 ? value : config.maxBatch;
}

export function effectiveBioMaxLength() {
  const value = Number(cache.value?.bioMaxLength);
  return Number.isInteger(value) && value >= 1 ? value : DEFAULTS.bioMaxLength;
}

export async function updateSettings(patch, actor) {
  const allowed = ["submissionOpen", "closedMessage", "maxBatch", "pdpaVersion", "bookTitle", "bioMaxLength"];
  const next = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));

  if (next.maxBatch !== undefined) {
    const maxBatch = Number(next.maxBatch);
    if (!Number.isInteger(maxBatch) || maxBatch < 1 || maxBatch > 200) {
      throw badRequest("รุ่นสูงสุดต้องเป็นจำนวนเต็ม 1-200");
    }
    next.maxBatch = maxBatch;
  }
  if (next.bioMaxLength !== undefined) {
    const bioMaxLength = Number(next.bioMaxLength);
    if (!Number.isInteger(bioMaxLength) || bioMaxLength < 50 || bioMaxLength > 2000) {
      throw badRequest("ความยาวประวัติสูงสุดต้องอยู่ระหว่าง 50-2,000 ตัวอักษร");
    }
    next.bioMaxLength = bioMaxLength;
  }

  const saved = await setDoc(config.collections.settings, DOC_ID, {
    ...next,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.username || "system"
  }, { merge: true });

  // Refresh immediately so the new ceiling applies to the very next request.
  await getSettings();
  return saved;
}
