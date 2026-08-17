import { config } from "../lib/env.js";
import { ConflictError, createDoc, deleteDoc, getDoc, listDocs, setDoc, updateDoc } from "../lib/db.js";
import { generatePassword, hashPassword, newId, verifyPassword } from "../lib/crypto.js";
import { badRequest, forbidden, notFound } from "../lib/http.js";

const { users: USERS, usernames: USERNAMES } = config.collections;

export const ROLES = {
  owner: { level: 40, label: "เจ้าของระบบ" },
  admin: { level: 30, label: "ผู้ดูแลระบบ" },
  staff: { level: 20, label: "ตัวแทนรุ่น" },
  alumni: { level: 10, label: "นิสิตเก่า" }
};

export const ROLE_NAMES = Object.keys(ROLES);

const PERMISSIONS = {
  "users.manage": ["owner", "admin"],
  "users.manageAdmins": ["owner"],
  "alumni.read": ["owner", "admin", "staff"],
  "alumni.write": ["owner", "admin"],
  "alumni.import": ["owner", "admin"],
  "alumni.export": ["owner", "admin"],
  "submissions.review": ["owner", "admin", "staff"],
  // Batch representatives track who they have reached by phone. This is their
  // own record of the chase, kept apart from the alumnus's consent decision.
  "alumni.followUp": ["owner", "admin", "staff"],
  "settings.manage": ["owner", "admin"],
  "audit.read": ["owner", "admin"],
  // Wiping every alumni record is irreversible — still gated behind a typed
  // confirmation phrase, and every wipe is written to the audit log.
  "data.reset": ["owner", "admin"],
  "self.submission": ["alumni", "owner", "admin", "staff"]
};

export function can(user, permission) {
  if (!user || user.status !== "active") return false;
  return (PERMISSIONS[permission] || []).includes(user.role);
}

export function roleLevel(role) {
  return ROLES[role]?.level ?? 0;
}

/** An actor may only create or modify accounts strictly below their own level. */
export function assertCanManage(actor, targetRole) {
  if (!can(actor, "users.manage")) throw forbidden();
  if (!ROLES[targetRole]) throw badRequest("บทบาทผู้ใช้ไม่ถูกต้อง");
  if (targetRole === "owner") throw forbidden("ไม่สามารถสร้างหรือแก้ไขบัญชีเจ้าของระบบผ่านหน้านี้");
  if (roleLevel(targetRole) >= roleLevel(actor.role)) throw forbidden("ไม่สามารถจัดการบัญชีที่มีสิทธิ์เท่ากันหรือสูงกว่า");
}

export function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

export function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw badRequest("ชื่อผู้ใช้ต้องยาว 3-32 ตัว ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีดกลาง และขีดล่าง");
  }
  return username;
}

export function validatePassword(password) {
  const value = String(password || "");
  if (value.length < config.minPasswordLength) throw badRequest(`รหัสผ่านต้องยาวอย่างน้อย ${config.minPasswordLength} ตัวอักษร`);
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) throw badRequest("รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข");
  return value;
}

/** Shape returned to clients — never includes the password hash. */
export function publicUser(user) {
  if (!user) return null;
  return {
    uid: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    email: user.email || "",
    role: user.role,
    roleLabel: ROLES[user.role]?.label || user.role,
    status: user.status,
    batchScope: user.batchScope || null,
    alumniId: user.alumniId || null,
    mustChangePassword: Boolean(user.mustChangePassword),
    lastLoginAt: user.lastLoginAt || "",
    createdAt: user.createdAt || ""
  };
}

export async function findUserById(uid) {
  return getDoc(USERS, uid);
}

export async function findUserByUsername(username) {
  const reservation = await getDoc(USERNAMES, normalizeUsername(username));
  return reservation?.uid ? getDoc(USERS, reservation.uid) : null;
}

export async function createUser({ username, password, displayName, email = "", role, batchScope = null, alumniId = null, mustChangePassword = true, createdBy = "system", uid }) {
  const normalized = validateUsername(username);
  validatePassword(password);
  const id = uid || newId("usr");
  await createDoc(USERNAMES, normalized, { uid: id }, "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว");
  const now = new Date().toISOString();
  try {
    const user = await setDoc(USERS, id, {
      username: normalized,
      displayName: String(displayName || normalized).trim(),
      email: String(email || "").trim().toLowerCase(),
      role,
      status: "active",
      batchScope: normalizeBatchScope(batchScope),
      alumniId: alumniId || null,
      passwordHash: await hashPassword(password),
      passwordUpdatedAt: now,
      mustChangePassword: Boolean(mustChangePassword),
      tokenVersion: 1,
      failedLoginCount: 0,
      lockedUntil: "",
      lastLoginAt: "",
      createdAt: now,
      createdBy,
      updatedAt: now,
      updatedBy: createdBy
    });
    return user;
  } catch (error) {
    await deleteDoc(USERNAMES, normalized).catch(() => {});
    throw error;
  }
}

export function normalizeBatchScope(scope) {
  if (!Array.isArray(scope) || !scope.length) return null;
  const batches = [...new Set(scope.map((value) => Number(String(value).trim())).filter((value) => Number.isInteger(value) && value >= 1 && value <= config.maxBatch))];
  return batches.length ? batches.sort((a, b) => a - b) : null;
}

export async function updateUser(uid, patch, actorUid = "system") {
  const user = await findUserById(uid);
  if (!user) throw notFound("ไม่พบบัญชีผู้ใช้");
  return updateDoc(USERS, uid, { ...patch, updatedAt: new Date().toISOString(), updatedBy: actorUid });
}

export async function setPassword(uid, password, { mustChangePassword = false, actorUid = "system", revokeSessions = true } = {}) {
  validatePassword(password);
  const user = await findUserById(uid);
  if (!user) throw notFound("ไม่พบบัญชีผู้ใช้");
  return updateDoc(USERS, uid, {
    passwordHash: await hashPassword(password),
    passwordUpdatedAt: new Date().toISOString(),
    mustChangePassword,
    failedLoginCount: 0,
    lockedUntil: "",
    tokenVersion: (user.tokenVersion || 1) + (revokeSessions ? 1 : 0),
    updatedAt: new Date().toISOString(),
    updatedBy: actorUid
  });
}

export async function deleteUser(uid) {
  const user = await findUserById(uid);
  if (!user) throw notFound("ไม่พบบัญชีผู้ใช้");
  if (user.role === "owner") throw forbidden("ไม่สามารถลบบัญชีเจ้าของระบบ");
  await deleteDoc(USERNAMES, user.username).catch(() => {});
  await deleteDoc(USERS, uid);
  return user;
}

export async function listUsers({ role, status, limit = 200 } = {}) {
  const where = [];
  if (role) where.push(["role", "==", role]);
  if (status) where.push(["status", "==", status]);
  const found = await listDocs(USERS, { where, limit });
  return found.sort((left, right) => roleLevel(right.role) - roleLevel(left.role) || String(left.username).localeCompare(String(right.username)));
}

/* ------------------------------------------------------------------ *
 * Login
 * ------------------------------------------------------------------ */

export async function authenticate(username, password) {
  const user = await findUserByUsername(username);
  // Always run a hash comparison so a missing user and a wrong password
  // take a similar amount of time.
  const stored = user?.passwordHash || "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA";
  const lockedUntil = user?.lockedUntil ? Date.parse(user.lockedUntil) : 0;
  if (user && lockedUntil > Date.now()) {
    const minutes = Math.ceil((lockedUntil - Date.now()) / 60000);
    return { ok: false, reason: "locked", message: `บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ในอีก ${minutes} นาที` };
  }
  const valid = await verifyPassword(password, stored).catch(() => false);
  if (!user || !valid) {
    if (user) {
      const failures = (user.failedLoginCount || 0) + 1;
      await updateDoc(USERS, user.id, {
        failedLoginCount: failures,
        lockedUntil: failures >= config.maxLoginFailures ? new Date(Date.now() + config.lockoutMinutes * 60000).toISOString() : ""
      });
    }
    return { ok: false, reason: "invalid", message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };
  }
  if (user.status !== "active") return { ok: false, reason: "suspended", message: "บัญชีนี้ถูกระงับการใช้งาน" };
  await updateDoc(USERS, user.id, { failedLoginCount: 0, lockedUntil: "", lastLoginAt: new Date().toISOString() });
  return { ok: true, user: { ...user, failedLoginCount: 0, lockedUntil: "" } };
}

/* ------------------------------------------------------------------ *
 * Bootstrap of the platform owner account
 * ------------------------------------------------------------------ */

let bootstrapPromise = null;

export function ensureOwnerAccount() {
  if (!bootstrapPromise) bootstrapPromise = bootstrapOwner().catch((error) => { bootstrapPromise = null; throw error; });
  return bootstrapPromise;
}

async function bootstrapOwner() {
  const owners = await listDocs(USERS, { where: [["role", "==", "owner"]], limit: 1 });
  if (owners.length) return { created: false, username: owners[0].username };

  const password = config.ownerInitialPassword || generatePassword(16);
  try {
    const owner = await createUser({
      username: config.ownerUsername,
      password,
      displayName: config.ownerDisplayName,
      email: config.ownerEmail,
      role: "owner",
      mustChangePassword: true,
      createdBy: "bootstrap"
    });
    console.log(
      [
        "",
        "==================================================================",
        " สร้างบัญชีเจ้าของระบบ (owner) เรียบร้อยแล้ว",
        ` ชื่อผู้ใช้ : ${owner.username}`,
        ` รหัสผ่าน  : ${config.ownerInitialPassword ? "<ค่าจาก OWNER_INITIAL_PASSWORD>" : password}`,
        " ระบบจะบังคับให้เปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก",
        "==================================================================",
        ""
      ].join("\n")
    );
    return { created: true, username: owner.username, password: config.ownerInitialPassword ? null : password };
  } catch (error) {
    if (error instanceof ConflictError) return { created: false, username: config.ownerUsername };
    throw error;
  }
}
