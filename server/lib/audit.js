import { config } from "./env.js";
import { addDoc } from "./db.js";
import { hashForLog } from "./crypto.js";
import { clientIp } from "./http.js";

/**
 * Append-only audit trail. Never store personal data here — only identifiers,
 * the action taken, and a hashed client IP.
 */
export async function audit(req, action, { targetType = "", targetId = "", meta = {}, actor } = {}) {
  const who = actor || req?.user || null;
  try {
    await addDoc(config.collections.auditLogs, {
      at: new Date().toISOString(),
      action,
      actorUid: who?.uid || "",
      actorUsername: who?.username || "",
      actorRole: who?.role || "",
      targetType,
      targetId: String(targetId || ""),
      meta,
      ipHash: hashForLog(req ? clientIp(req) : "")
    }, "log");
  } catch (error) {
    console.error("audit log failed", action, error?.message);
  }
}
