/**
 * Create (or report) the platform-owner account without starting the API.
 *
 *   npm run owner                       # local JSON store
 *   FIREBASE_ENABLED=true \
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json npm run owner
 *
 * Safe to run repeatedly: it never overwrites an existing owner account.
 */
import { assertRuntimeConfig, config } from "../server/lib/env.js";
import { usingFirestore } from "../server/lib/db.js";
import { ensureOwnerAccount, listUsers } from "../server/domain/users.js";

assertRuntimeConfig();

const result = await ensureOwnerAccount();

console.log(`\nที่เก็บข้อมูล : ${usingFirestore ? "Firestore" : "ไฟล์ JSON ที่ data/db"}`);

if (result.created) {
  console.log(`สร้างบัญชีเจ้าของระบบใหม่แล้ว: ${result.username}`);
  if (result.password) console.log(`รหัสผ่านเริ่มต้น: ${result.password}   (แสดงครั้งเดียว)`);
  else console.log("รหัสผ่านเริ่มต้น: ใช้ค่าจาก OWNER_INITIAL_PASSWORD");
  console.log("ระบบจะบังคับให้เปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก");
} else {
  console.log(`มีบัญชีเจ้าของระบบอยู่แล้ว: ${result.username}`);
  console.log("หากลืมรหัสผ่าน ให้ตั้ง ADMIN_ACCESS_KEY แล้วเรียก POST /api/auth/emergency-owner-reset");
}

const users = await listUsers({ limit: 500 });
console.log(`\nบัญชีทั้งหมดในระบบ (${users.length}):`);
users.forEach((user) => console.log(`  ${user.username.padEnd(24)} ${user.role.padEnd(8)} ${user.status}`));
console.log(`\nURL หน้าเข้าสู่ระบบ: /admin   (รุ่นสูงสุดที่รองรับ: ${config.maxBatch})\n`);

process.exit(0);
