import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const rootDir = path.join(__dirname, "..", "..");
export const dataDir = path.join(rootDir, "data");
export const localDbDir = path.join(dataDir, "db");
export const uploadsDir = path.join(rootDir, "uploads");

fs.mkdirSync(localDbDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

export const isCloudFunction = Boolean(process.env.FUNCTION_TARGET);
export const isProduction = isCloudFunction || process.env.NODE_ENV === "production";
export const firebaseEnabled = process.env.FIREBASE_ENABLED === "true" || isCloudFunction;

/**
 * Development-only secrets. Persisted so that restarting `npm run dev` does not
 * invalidate every issued token. Never used when running in production.
 */
const devSecretsPath = path.join(dataDir, ".dev-secrets.json");

function devSecret(name) {
  const store = fs.existsSync(devSecretsPath) ? JSON.parse(fs.readFileSync(devSecretsPath, "utf8")) : {};
  if (!store[name]) {
    store[name] = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(devSecretsPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  }
  return store[name];
}

function secret(name) {
  const value = String(process.env[name] || "").trim();
  if (value) return value;
  if (isProduction) return "";
  return devSecret(name);
}

export const config = {
  // Secrets
  jwtSecret: secret("AUTH_JWT_SECRET"),
  idHashSecret: secret("ID_HASH_SECRET"),
  emergencyKey: String(process.env.ADMIN_ACCESS_KEY || "").trim(),

  // Bootstrap owner
  ownerUsername: String(process.env.OWNER_USERNAME || "arpaket").trim().toLowerCase(),
  ownerDisplayName: String(process.env.OWNER_DISPLAY_NAME || "เจ้าของระบบ").trim(),
  ownerEmail: String(process.env.OWNER_EMAIL || "arpaket@gmail.com").trim().toLowerCase(),
  ownerInitialPassword: String(process.env.OWNER_INITIAL_PASSWORD || "").trim(),

  // Collections
  collections: {
    users: process.env.FIREBASE_USERS_COLLECTION || "users",
    usernames: process.env.FIREBASE_USERNAMES_COLLECTION || "usernames",
    alumni: process.env.FIREBASE_ALUMNI_COLLECTION || "alumni",
    submissions: process.env.FIREBASE_SUBMISSIONS_COLLECTION || "alumniSubmissions",
    importJobs: process.env.FIREBASE_IMPORT_JOBS_COLLECTION || "importJobs",
    auditLogs: process.env.FIREBASE_AUDIT_COLLECTION || "auditLogs",
    settings: process.env.FIREBASE_SETTINGS_COLLECTION || "settings"
  },

  // Storage
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "alumni-13428.firebasestorage.app",
  storageFolder: process.env.FIREBASE_STORAGE_FOLDER || "yearbook-photos",

  // Policy
  sessionHours: Number(process.env.AUTH_SESSION_HOURS || 8),
  maxLoginFailures: Number(process.env.AUTH_MAX_LOGIN_FAILURES || 8),
  lockoutMinutes: Number(process.env.AUTH_LOCKOUT_MINUTES || 15),
  minPasswordLength: Number(process.env.AUTH_MIN_PASSWORD_LENGTH || 6),
  maxBatch: Number(process.env.YEARBOOK_MAX_BATCH || 88),
  pdpaVersion: process.env.PDPA_VERSION || "yearbook-2569-v1",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024)
};

export function assertRuntimeConfig() {
  const missing = [];
  if (!config.jwtSecret) missing.push("AUTH_JWT_SECRET");
  if (!config.idHashSecret) missing.push("ID_HASH_SECRET");
  if (missing.length) {
    throw new Error(`ขาดการตั้งค่า secret ที่จำเป็น: ${missing.join(", ")}`);
  }
}
