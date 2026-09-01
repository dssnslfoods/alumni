import crypto from "node:crypto";
import { promisify } from "node:util";
import { config } from "./env.js";

const scrypt = promisify(crypto.scrypt);
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Hash a password with scrypt. Returns a self-describing string. */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const [algo, N, r, p, salt, digest] = stored.split("$");
  if (algo !== "scrypt") return false;
  const expected = Buffer.from(digest, "base64");
  const derived = await scrypt(String(password).normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p)
  });
  return crypto.timingSafeEqual(expected, derived);
}

export function generateVerificationCode(entryYear, seq) {
  return `${entryYear}${String(seq).padStart(3, "0")}`;
}

export function safeEquals(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

/** Minimal HS256 JWT — no third-party dependency, no algorithm confusion. */
export function signToken(payload, { expiresInSeconds }) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify(body));
  const signature = crypto.createHmac("sha256", config.jwtSecret).update(`${header}.${claims}`).digest("base64url");
  return `${header}.${claims}.${signature}`;
}

export function verifyToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [header, claims, signature] = parts;
  const expected = crypto.createHmac("sha256", config.jwtSecret).update(`${header}.${claims}`).digest("base64url");
  if (!safeEquals(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(claims, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

const LETTERS = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";

function randomFrom(alphabet) {
  return alphabet[crypto.randomInt(alphabet.length)];
}

/** Always contains at least two letters and two digits, so it passes validatePassword. */
export function generatePassword(length = 14) {
  const size = Math.max(length, 12);
  const characters = [randomFrom(LETTERS), randomFrom(LETTERS), randomFrom(DIGITS), randomFrom(DIGITS)];
  const pool = LETTERS + DIGITS;
  while (characters.length < size) characters.push(randomFrom(pool));
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = crypto.randomInt(index + 1);
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  return characters.join("");
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
}

export function hashForLog(value) {
  if (!value) return "";
  return crypto.createHmac("sha256", config.idHashSecret).update(String(value)).digest("hex").slice(0, 16);
}
