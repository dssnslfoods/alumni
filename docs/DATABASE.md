# โครงสร้างฐานข้อมูล — ระบบหนังสืออนุสรณ์ สภจ. 2569

เอกสารนี้อธิบายโครงสร้าง Firestore ทั้งหมด สิทธิ์การเข้าถึง และเหตุผลของการออกแบบ

ทุก collection เข้าถึงได้ผ่าน backend เท่านั้น — `firestore.rules` และ `storage.rules`
ปฏิเสธการเข้าถึงจาก client โดยตรงทั้งหมด (`allow read, write: if false`)

---

## ภาพรวมความสัมพันธ์

```
usernames/{usernameLower} ──uid──► users/{uid} ──alumniId──► alumni/{alumniId}
                                                                   │
                                                                   ├──► alumniSubmissions/{alumniId}   (สำเนาไร้ PII สำหรับทีมออกแบบ)
                                                                   └──► Storage: yearbook-photos/batch-NN/...

importJobs/{jobId}   บันทึกผลการนำเข้า Excel แต่ละครั้ง
auditLogs/{logId}    บันทึกการกระทำของผู้ดูแล
settings/system      การตั้งค่าระบบ (เปิด/ปิดรับข้อมูล ฯลฯ)
```

---

## 1. `users/{uid}` — บัญชีผู้ใช้ระบบ

| ฟิลด์ | ชนิด | คำอธิบาย |
| --- | --- | --- |
| `id` / `uid` | string | รหัสสุ่ม เช่น `usr_9fK2...` |
| `username` | string | ตัวพิมพ์เล็ก 3-32 ตัว `[a-z0-9._-]` ไม่ซ้ำกันทั้งระบบ |
| `displayName` | string | ชื่อที่แสดงในหน้าจอ |
| `email` | string | ไม่บังคับ |
| `role` | string | `owner` \| `admin` \| `staff` \| `alumni` |
| `status` | string | `active` \| `suspended` |
| `batchScope` | number[] \| null | จำกัดสิทธิ์เฉพาะรุ่นที่ระบุ (ใช้กับ `staff`) `null` = ทั้งระบบ |
| `alumniId` | string \| null | ผูกกับระเบียนนิสิตเก่า (ใช้กับ role `alumni`) |
| `passwordHash` | string | `scrypt$N$r$p$salt$digest` — **ไม่เคยเก็บรหัสผ่านแบบอ่านได้** |
| `passwordUpdatedAt` | ISO string | |
| `mustChangePassword` | boolean | บังคับเปลี่ยนรหัสผ่านก่อนใช้งานระบบ |
| `tokenVersion` | number | เพิ่มค่าเพื่อเพิกถอน session ทั้งหมดทันที |
| `failedLoginCount` | number | นับความพยายามที่ล้มเหลว |
| `lockedUntil` | ISO string | ล็อกบัญชีชั่วคราวเมื่อผิดเกินกำหนด |
| `lastLoginAt` | ISO string | |
| `createdAt` / `createdBy` / `updatedAt` / `updatedBy` | | |

### `usernames/{usernameLower}` — บังคับความไม่ซ้ำของชื่อผู้ใช้

```js
{ id: "arpaket", uid: "usr_9fK2..." }
```

สร้างด้วย `create()` ซึ่งจะล้มเหลวถ้ามีเอกสารอยู่แล้ว จึงกันชื่อซ้ำได้แม้มีการสร้างพร้อมกัน

### ลำดับชั้นสิทธิ์

| บทบาท | ระดับ | ทำอะไรได้ |
| --- | --- | --- |
| `owner` | 40 | ทุกอย่าง รวมถึงสร้าง/แก้ไข/ลบ `admin` |
| `admin` | 30 | นำเข้า-ส่งออก แก้ไขระเบียนนิสิตเก่า ตั้งค่าระบบ สร้าง `staff` และ `alumni` |
| `staff` | 20 | ดูและตรวจสอบข้อมูลเฉพาะรุ่นใน `batchScope` (อ่านอย่างเดียว) |
| `alumni` | 10 | แก้ไขข้อมูลของตนเองเท่านั้น |

กฎสำคัญที่บังคับในโค้ด (`assertCanManage`):
สร้างหรือแก้ไขได้เฉพาะบัญชีที่ **ระดับต่ำกว่าตนเอง** เท่านั้น และไม่มีใครสร้างบัญชี `owner` ผ่าน API ได้

---

## 2. `alumni/{alumniId}` — ระเบียนหลักของนิสิตเก่า (ข้อมูลส่วนบุคคล)

**รหัสเอกสารเป็นค่าคงที่** เพื่อให้นำเข้า Excel ซ้ำเป็นการอัปเดต ไม่ใช่การสร้างซ้ำ:

- มีรหัสนิสิต → `s-{รหัสนิสิต}` เช่น `s-2676061`
- ไม่มีรหัสนิสิต → `n-{sha1(รุ่น|ชื่อ|นามสกุล) 16 ตัวแรก}`

### ฟิลด์ที่ "เป็นของ" ไฟล์ Excel (ถูกเขียนทับทุกครั้งที่นำเข้า)

| ฟิลด์ | ชนิด | คำอธิบาย |
| --- | --- | --- |
| `studentId` | string | ตัวเลขล้วน |
| `batch` | number | 1-88 (เป็น **ตัวเลข** ไม่ใช่ string เพื่อให้เรียงและ query ถูกต้อง) |
| `title` | string | คำนำหน้า |
| `legalFirstName` / `legalLastName` | string | ชื่อ-นามสกุลสมัยเรียน |
| `searchFirst` / `searchLast` / `searchFull` | string | คีย์ค้นหา: ตัดช่องว่าง + lowercase + NFC |
| `idCardLast5Hash` | string | **HMAC-SHA256** ของเลขท้ายบัตร 5 หลัก ด้วย `ID_HASH_SECRET` |

> เลข 5 หลักมีความเป็นไปได้เพียง 100,000 แบบ การเก็บ hash เปล่า ๆ จะถูก brute-force ได้ในเสี้ยววินาที
> จึงต้องใช้ HMAC ที่มี secret ฝั่ง server (pepper) ฐานข้อมูลที่รั่วไหลจึงย้อนกลับเป็นเลขเดิมไม่ได้

### ฟิลด์ที่ "เป็นของ" นิสิตเก่า (นำเข้าซ้ำจะไม่ทับ)

| ฟิลด์ | ชนิด | คำอธิบาย |
| --- | --- | --- |
| `currentFirstName` / `currentLastName` | string | ชื่อที่จะใช้ในหนังสือ |
| `nameHistory` | array | `[{ fullName, changedAt, changedBy }]` เก็บประวัติชื่อเดิมทุกครั้งที่เปลี่ยน |
| `status` | string | `pending` \| `submitted` \| `declined` |
| `photo` | object \| null | `{ choice, bucket, storagePath, downloadUrl, width, height, bytes, updatedAt }` |
| `contacts` | array | `[{ type, value }]` — type คือ `facebook` \| `instagram` \| `line` \| `phone` |
| `bio` | string | ไม่เกิน 500 ตัวอักษร (ปรับได้ที่ `settings`) |
| `pdpa` | object | `{ consent, consentAt, version }` |
| `submittedAt` | ISO string | |
| `reviewedBy` / `reviewNote` | string | สำหรับผู้ดูแลบันทึกการตรวจสอบ |
| `source` | object | `{ importJobId, rowNumber, filename }` ใช้ตามรอยกลับไปยังไฟล์ต้นทาง |
| `outreach` | object | `{ email, phone, note }` ช่องทางที่ผู้ดูแลใช้ติดตามงาน — **คนละส่วนกับ `contacts`** |

---

## 3. `alumniSubmissions/{alumniId}` — สำเนาสำหรับทีมออกแบบ

สำเนาของระเบียนข้างต้นที่ **ตัด `idCardLast5Hash`, `source` และ `outreach` ออก** เขียนทับทุกครั้งที่มีการส่งข้อมูลหรือผู้ดูแลแก้ไข
มีไว้เพื่อให้แชร์สิทธิ์อ่านให้ทีมออกแบบได้ในอนาคตโดยไม่แตะข้อมูลยืนยันตัวตน

---

## 4. `importJobs/{jobId}` — ประวัติการนำเข้า Excel

```js
{
  jobId, filename, headers: [...], dryRun,
  startedAt, finishedAt, status,
  uploadedBy, uploadedByUsername,
  totalRows, validRows, inserted, updated, duplicateRows, skipped,
  errors: [{ rowNumber, errors: ["ไม่มีชื่อ", ...] }]   // เก็บสูงสุด 200 แถว
}
```

`errors` เก็บเฉพาะหมายเลขแถวและสาเหตุ **ไม่เก็บเนื้อหาข้อมูลในแถวนั้น**

---

## 5. `auditLogs/{logId}` — บันทึกการใช้งาน

```js
{ at, action, actorUid, actorUsername, actorRole, targetType, targetId, meta, ipHash }
```

`ipHash` เป็น HMAC 16 ตัวอักษรแรก — ใช้จับรูปแบบพฤติกรรมได้ แต่ย้อนกลับเป็น IP จริงไม่ได้

action ที่บันทึก: `auth.login.success` / `auth.login.failed` / `auth.password.changed` /
`auth.owner.emergencyReset` / `users.create` / `users.update` / `users.delete` /
`users.resetPassword` / `alumni.import` / `alumni.import.preview` / `alumni.update` /
`alumni.export` / `settings.update` / `public.verify.success` / `public.verify.failed` /
`public.submit` / `public.decline`

---

## 6. `settings/system` — การตั้งค่าระบบ

```js
{
  submissionOpen: true,        // ปิดรับข้อมูลได้เมื่อถึงกำหนด
  closedMessage: "...",
  maxBatch: 88,
  pdpaVersion: "yearbook-2569-v1",
  bookTitle: "หนังสืออนุสรณ์ สภจ. 2569",
  bioMaxLength: 500,
  updatedAt, updatedBy
}
```

---

## Composite indexes

กำหนดไว้ใน `firestore.indexes.json` และ deploy ด้วย `firebase deploy --only firestore:indexes`

| Collection | ฟิลด์ | ใช้กับ |
| --- | --- | --- |
| `alumni` | `batch` ASC, `searchFirst` ASC | ค้นหาชื่อแบบขึ้นต้น |
| `alumni` | `batch` ASC, `searchLast` ASC | ค้นหานามสกุลแบบขึ้นต้น |
| `alumni` | `batch` ASC, `status` ASC | หน้ารายชื่อของผู้ดูแล |
| `users` | `role` ASC, `status` ASC | หน้าจัดการผู้ใช้ |
| `auditLogs` | `action` ASC, `at` DESC | กรองบันทึกตามประเภท |

### วิธีค้นหาชื่อให้รองรับ 10,000 รายชื่อ

1. กรองด้วย `batch` ก่อนเสมอ (เฉลี่ยเหลือ ~120 รายชื่อต่อรุ่น)
2. ใช้ range query `searchFirst >= q` และ `<= q + "\uf8ff"` — เป็นการค้นแบบขึ้นต้นที่ใช้ index จริง
3. ถ้าผลลัพธ์ยังไม่ครบ จึงดึงทั้งรุ่น (สูงสุด 1,000 รายการ) มากรองแบบ substring

ขั้นที่ 1-2 ครอบคลุมการใช้งานจริงเกือบทั้งหมด ขั้นที่ 3 เป็นตาข่ายรองรับกรณีพิมพ์กลางชื่อ

---

## Firebase Storage

```
yearbook-photos/batch-45/2676061_สมชาย_ใจงาม_1755351234567.jpg
```

- รูปถูก normalize ก่อนเสมอ: หมุนตาม EXIF, ตัด metadata, ย่อให้อยู่ใน 1600×1600, แปลงเป็น JPEG คุณภาพ 88
- ประเภทไฟล์ตรวจจาก **ผลการถอดรหัสจริงด้วย sharp** ไม่เชื่อ MIME type ที่ browser ส่งมา
- `downloadUrl` มี access token ฝังอยู่ → **ถือเป็นข้อมูลลับ** ห้ามเผยแพร่ต่อสาธารณะ
- เมื่อผู้ใช้อัปโหลดรูปใหม่หรือเปลี่ยนไปใช้ภาพคณะ ระบบจะลบไฟล์เดิมออกอัตโนมัติ

---

## โหมดพัฒนาแบบไม่ใช้ Firebase

เมื่อ `FIREBASE_ENABLED=false` ระบบใช้ไฟล์ JSON ที่ `data/db/<collection>.json` แทน
ผ่าน adapter เดียวกัน (`server/lib/db.js`) ที่รองรับ `where` / `orderBy` / `limit` / `count`
โค้ดฝั่ง domain และ route จึงไม่ต้องรู้เลยว่ากำลังคุยกับที่เก็บข้อมูลแบบใด

---

## `outreach` กับ `contacts` — อย่าสับสน

ระบบเก็บช่องทางติดต่อสองชุดที่มีฐานทางกฎหมายต่างกัน แยกจากกันอย่างเด็ดขาด

| | `outreach` | `contacts` |
| --- | --- | --- |
| ที่มา | ผู้ดูแลนำเข้าจากไฟล์ Excel | นิสิตเก่ากรอกเองในระบบ |
| วัตถุประสงค์ | ติดตามให้มากรอกข้อมูล | เผยแพร่ในหนังสืออนุสรณ์ |
| คำยินยอม PDPA | ไม่ได้ขอเพื่อการเผยแพร่ | ขอและบันทึกไว้ชัดเจน |
| อยู่ใน `alumniSubmissions` | ❌ ถูกตัดออก | ✅ |
| อยู่ในไฟล์ส่งออกทีมออกแบบ | ❌ | ✅ |
| อยู่ในไฟล์ส่งออกติดตามงาน | ✅ (owner/admin เท่านั้น) | ✅ |
| นิสิตเก่าเห็นผ่าน API | ❌ `selfView()` ตัดออก | ✅ |

หากเผลอเอา `outreach` ไปลงหนังสือ จะเป็นการเผยแพร่ข้อมูลส่วนบุคคลโดยไม่มีคำยินยอม
โค้ดจึงตัดออกใน 3 จุด (`syncSubmission`, `selfView`, `buildExportWorkbook` ค่าเริ่มต้น)
