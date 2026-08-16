import express from "express";
import { config } from "../lib/env.js";
import { signToken, safeEquals, verifyPassword } from "../lib/crypto.js";
import { badRequest, clientIp, createRateLimiter, route, tooMany, unauthorized } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { authenticate, ensureOwnerAccount, findUserById, publicUser, setPassword, validatePassword } from "../domain/users.js";
import { loadUser, requireAuth } from "../middleware/auth.js";

const router = express.Router();
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
const resetLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

function issueToken(user) {
  return signToken(
    { sub: user.id, username: user.username, role: user.role, ver: user.tokenVersion || 1 },
    { expiresInSeconds: config.sessionHours * 3600 }
  );
}

router.post("/login", route(async (req, res) => {
  if (!loginLimiter(clientIp(req))) throw tooMany("พยายามเข้าสู่ระบบถี่เกินไป กรุณารอ 15 นาที");
  await ensureOwnerAccount();

  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!username || !password) throw badRequest("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน");

  const result = await authenticate(username, password);
  if (!result.ok) {
    await audit(req, "auth.login.failed", { targetType: "user", targetId: username.toLowerCase(), meta: { reason: result.reason } });
    throw unauthorized(result.message);
  }

  await audit(req, "auth.login.success", { actor: { uid: result.user.id, username: result.user.username, role: result.user.role } });
  res.json({ token: issueToken(result.user), expiresInHours: config.sessionHours, user: publicUser(result.user) });
}));

router.get("/me", loadUser, requireAuth, route(async (req, res) => {
  const user = await findUserById(req.user.uid);
  res.json({ user: publicUser(user) });
}));

router.post("/change-password", loadUser, requireAuth, route(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = validatePassword(req.body?.newPassword);
  const user = await findUserById(req.user.uid);
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw unauthorized("รหัสผ่านปัจจุบันไม่ถูกต้อง");
  if (safeEquals(currentPassword, newPassword)) throw badRequest("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม");

  const updated = await setPassword(user.id, newPassword, { mustChangePassword: false, actorUid: user.id });
  await audit(req, "auth.password.changed", { targetType: "user", targetId: user.id });
  const refreshed = await findUserById(user.id);
  res.json({ token: issueToken(refreshed), user: publicUser({ ...refreshed, ...updated }) });
}));

/**
 * Break-glass reset of the owner password using the ADMIN_ACCESS_KEY secret.
 * Rate limited and audited. Disabled entirely when the secret is unset.
 */
router.post("/emergency-owner-reset", route(async (req, res) => {
  if (!resetLimiter(clientIp(req))) throw tooMany();
  if (!config.emergencyKey) throw unauthorized("ไม่ได้เปิดใช้งานการกู้คืนบัญชีเจ้าของระบบ");
  if (!safeEquals(String(req.headers["x-emergency-key"] || ""), config.emergencyKey)) throw unauthorized("คีย์กู้คืนไม่ถูกต้อง");

  const bootstrap = await ensureOwnerAccount();
  const newPassword = validatePassword(req.body?.newPassword);
  const { listUsers } = await import("../domain/users.js");
  const [owner] = await listUsers({ role: "owner", limit: 1 });
  if (!owner) throw badRequest("ไม่พบบัญชีเจ้าของระบบ");
  await setPassword(owner.id, newPassword, { mustChangePassword: true, actorUid: "emergency" });
  await audit(req, "auth.owner.emergencyReset", { targetType: "user", targetId: owner.id, meta: { bootstrapped: bootstrap.created } });
  res.json({ ok: true, username: owner.username });
}));

export default router;
