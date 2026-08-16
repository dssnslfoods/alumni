/**
 * End-to-end smoke test against a running API.
 *
 *   node server/index.js &            # or: npm run server
 *   node scripts/smoke-test.mjs
 *
 * Exercises the whole chain: owner login, forced password change, creating an
 * admin, Excel import, public search/verify/submit with a photo, and export.
 */
import ExcelJS from "exceljs";
import sharp from "sharp";

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3001";
const OWNER_USERNAME = process.env.SMOKE_OWNER_USERNAME || "arpaket";
const OWNER_PASSWORD = process.env.SMOKE_OWNER_PASSWORD;
const NEW_OWNER_PASSWORD = process.env.SMOKE_NEW_OWNER_PASSWORD || "OwnerPass2569x";

if (!OWNER_PASSWORD) {
  console.error("ตั้งค่า SMOKE_OWNER_PASSWORD เป็นรหัสผ่านเริ่มต้นของ owner ที่พิมพ์ตอน bootstrap ก่อน");
  process.exit(1);
}

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

async function call(path, { method = "GET", token, body, headers = {}, raw = false } = {}) {
  const options = { method, headers: { ...headers } };
  if (token) options.headers.Authorization = `Bearer ${token}`;
  if (body instanceof FormData) options.body = body;
  else if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${path}`, options);
  if (raw) return { status: response.status, buffer: Buffer.from(await response.arrayBuffer()) };
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
  return { status: response.status, data };
}

async function buildWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("รายชื่อ");
  sheet.columns = [
    { header: "ชื่อ", key: "f" },
    { header: "นามสกุล", key: "l" },
    { header: "รุ่น", key: "b" },
    { header: "รหัสนิสิต", key: "s" },
    { header: "เลขท้ายบัตรประชาชน 5 หลัก", key: "i" }
  ];
  sheet.addRow({ f: "สมชาย", l: "ใจดี", b: 45, s: "2676061", i: "12345" });
  sheet.addRow({ f: "สุดา", l: "เรืองรอง", b: 45, s: "2676062", i: "23456" });
  sheet.addRow({ f: "กิตติ", l: "วัฒนกุล", b: 46, s: "2677063", i: "34567" });
  sheet.addRow({ f: "", l: "ไม่มีชื่อ", b: 46, s: "2677064", i: "45678" });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function main() {
  console.log(`\nSmoke test → ${BASE}\n`);

  console.log("health");
  const health = await call("/api/health");
  check("GET /api/health", health.status === 200 && health.data.ok, health.data);

  console.log("\nauth");
  const badLogin = await call("/api/auth/login", { method: "POST", body: { username: OWNER_USERNAME, password: "wrong-password-1" } });
  check("รหัสผ่านผิดถูกปฏิเสธ", badLogin.status === 401, badLogin.data);

  const login = await call("/api/auth/login", { method: "POST", body: { username: OWNER_USERNAME, password: OWNER_PASSWORD } });
  check("owner เข้าสู่ระบบได้", login.status === 200 && Boolean(login.data.token), login.data);
  check("owner ถูกบังคับเปลี่ยนรหัสผ่าน", login.data.user?.mustChangePassword === true);
  let ownerToken = login.data.token;

  const blocked = await call("/api/admin/summary", { token: ownerToken });
  check("ถูกบล็อกก่อนเปลี่ยนรหัสผ่าน", blocked.status === 403, blocked.data);

  const weak = await call("/api/auth/change-password", { method: "POST", token: ownerToken, body: { currentPassword: OWNER_PASSWORD, newPassword: "short" } });
  check("รหัสผ่านอ่อนถูกปฏิเสธ", weak.status === 400, weak.data);

  const changed = await call("/api/auth/change-password", { method: "POST", token: ownerToken, body: { currentPassword: OWNER_PASSWORD, newPassword: NEW_OWNER_PASSWORD } });
  check("เปลี่ยนรหัสผ่านสำเร็จ", changed.status === 200 && Boolean(changed.data.token), changed.data);
  ownerToken = changed.data.token;

  const staleToken = login.data.token;
  const stale = await call("/api/auth/me", { token: staleToken });
  check("token เดิมถูกเพิกถอนหลังเปลี่ยนรหัสผ่าน", stale.status === 401, stale.data);

  console.log("\nuser management");
  const created = await call("/api/admin/users", {
    method: "POST",
    token: ownerToken,
    body: { username: `admin.test${Date.now() % 100000}`, displayName: "ผู้ดูแลทดสอบ", role: "admin" }
  });
  check("owner สร้าง admin ได้", created.status === 201 && Boolean(created.data.initialPassword), created.data);

  const staff = await call("/api/admin/users", {
    method: "POST",
    token: ownerToken,
    body: { username: `staff.test${Date.now() % 100000}`, displayName: "ตัวแทนรุ่น 45", role: "staff", batchScope: [45] }
  });
  check("owner สร้าง staff พร้อมกำหนดรุ่นได้", staff.status === 201 && staff.data.user?.batchScope?.[0] === 45, staff.data);

  const adminLogin = await call("/api/auth/login", { method: "POST", body: { username: created.data.user.username, password: created.data.initialPassword } });
  check("admin ใหม่เข้าสู่ระบบได้", adminLogin.status === 200, adminLogin.data);
  const adminFirstToken = adminLogin.data.token;
  const adminChanged = await call("/api/auth/change-password", { method: "POST", token: adminFirstToken, body: { currentPassword: created.data.initialPassword, newPassword: "AdminPass2569x" } });
  check("admin เปลี่ยนรหัสผ่านได้", adminChanged.status === 200, adminChanged.data);
  const adminToken = adminChanged.data.token;

  const escalation = await call("/api/admin/users", { method: "POST", token: adminToken, body: { username: "should.fail", role: "owner", password: "Whatever12345" } });
  check("admin สร้างบัญชี owner ไม่ได้", escalation.status === 403, escalation.data);

  const staffLogin = await call("/api/auth/login", { method: "POST", body: { username: staff.data.user.username, password: staff.data.initialPassword } });
  const staffChanged = await call("/api/auth/change-password", { method: "POST", token: staffLogin.data.token, body: { currentPassword: staff.data.initialPassword, newPassword: "StaffPass2569x" } });
  const staffToken = staffChanged.data.token;
  const staffUsers = await call("/api/admin/users", { token: staffToken });
  check("staff เข้าหน้าจัดการผู้ใช้ไม่ได้", staffUsers.status === 403, staffUsers.data);

  console.log("\nexcel import");
  const workbook = await buildWorkbook();
  const preview = new FormData();
  preview.append("dryRun", "true");
  preview.append("file", new Blob([workbook]), "alumni.xlsx");
  const dryRun = await call("/api/admin/import", { method: "POST", token: adminToken, body: preview });
  check("ทดลองนำเข้า (dry run) สำเร็จ", dryRun.status === 200 && dryRun.data.job?.validRows === 3, dryRun.data);
  check("แถวที่ข้อมูลไม่ครบถูกข้าม", dryRun.data.job?.skipped === 1, dryRun.data.job?.errors);

  const form = new FormData();
  form.append("file", new Blob([workbook]), "alumni.xlsx");
  const imported = await call("/api/admin/import", { method: "POST", token: adminToken, body: form });
  check("นำเข้า Excel จริงสำเร็จ", imported.status === 200 && imported.data.job?.inserted === 3, imported.data);

  const reimport = new FormData();
  reimport.append("file", new Blob([workbook]), "alumni.xlsx");
  const second = await call("/api/admin/import", { method: "POST", token: adminToken, body: reimport });
  check("นำเข้าซ้ำเป็นการอัปเดต ไม่สร้างซ้ำ", second.data.job?.updated === 3 && second.data.job?.inserted === 0, second.data.job);

  console.log("\npublic flow");
  const search = await call("/api/public/search", { method: "POST", body: { batch: "45", query: "สมชาย" } });
  check("ค้นหาชื่อเจอ", search.status === 200 && search.data.matches?.length >= 1, search.data);
  const target = search.data.matches?.[0];
  check("ผลค้นหาไม่มีข้อมูลบัตรประชาชน", target && !JSON.stringify(target).includes("idCard"), target);

  const wrongBatch = await call("/api/public/search", { method: "POST", body: { batch: "46", query: "สมชาย" } });
  check("ค้นหาข้ามรุ่นไม่เจอ", wrongBatch.data.matches?.length === 0, wrongBatch.data);

  const badVerify = await call("/api/public/verify", { method: "POST", body: { alumniId: target.id, idCardLast5: "00000" } });
  check("ยืนยันด้วยเลขผิดถูกปฏิเสธ", badVerify.status === 404, badVerify.data);

  const verified = await call("/api/public/verify", { method: "POST", body: { alumniId: target.id, idCardLast5: "12345" } });
  check("ยืนยันตัวตนสำเร็จ", verified.status === 200 && Boolean(verified.data.submitToken), verified.data);
  check("ข้อมูลที่ส่งกลับไม่มี hash บัตรประชาชน", !JSON.stringify(verified.data.alum || {}).includes("idCardLast5Hash"));

  const photo = await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 210, g: 190, b: 160 } } }).jpeg().toBuffer();
  const submission = new FormData();
  submission.append("currentFirstName", "สมชาย");
  submission.append("currentLastName", "ใจงาม");
  submission.append("bio", "เภสัชกรประจำโรงพยาบาล");
  submission.append("photoChoice", "upload");
  submission.append("contacts", JSON.stringify([{ type: "line", value: "somchai_line" }, { type: "phone", value: "0812345678" }]));
  submission.append("pdpaConsent", "yes");
  submission.append("photo", new Blob([photo]), "me.jpg");
  const submitted = await call("/api/public/submit", { method: "POST", headers: { "x-submit-token": verified.data.submitToken }, body: submission });
  check("ส่งข้อมูลพร้อมรูปสำเร็จ (multipart)", submitted.status === 200 && submitted.data.ok, submitted.data);
  check("ได้ลิงก์รูปกลับมา", Boolean(submitted.data.photoUrl), submitted.data);

  const noConsent = new FormData();
  noConsent.append("currentFirstName", "สมชาย");
  noConsent.append("currentLastName", "ใจงาม");
  noConsent.append("photoChoice", "placeholder");
  noConsent.append("contacts", "[]");
  noConsent.append("pdpaConsent", "no");
  const rejected = await call("/api/public/submit", { method: "POST", headers: { "x-submit-token": verified.data.submitToken }, body: noConsent });
  check("ไม่ยินยอม PDPA ถูกปฏิเสธ", rejected.status === 400, rejected.data);

  const noToken = await call("/api/public/submit", { method: "POST", body: noConsent });
  check("ส่งข้อมูลโดยไม่มี token ถูกปฏิเสธ", noToken.status === 401, noToken.data);

  console.log("\nadmin views");
  const summary = await call("/api/admin/summary", { token: adminToken });
  check("สรุปข้อมูลถูกต้อง", summary.data.total === 3 && summary.data.submitted === 1, summary.data);

  const nameHistory = await call(`/api/admin/alumni/${target.id}`, { token: adminToken });
  check("เก็บประวัติการเปลี่ยนนามสกุล", nameHistory.data.record?.nameHistory?.length === 1, nameHistory.data.record?.nameHistory);

  const staffOutOfScope = await call("/api/admin/alumni?batch=46", { token: staffToken });
  check("staff ดูรุ่นนอกขอบเขตไม่ได้", staffOutOfScope.status === 403, staffOutOfScope.data);
  const staffInScope = await call("/api/admin/alumni?batch=45", { token: staffToken });
  check("staff ดูรุ่นของตนได้", staffInScope.status === 200 && staffInScope.data.records?.length === 2, staffInScope.data);

  const exported = await call("/api/admin/export.xlsx", { token: adminToken, raw: true });
  check("ส่งออก Excel ได้", exported.status === 200 && exported.buffer.length > 1000, exported.status);
  check("ไฟล์ส่งออกไม่มี hash บัตรประชาชน", !exported.buffer.includes("idCardLast5Hash"));

  const template = await call("/api/admin/import/template.xlsx", { token: adminToken, raw: true });
  check("ดาวน์โหลดเทมเพลตนำเข้าได้", template.status === 200 && template.buffer.length > 1000, template.status);

  const audits = await call("/api/admin/audit", { token: ownerToken });
  check("มี audit log บันทึกไว้", audits.data.logs?.length > 0, audits.data);
  check("audit log ไม่เก็บ IP แบบดิบ", !JSON.stringify(audits.data.logs || []).includes("127.0.0.1"));

  const anonymous = await call("/api/admin/summary");
  check("เข้าหน้าแอดมินโดยไม่ล็อกอินไม่ได้", anonymous.status === 401, anonymous.data);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
