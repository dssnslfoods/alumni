# Alumni Yearbook System — Development Handoff

ระบบเว็บสำหรับเก็บข้อมูลนิสิตเก่า เพื่อจัดทำหนังสืออนุสรณ์ 2569
สมาคมนิสิตเก่าคณะเภสัชศาสตร์ จุฬาลงกรณ์มหาวิทยาลัย

**เวอร์ชัน 2.0** — เพิ่มระบบยืนยันตัวตนผู้ใช้จริง (username/password + RBAC),
ออกแบบโครงสร้างฐานข้อมูลใหม่ทั้งหมด และแก้ปัญหาการอัปโหลดไฟล์บน Cloud Functions

---

## 1. เริ่มต้นใช้งานภายใน 3 นาที

```bash
npm install
cp .env.example .env
npm run dev
```

เปิด `http://localhost:5173` (หน้าสาธารณะ) และ `http://localhost:5173/admin` (หน้าผู้ดูแล)

ครั้งแรกที่ระบบทำงาน จะสร้าง **บัญชีเจ้าของระบบ** ให้อัตโนมัติ และพิมพ์รหัสผ่านออกทาง terminal:

```text
==================================================================
 สร้างบัญชีเจ้าของระบบ (owner) เรียบร้อยแล้ว
 ชื่อผู้ใช้ : arpaket
 รหัสผ่าน  : <สุ่ม 16 ตัวอักษร — แสดงครั้งเดียว>
 ระบบจะบังคับให้เปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก
==================================================================
```

ถ้าพลาดไป ให้ดูสถานะบัญชีได้ทุกเมื่อด้วย:

```bash
npm run owner
```

จากบัญชี owner นี้ ให้เข้า `/admin` → แท็บ **ผู้ใช้งานระบบ** เพื่อสร้าง `admin`, `staff` (ตัวแทนรุ่น)
และบัญชี `alumni` ต่อไปได้

---

## 2. โครงสร้างไฟล์

| ไฟล์ / โฟลเดอร์ | หน้าที่ |
| --- | --- |
| `server/lib/env.js` | โหลดและตรวจสอบการตั้งค่าทั้งหมด, สร้าง dev secret อัตโนมัติ |
| `server/lib/crypto.js` | scrypt (รหัสผ่าน), HMAC (เลขบัตร/IP), JWT HS256 แบบไม่พึ่ง library |
| `server/lib/db.js` | Data adapter — สลับระหว่าง Firestore กับไฟล์ JSON ได้โดย domain ไม่ต้องรู้ |
| `server/lib/multipart.js` | ตัวอ่าน multipart ที่ทำงานได้ทั้งบน Node ปกติและ Cloud Functions |
| `server/lib/http.js` | ApiError, async route wrapper, rate limiter |
| `server/lib/audit.js` | บันทึก audit log แบบไม่เก็บข้อมูลส่วนบุคคล |
| `server/domain/users.js` | RBAC, การสร้าง/แก้ไขบัญชี, การเข้าสู่ระบบ, bootstrap owner |
| `server/domain/alumni.js` | schema ระเบียนนิสิตเก่า, การค้นหา, ประวัติชื่อ, สรุปสถิติ |
| `server/domain/excel.js` | นำเข้า/ส่งออก Excel, เทมเพลตนำเข้า |
| `server/domain/photos.js` | normalize รูปด้วย sharp และอัปโหลดขึ้น Storage |
| `server/domain/settings.js` | การตั้งค่าระบบ |
| `server/middleware/auth.js` | ตรวจ token, บังคับเปลี่ยนรหัสผ่าน, ตรวจสิทธิ์, จำกัดขอบเขตรุ่น |
| `server/routes/{auth,public,admin}.js` | REST API |
| `src/main.jsx` | เราเตอร์และการจัดการ session ฝั่ง client |
| `src/pages/Yearbook.jsx` | ขั้นตอนกรอกข้อมูลของนิสิตเก่า |
| `src/pages/Login.jsx` | หน้าเข้าสู่ระบบ และหน้าเปลี่ยนรหัสผ่าน |
| `src/pages/Console.jsx` | หน้าจัดการ 6 แท็บสำหรับผู้ดูแล |
| `scripts/create-owner.mjs` | สร้าง/ตรวจสอบบัญชีเจ้าของระบบ |
| `scripts/smoke-test.mjs` | ทดสอบ end-to-end 69 รายการ
| `server/domain/sample-data.js` | ตัวสร้างข้อมูลสมมติสำหรับทดสอบ (ใช้ร่วมกันระหว่าง API กับสคริปต์) |
| `scripts/generate-sample-data.mjs` | เขียนไฟล์ Excel ข้อมูลสมมติลงโฟลเดอร์ `outputs/` |
| `docs/DATABASE.md` | **เอกสารโครงสร้างฐานข้อมูลฉบับเต็ม** |

---

## 3. ระบบยืนยันตัวตนและสิทธิ์

### บทบาท

| บทบาท | สิทธิ์ |
| --- | --- |
| `owner` | ทุกอย่าง รวมถึงสร้าง/ลบบัญชี `admin` — มีได้บัญชีเดียว สร้างผ่าน API ไม่ได้ |
| `admin` | นำเข้า/ส่งออก แก้ไขระเบียน ตั้งค่าระบบ ดู audit log สร้าง `staff` และ `alumni` |
| `staff` | ตัวแทนรุ่น — ดูข้อมูลเฉพาะรุ่นที่กำหนดใน `batchScope` |
| `alumni` | แก้ไขข้อมูลของตนเองเท่านั้น |

กฎที่บังคับในโค้ด: **จัดการได้เฉพาะบัญชีที่ระดับต่ำกว่าตนเอง** — `admin` จึงสร้าง `admin` คนอื่นไม่ได้

### กลไกความปลอดภัย

- รหัสผ่าน hash ด้วย **scrypt** (N=16384, r=8, p=1) พร้อม salt สุ่มต่อบัญชี
- Session เป็น **JWT HS256** อายุ 8 ชั่วโมง ผูกกับ `tokenVersion` ของบัญชี
  → เปลี่ยนรหัสผ่านหรือเปลี่ยนบทบาทเมื่อใด token เดิมใช้ไม่ได้ทันที
- ล็อกบัญชีชั่วคราว 15 นาที เมื่อกรอกรหัสผ่านผิดครบ 8 ครั้ง + rate limit ระดับ IP
- บัญชีที่ระบบสุ่มรหัสผ่านให้ จะถูกบังคับเปลี่ยนรหัสผ่านก่อนใช้งาน (`mustChangePassword`)
- รหัสผ่านชั่วคราวแสดงในหน้าจอ **ครั้งเดียว** ไม่เคยถูกเก็บแบบอ่านได้
- **เปลี่ยนรหัสผ่านแล้วต้องเข้าสู่ระบบใหม่เสมอ** — API ไม่คืน token ใหม่ให้
  เพราะการหมุน token ระหว่างใช้งานเคยทำให้ request ที่ค้างอยู่ถือ token ที่ถูกเพิกถอนแล้ว
  แล้วโดน 401 จนระบบล้าง session ทิ้งกลางคัน

### กู้คืนบัญชี owner เมื่อลืมรหัสผ่าน

ตั้ง secret `ADMIN_ACCESS_KEY` ไว้ก่อน แล้วเรียก:

```bash
curl -X POST https://alumni-13428.web.app/api/auth/emergency-owner-reset \
  -H "x-emergency-key: <ADMIN_ACCESS_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"newPassword":"<รหัสผ่านใหม่อย่างน้อย 10 ตัว มีตัวอักษรและตัวเลข>"}'
```

ถ้าไม่ตั้ง `ADMIN_ACCESS_KEY` ไว้ endpoint นี้จะถูกปิดโดยสมบูรณ์

---

## 4. ฐานข้อมูล

รายละเอียดเต็มอยู่ที่ [`docs/DATABASE.md`](docs/DATABASE.md) — สรุปย่อ:

| Collection | เก็บอะไร |
| --- | --- |
| `users` | บัญชีผู้ใช้ระบบ (hash รหัสผ่าน, บทบาท, ขอบเขตรุ่น) |
| `usernames` | ดัชนีบังคับความไม่ซ้ำของชื่อผู้ใช้ |
| `alumni` | ระเบียนหลักของนิสิตเก่า + ข้อมูลที่กรอกเพื่อลงหนังสือ |
| `alumniSubmissions` | สำเนาไร้ข้อมูลยืนยันตัวตน สำหรับส่งต่อทีมออกแบบ |
| `importJobs` | ประวัติการนำเข้า Excel พร้อมรายการแถวที่ข้าม |
| `auditLogs` | บันทึกการกระทำของผู้ดูแล (IP เก็บเป็นค่าแฮช) |
| `settings` | เปิด/ปิดรับข้อมูล, เวอร์ชัน PDPA, ชื่อหนังสือ |

**การเปลี่ยนแปลงสำคัญจากเวอร์ชัน 1:**

1. `alumniReference` → `alumni` และ `alumniYearbookSubmissions` → `alumniSubmissions`
2. **เลขท้ายบัตรประชาชนไม่ถูกเก็บเป็นข้อความอีกต่อไป** เก็บเป็น HMAC-SHA256 ที่ใช้ `ID_HASH_SECRET`
   เป็น pepper ฝั่ง server — ฐานข้อมูลที่รั่วไหลจึงย้อนกลับเป็นเลขเดิมไม่ได้
3. `batch` เปลี่ยนจาก string เป็น **number**
4. รหัสเอกสารเป็นค่าคงที่ (`s-{รหัสนิสิต}`) → นำเข้าไฟล์เดิมซ้ำเป็นการอัปเดต ไม่สร้างข้อมูลซ้ำ
5. เพิ่ม `searchFirst` / `searchLast` เพื่อให้ค้นหาด้วย index จริงได้ที่ระดับหมื่นรายชื่อ

> ⚠️ ข้อมูลเก่าใน `alumniReference` ใช้กับเวอร์ชันนี้ไม่ได้ (โครงสร้างและการ hash ต่างกัน)
> ให้ **นำเข้าไฟล์ Excel ต้นฉบับใหม่อีกครั้ง** ผ่านหน้าผู้ดูแล แล้วจึงลบ collection เดิมทิ้ง
>
> ⚠️ หากเปลี่ยนค่า `ID_HASH_SECRET` ภายหลัง ทุกคนจะยืนยันตัวตนไม่ผ่าน ต้องนำเข้า Excel ใหม่ทั้งหมด

---

## 5. การนำเข้า Excel

หน้า `/admin` → แท็บ **นำเข้า / ส่งออก**

1. ดาวน์โหลดไฟล์ตั้งต้น — มีให้เลือก 2 แบบ
   - **ไฟล์ต้นแบบเปล่า** สำหรับกรอกข้อมูลจริง
   - **ไฟล์ตัวอย่างพร้อมข้อมูล 8,000 รายการ** (ข้อมูลสมมติ) สำหรับทดลองใช้งานที่ปริมาณจริง
2. เลือกไฟล์ `.xlsx` หรือ `.csv`
3. กด **1. ตรวจสอบไฟล์ก่อน** — ระบบอ่านไฟล์และรายงานผลโดยยังไม่บันทึกอะไร
4. เมื่อผลถูกต้องแล้วจึงกด **2. นำเข้าจริง** — จะมีแถบแสดงความคืบหน้าเป็นเปอร์เซ็นต์จริง

### แถบความคืบหน้าทำงานอย่างไร

การนำเข้าไม่ได้ยิงเป็น request เดียวแล้วรอ แต่แบ่งเป็น 3 ขั้น เพื่อให้รายงานความคืบหน้าได้จริง

| ขั้น | Endpoint | ทำอะไร |
| --- | --- | --- |
| 1 | `POST /api/admin/import/prepare` | อ่านและตรวจไฟล์ ส่งแถวที่ผ่านการตรวจกลับไปให้เบราว์เซอร์ **ยังไม่เขียนอะไร** |
| 2 | `POST /api/admin/import/chunk` | เบราว์เซอร์ส่งกลับมาทีละ 400 แถว server เขียนแล้วตอบจำนวนที่บันทึกจริง |
| 3 | `POST /api/admin/import/commit` | บันทึกสรุปลง `importJobs` และลง audit log |

แถบเลื่อนตามจำนวนก้อนที่ server ตอบกลับมาแล้วจริง ไม่ใช่การเดา

ข้อมูลที่วิ่งกลับไปกลับมาผ่านเบราว์เซอร์จึง **ไม่ถูกเชื่อถือ** — ขั้นที่ 2 ตรวจสอบทุกแถวซ้ำด้วยกฎเดียวกับตอน parse
(`validateImportValue`) แถวที่ถูกแก้ระหว่างทางจะถูกทิ้งและรายงานเป็น `rejected`

หากหลุดกลางคัน (เน็ตหลุด ปิดหน้าจอ) ก้อนที่บันทึกไปแล้วยังอยู่ครบ กด **นำเข้าจริง** ซ้ำได้เลย
เพราะรหัสเอกสารคงที่ การเขียนซ้ำจึงเป็นการอัปเดต ไม่สร้างข้อมูลซ้ำ

### คอลัมน์ที่รองรับ

ไฟล์ต้นแบบมี 2 ชีต — ชีต **รายชื่อนิสิตเก่า** (ว่าง พร้อม data validation) และชีต **คำแนะนำการกรอก**
(อธิบายทุกคอลัมน์พร้อมตัวอย่างและข้อควรระวัง PDPA) ตัวอย่างข้อมูลอยู่ในชีตคำแนะนำเท่านั้น
จึงไม่มีทางเผลอนำเข้าข้อมูลตัวอย่างเป็นคนจริง

| คอลัมน์ | ชื่อที่ยอมรับเพิ่มเติม | จำเป็น | หมายเหตุ |
| --- | --- | --- | --- |
| ชื่อ | `ชื่อจริง`, `ชื่อสมัยเรียน`, `firstname`, `name` | ✅ | ชื่อสมัยเรียน ใช้ค้นหา |
| นามสกุล | `สกุล`, `lastname`, `surname` | ✅ | นามสกุลสมัยเรียน ใช้ค้นหา |
| รุ่น | `รุ่นที่`, `batch`, `class`, `year` | ✅ | ตัวเลข 1-88 |
| เลขท้ายบัตรประชาชน 5 หลัก | `เลขท้ายบัตรประชาชน`, `id card last 5` | ✅ | เก็บเป็น HMAC ไม่เก็บตัวเลขจริง |
| รหัสนิสิต | `student id`, `studentid` | แนะนำอย่างยิ่ง | เป็นตัวระบุระเบียนถาวร |
| คำนำหน้า | `title`, `prefix` | — | |
| ชื่อปัจจุบัน | `current firstname` | — | เติมล่วงหน้าให้เฉพาะคนที่ยังไม่เคยกรอกเอง |
| นามสกุลปัจจุบัน | `current lastname` | — | เช่นเดียวกัน |
| อีเมลสำหรับติดต่อ | `อีเมล`, `email` | — | ผู้ดูแลใช้ติดตามงาน **ไม่ลงหนังสือ** |
| เบอร์โทรสำหรับติดต่อ | `เบอร์โทร`, `phone` | — | ผู้ดูแลใช้ติดตามงาน **ไม่ลงหนังสือ** |
| หมายเหตุ | `note`, `remark` | — | บันทึกภายใน |

**ลำดับคอลัมน์สลับกันได้** ระบบอ่านจากชื่อหัวคอลัมน์ และไม่สนใจคอลัมน์อื่นที่เพิ่มเข้ามาเอง

### กฎการเขียนทับข้อมูล

| ข้อมูล | นำเข้าซ้ำแล้วเกิดอะไร |
| --- | --- |
| ชื่อสมัยเรียน, รุ่น, รหัสนิสิต, เลขบัตร, อีเมล/เบอร์ติดตาม, หมายเหตุ | เขียนทับด้วยค่าจากไฟล์เสมอ (ไฟล์คือแหล่งข้อมูลจริง) |
| ชื่อปัจจุบัน จากไฟล์ | เติมให้เฉพาะระเบียนที่ยัง `pending` — ถ้าเจ้าตัวกรอกเองแล้ว ค่าของเจ้าตัวชนะเสมอ |
| รูปถ่าย, ประวัติโดยย่อ, ช่องทางติดต่อ, คำยินยอม PDPA, ประวัติชื่อ | **ไม่ถูกแตะต้อง** |

### ไฟล์ส่งออก 2 แบบ

| ปุ่ม | ได้อะไร | ใช้กับใคร |
| --- | --- | --- |
| **ไฟล์สำหรับทีมออกแบบ** | เฉพาะข้อมูลที่นิสิตเก่ายินยอมให้ลงหนังสือ | ส่งต่อทีมออกแบบได้ |
| **ไฟล์สำหรับติดตามงาน** | เพิ่มอีเมล/เบอร์โทร/หมายเหตุสำหรับติดตาม (เฉพาะ owner และ admin) | ใช้ภายในเท่านั้น ห้ามส่งต่อ |

---

## 6. API

### สาธารณะ (ไม่ต้องเข้าสู่ระบบ)

| Method | Path | หน้าที่ |
| --- | --- | --- |
| GET | `/api/health` | ตรวจสถานะระบบ |
| GET | `/api/public/settings` | การตั้งค่าที่เปิดเผยได้ |
| POST | `/api/public/search` | ค้นหาชื่อในรุ่นที่ระบุ (จำกัด 60 ครั้ง/10 นาที) |
| POST | `/api/public/verify` | ยืนยันด้วยเลขบัตร 5 หลัก → คืน `submitToken` อายุ 30 นาที |
| POST | `/api/public/submit` | ส่งข้อมูล + รูป (ต้องมี header `x-submit-token`) |
| POST | `/api/public/decline` | แจ้งไม่ประสงค์ลงหนังสือ |

การยืนยันตัวตนสำเร็จจะได้ **token ที่ผูกกับระเบียนเดียว** ทำให้เลขบัตรถูกส่งเพียงครั้งเดียวตลอดขั้นตอน

### ยืนยันตัวตน

| Method | Path |
| --- | --- |
| POST | `/api/auth/login` |
| GET | `/api/auth/me` |
| POST | `/api/auth/change-password` |
| POST | `/api/auth/emergency-owner-reset` |

### ผู้ดูแล (ต้องมี `Authorization: Bearer <token>`)

| Method | Path | สิทธิ์ที่ต้องมี |
| --- | --- | --- |
| GET | `/api/admin/summary` | `alumni.read` |
| GET | `/api/admin/alumni` | `alumni.read` |
| GET/PATCH | `/api/admin/alumni/:id` | `alumni.read` / `alumni.write` |
| GET | `/api/admin/users` | `users.manage` |
| POST | `/api/admin/users` | `users.manage` |
| PATCH/DELETE | `/api/admin/users/:uid` | `users.manage` |
| POST | `/api/admin/users/:uid/reset-password` | `users.manage` |
| POST | `/api/admin/import` | `alumni.import` |
| GET | `/api/admin/import/template.xlsx` | `alumni.import` |
| GET | `/api/admin/import/template.xlsx?rows=8000` | `alumni.import` (ไฟล์ตัวอย่างพร้อมข้อมูล สูงสุด 10,000 แถว) |
| POST | `/api/admin/reset` | `data.reset` (**owner เท่านั้น**) |
| GET | `/api/admin/import/jobs` | `alumni.import` |
| GET | `/api/admin/export.xlsx` | `alumni.export` |
| GET/PUT | `/api/admin/settings` | `settings.manage` |
| GET | `/api/admin/audit` | `audit.read` |

---

## 6.5 ล้างข้อมูลทั้งหมดก่อนเริ่มใช้งานจริง

หลังทดลองนำเข้าไฟล์ตัวอย่างแล้ว ให้ล้างข้อมูลทดสอบก่อนนำเข้าข้อมูลจริง

หน้า `/admin` → แท็บ **นำเข้า / ส่งออก** → เลื่อนลงล่างสุดถึงกล่องสีแดง **ล้างข้อมูลทั้งหมด**
พิมพ์ข้อความ `ล้างข้อมูลทั้งหมด` ให้ตรงทุกตัวอักษร แล้วกดปุ่ม

| | |
| --- | --- |
| **ถูกลบ** | `alumni`, `alumniSubmissions`, `importJobs` และรูปภาพทั้งหมดใน Storage |
| **ไม่ถูกลบ** | `users`, `settings`, `auditLogs` |
| **ใครทำได้** | `owner` เท่านั้น — `admin` เรียก endpoint นี้จะได้ 403 |

เก็บ `auditLogs` ไว้โดยตั้งใจ เพราะบันทึกที่ระบุว่ามีการล้างข้อมูลต้องรอดจากการล้างข้อมูลด้วย

> ⚠️ ย้อนกลับไม่ได้ ไม่มีถังขยะ ไม่มี undo — ถ้าต้องการสำรองข้อมูลก่อน ให้กด “ไฟล์สำหรับติดตามงาน” เพื่อส่งออกทุกอย่างเก็บไว้ก่อน

---

## 7. การ deploy ขึ้น Firebase

Firebase project: `alumni-13428` · Hosting: <https://alumni-13428.web.app>

### ครั้งแรก — ต้องตั้ง secret ก่อน มิฉะนั้น deploy จะล้มเหลว

```bash
firebase functions:secrets:set AUTH_JWT_SECRET --project alumni-13428
firebase functions:secrets:set ID_HASH_SECRET --project alumni-13428
firebase functions:secrets:set ADMIN_ACCESS_KEY --project alumni-13428
firebase functions:secrets:set OWNER_INITIAL_PASSWORD --project alumni-13428
```

สร้างค่าที่ปลอดภัยด้วย `openssl rand -hex 32` สำหรับสองตัวแรก

### deploy

```bash
npm run build
firebase deploy --project alumni-13428 \
  --only functions,hosting,firestore:rules,firestore:indexes,storage
```

หลัง deploy ครั้งแรก เรียก `GET /api/health` หนึ่งครั้งเพื่อให้ระบบสร้างบัญชี owner
แล้วเข้า `/admin` ด้วย username `arpaket` และรหัสผ่านจาก `OWNER_INITIAL_PASSWORD`

### โครงสร้าง infrastructure

- Firestore Native · `asia-southeast1`
- Storage bucket `alumni-13428.firebasestorage.app` · `asia-southeast1`
- Cloud Function `api` gen 2 · `asia-southeast1` · 1 GiB · timeout 540s
- Hosting rewrite `/api/**` → function `api`

Runtime อัปเกรดจาก Node.js 20 เป็น **Node.js 22** แล้ว (แก้ปัญหา Node 20 หมดอายุ)
Memory และ timeout ถูกเพิ่มเพื่อรองรับการนำเข้า Excel ระดับ 10,000 แถว

---

## 8. ✅ ปัญหา multipart upload ที่แก้แล้ว

ปัญหาเดิม: `POST /api/admin/import-excel` และการอัปโหลดรูปล้มเหลวบน Cloud Functions
ไฟล์ที่ส่งถึง ExcelJS ว่างเปล่าหรือไม่สมบูรณ์

**สาเหตุที่แท้จริง — มี 3 จุด:**

1. โค้ดเดิม resolve promise ที่ event **`finish`** ของ Busboy ซึ่งเป็น event ของ Writable stream
   ที่ยิงทันทีที่เขียนข้อมูลครบ — **ก่อน** ที่ handler `end` ของ file stream จะ push chunk สุดท้ายเสร็จ
   Busboy 1.x ใช้ event **`close`** เป็นสัญญาณว่าอ่านครบจริง
2. ใช้ `workbook.xlsx.readFile(path)` โดยเขียนไฟล์ลง disk ก่อน ซึ่งเชื่อถือไม่ได้บน Cloud Functions
3. มี middleware ที่ไป monkey-patch `req.pipe` ทำให้ stream ซ้อนกัน

**วิธีแก้ที่ใช้จริง** (`server/lib/multipart.js`):

- อ่านจาก `req.rawBody` เมื่อมี (Cloud Functions) และ pipe จาก `req` เมื่อไม่มี (Node ปกติ)
- รอทั้ง event `close` **และ** ตัวนับ file stream ที่ยังค้างอยู่ ก่อน resolve
- เก็บไฟล์เป็น buffer ในหน่วยความจำ ไม่แตะ disk เลย
- Excel: `workbook.xlsx.load(buffer)` / รูป: ส่ง buffer เข้า `sharp()` โดยตรง แล้ว `bucket.file().save(buffer)`
- ตัด `multer` ออกจากโปรเจกต์ทั้งหมด

ผลลัพธ์: ยืนยันด้วย smoke test ว่าอัปโหลดทั้ง Excel และรูปภาพผ่านทั้งบนเครื่องและใน production runtime

---

## 9. การทดสอบ

```bash
# terminal 1
npm run server

# terminal 2 — ใช้รหัสผ่าน owner ที่พิมพ์ออกมาตอน bootstrap
SMOKE_OWNER_PASSWORD='<รหัสผ่านเริ่มต้น>' npm run smoke
```

ครอบคลุม 69 รายการ: การเข้าสู่ระบบ, การบังคับเปลี่ยนรหัสผ่าน, การเพิกถอน token,
การป้องกัน privilege escalation, ขอบเขตรุ่นของ `staff`, การนำเข้า Excel (dry run + จริง + ซ้ำ),
การค้นหา, การยืนยันตัวตน, การอัปโหลดรูปแบบ multipart, การส่งออกทั้งสองแบบ,
การแยกข้อมูลติดต่อภายในออกจากไฟล์ทีมออกแบบ, โครงสร้างเทมเพลต และ audit log

ถ้าต้องการเริ่มจากฐานข้อมูลว่าง: `rm -rf data/db && mkdir -p data/db`

---

## 10. งานที่ควรทำต่อ

1. **แจ้งเตือนทางอีเมล** เมื่อสร้างบัญชีใหม่ แทนการคัดลอกรหัสผ่านชั่วคราวด้วยมือ
2. **ดาวน์โหลดรูปทั้งรุ่นเป็น ZIP** สำหรับทีมออกแบบ (ควรทำเป็น job แยก ไม่ใช่ใน request เดียว)
3. **หน้าถอนความยินยอม PDPA** ให้นิสิตเก่าทำเองได้ พร้อม workflow อนุมัติ
4. **หน้าแก้ไขระเบียนแบบเต็ม** สำหรับผู้ดูแล (ตอนนี้แก้ได้เฉพาะสถานะจากตาราง)
5. **ย้าย rate limiter ไป Firestore หรือ Redis** — ปัจจุบันเก็บใน memory ของแต่ละ instance
   จึงหลวมขึ้นเมื่อ Cloud Function scale ออกหลาย instance
6. **สำรองข้อมูลอัตโนมัติ** ตั้ง scheduled export ของ Firestore
7. **ทดสอบโหลดจริงที่ 10,000 ระเบียน** เพื่อยืนยันเวลานำเข้าและต้นทุนการอ่าน

---

## 11. ข้อควรระวังด้านความปลอดภัย

- อย่า commit `.env`, service-account JSON หรือค่า secret ใด ๆ (`.gitignore` ครอบคลุมแล้ว)
- `data/db/` มีข้อมูลส่วนบุคคลจากการทดสอบ — อยู่ใน `.gitignore` แล้ว
- ลิงก์รูปใน Storage มี access token ฝังอยู่ → ไฟล์ Excel ที่ส่งออกถือเป็นข้อมูลลับ
- Cloud Run ของ function เปิดให้เรียกแบบสาธารณะ เพราะ Hosting ต้อง route เข้ามา
  การตรวจสิทธิ์ทั้งหมดจึงอยู่ที่ระดับ request — อย่าปิดหรือข้าม middleware `requirePermission`
- Firestore/Storage rules ปฏิเสธการเข้าถึงจาก client ทั้งหมด อย่าเปิดสิทธิ์เพิ่มโดยไม่จำเป็น
