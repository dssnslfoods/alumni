import { config } from "../lib/env.js";
import { getDoc, setDoc } from "../lib/db.js";

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

export async function getSettings() {
  const stored = await getDoc(config.collections.settings, DOC_ID);
  return { ...DEFAULTS, ...(stored || {}) };
}

export async function updateSettings(patch, actor) {
  const allowed = ["submissionOpen", "closedMessage", "maxBatch", "pdpaVersion", "bookTitle", "bioMaxLength"];
  const next = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
  return setDoc(config.collections.settings, DOC_ID, {
    ...next,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.username || "system"
  }, { merge: true });
}
