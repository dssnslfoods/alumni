import { verifyToken } from "../lib/crypto.js";
import { forbidden, unauthorized } from "../lib/http.js";
import { can, findUserById } from "../domain/users.js";

/**
 * Reads the bearer token, loads the account and rejects tokens that were
 * issued before the last password change (`tokenVersion`).
 */
export async function loadUser(req, _res, next) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return next();
  const payload = verifyToken(token);
  if (!payload?.sub) return next();
  const user = await findUserById(payload.sub);
  if (!user || user.status !== "active") return next();
  if ((user.tokenVersion || 1) !== payload.ver) return next();
  req.user = {
    uid: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    batchScope: user.batchScope || null,
    alumniId: user.alumniId || null,
    mustChangePassword: Boolean(user.mustChangePassword)
  };
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/**
 * Blocks every action except changing the password while a first-login or
 * admin-reset password change is outstanding.
 */
export function requireFreshPassword(req, _res, next) {
  if (req.user?.mustChangePassword) return next(forbidden("กรุณาเปลี่ยนรหัสผ่านก่อนใช้งานระบบ"));
  next();
}

export function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!can(req.user, permission)) return next(forbidden());
    next();
  };
}

/** Batch representatives (`staff`) may only touch their assigned batches. */
export function assertBatchAccess(user, batch) {
  if (!user?.batchScope?.length) return true;
  if (!user.batchScope.includes(Number(batch))) throw forbidden("ไม่มีสิทธิ์เข้าถึงข้อมูลของรุ่นนี้");
  return true;
}
