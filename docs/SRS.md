# Software Requirements Specification (SRS)

## ระบบเก็บข้อมูลหนังสืออนุสรณ์ สภจ. 2569

**เวอร์ชัน:** 2.1
**วันที่:** 18 สิงหาคม 2569
**องค์กร:** สมาคมนิสิตเก่าคณะเภสัชศาสตร์ จุฬาลงกรณ์มหาวิทยาลัย

---

## 1. บทนำ

### 1.1 วัตถุประสงค์

เอกสารนี้ระบุข้อกำหนดของระบบเว็บสำหรับเก็บรวบรวมข้อมูลนิสิตเก่า เพื่อจัดทำหนังสืออนุสรณ์ สมาคมนิสิตเก่าคณะเภสัชศาสตร์ จุฬาลงกรณ์มหาวิทยาลัย ประจำปี 2569

### 1.2 ขอบเขต

ระบบครอบคลุม:
- การนำเข้าทะเบียนนิสิตเก่าจากไฟล์ Excel
- การให้นิสิตเก่าค้นหา ยืนยันตัวตน และกรอกข้อมูลด้วยตนเอง
- การจัดการบัญชีผู้ใช้และสิทธิ์ตามบทบาท (RBAC)
- การติดตามความคืบหน้าการเก็บข้อมูล
- การเตรียมไฟล์ส่งมอบให้ทีมออกแบบหนังสือ
- การปฏิบัติตาม PDPA

### 1.3 กลุ่มผู้ใช้

| กลุ่ม | คำอธิบาย |
| --- | --- |
| นิสิตเก่า (alumni) | ค้นหาชื่อ ยืนยันตัวตน กรอกข้อมูลและอัปโหลดรูปสำหรับลงหนังสือ |
| ตัวแทนรุ่น (staff) | ดูข้อมูลและบันทึกสถานะการติดตามเฉพาะรุ่นที่ดูแล |
| ผู้ดูแลระบบ (admin) | นำเข้า/ส่งออกข้อมูล แก้ไขระเบียน ตั้งค่าระบบ สร้างบัญชีผู้ใช้ |
| เจ้าของระบบ (owner) | สิทธิ์ทุกอย่าง รวมถึงจัดการ admin และล้างข้อมูล |
| ทีมออกแบบ | รับไฟล์ส่งมอบ (Excel, CSV, รูปถ่าย) เพื่อจัดทำหนังสือ |

### 1.4 คำจำกัดความ

| คำ | ความหมาย |
| --- | --- |
| รุ่น (batch) | ลำดับปีที่เข้าศึกษา เช่น รุ่น 1 = พ.ศ. 2484 |
| รหัสนิสิต | เลข 10 หลัก รูปแบบ `YY34SSSSSS` ตามมาตรฐานจุฬาฯ |
| ทะเบียน | ข้อมูลพื้นฐานของนิสิตเก่า (ชื่อ นามสกุล รุ่น รหัสนิสิต) ที่นำเข้าจากไฟล์ Excel |
| PDPA | พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 |

---

## 2. ข้อกำหนดเชิงหน้าที่ (Functional Requirements)

### 2.1 การนำเข้าข้อมูลทะเบียน (FR-IMPORT)

| รหัส | ข้อกำหนด |
| --- | --- |
| FR-IMPORT-01 | รองรับไฟล์ `.xlsx` และ `.csv` |
| FR-IMPORT-02 | อ่านชื่อคอลัมน์จากหัวตาราง รองรับชื่อภาษาไทยและอังกฤษ ลำดับคอลัมน์สลับได้ |
| FR-IMPORT-03 | ตรวจสอบไฟล์ก่อนนำเข้า (dry run) โดยไม่เขียนข้อมูล |
| FR-IMPORT-04 | แสดงแถบความคืบหน้าแบบเรียลไทม์ (chunk-based) |
| FR-IMPORT-05 | รหัสเอกสาร `s-{รหัสนิสิต}` คงที่ นำเข้าซ้ำเป็นการอัปเดต ไม่สร้างข้อมูลซ้ำ |
| FR-IMPORT-06 | คอลัมน์บังคับ: ชื่อ นามสกุล รุ่น รหัสเข้า |
| FR-IMPORT-07 | เตือนเมื่อรหัสนิสิตไม่ครบ 10 หลัก หรือหลักที่ 3-4 ไม่ใช่ 34 (แต่ไม่ปฏิเสธ) |
| FR-IMPORT-08 | ดาวน์โหลดไฟล์ต้นแบบเปล่า หรือไฟล์ตัวอย่างพร้อมข้อมูลสมมติ 10,000 รายการ |
| FR-IMPORT-09 | หยุดกลางคันแล้วกดนำเข้าซ้ำได้ ข้อมูลที่บันทึกไปแล้วไม่หาย |
| FR-IMPORT-10 | บันทึกประวัติการนำเข้าทุกครั้ง พร้อมรายการแถวที่ข้ามและเหตุผล |

### 2.2 ขั้นตอนของนิสิตเก่า (FR-ALUMNI)

| รหัส | ข้อกำหนด |
| --- | --- |
| FR-ALUMNI-01 | ค้นหาชื่อในรุ่นที่ระบุ ผลการค้นหาปกปิดรหัสนิสิตบางส่วน |
| FR-ALUMNI-02 | ยืนยันตัวตนด้วยรหัสเข้า (xxyyy) |
| FR-ALUMNI-03 | ได้รับ submit token อายุ 30 นาที ผูกกับระเบียนเดียว |
| FR-ALUMNI-04 | กรอกชื่อปัจจุบัน ประวัติโดยย่อ ช่องทางติดต่อ |
| FR-ALUMNI-05 | อัปโหลดรูปถ่าย หรือเลือกใช้ภาพคณะแทน |
| FR-ALUMNI-06 | ยินยอม PDPA ก่อนส่งข้อมูล |
| FR-ALUMNI-07 | แก้ไขข้อมูลที่เคยส่งแล้วได้ โดยยืนยันตัวตนอีกครั้ง |
| FR-ALUMNI-08 | แจ้งไม่ประสงค์ลงหนังสือ ต้องยืนยันตัวตนก่อน |
| FR-ALUMNI-09 | ถอนความยินยอม (เคยส่งแล้วกลับมาแจ้งไม่ประสงค์) ลบรูปและข้อมูลที่กรอก |
| FR-ALUMNI-10 | เก็บประวัติชื่อทุกครั้งที่เปลี่ยน พร้อมวันที่และผู้แก้ |
| FR-ALUMNI-11 | จัดรูปแบบช่องทางติดต่อให้เป็นมาตรฐานอัตโนมัติ (เบอร์โทร, LINE, Facebook, Instagram) |

### 2.3 การจัดการผู้ใช้ (FR-USER)

| รหัส | ข้อกำหนด |
| --- | --- |
| FR-USER-01 | สร้างบัญชีเจ้าของระบบอัตโนมัติเมื่อเริ่มต้นครั้งแรก |
| FR-USER-02 | สร้าง/แก้ไข/ลบบัญชีผู้ใช้ได้เฉพาะบทบาทที่ต่ำกว่าตนเอง |
| FR-USER-03 | รหัสผ่านชั่วคราวแสดงครั้งเดียว บังคับเปลี่ยนก่อนใช้งาน |
| FR-USER-04 | รีเซ็ตรหัสผ่านของบัญชีอื่นได้ (สร้างรหัสผ่านชั่วคราวใหม่) |
| FR-USER-05 | บัญชี staff ผูกกับระเบียนนิสิตเก่าและเบอร์โทร เพื่อแสดงเป็นตัวแทนรุ่น |
| FR-USER-06 | ผู้ดูแลกรอกแค่รหัสนิสิต 10 หลัก ระบบเติม prefix `s-` ให้อัตโนมัติ |
| FR-USER-07 | กู้คืนบัญชี owner ผ่าน emergency reset (ต้องมี `ADMIN_ACCESS_KEY`) |
| FR-USER-08 | แก้ไขบัญชีผู้ใช้ (ชื่อ เบอร์ รุ่นที่ดูแล บทบาท) ได้ทุกเมื่อ |

### 2.4 การยืนยันตัวตนและ session (FR-AUTH)

| รหัส | ข้อกำหนด |
| --- | --- |
| FR-AUTH-01 | เข้าสู่ระบบด้วย username/password |
| FR-AUTH-02 | Session เป็น JWT HS256 อายุ 8 ชั่วโมง ผูกกับ tokenVersion |
| FR-AUTH-03 | เปลี่ยนรหัสผ่านหรือบทบาทแล้ว token เดิมใช้ไม่ได้ทันที |
| FR-AUTH-04 | ล็อกบัญชี 15 นาทีเมื่อกรอกผิดครบ 8 ครั้ง |
| FR-AUTH-05 | เปลี่ยนรหัสผ่านแล้วต้องเข้าสู่ระบบใหม่เสมอ |

### 2.5 แดชบอร์ดและสถิติ (FR-DASH)

| รหัส | ข้อกำหนด |
| --- | --- |
| FR-DASH-01 | หน้าแรกแสดงแถบวิ่งสถิติความคืบหน้าแบบสด (ticker) |
| FR-DASH-02 | แถบอัปเดตทุก 1 นาที และทันทีเมื่อผู้ใช้กลับมาที่แท็บ |
| FR-DASH-03 | แถบหยุดวิ่งเมื่อเอาเมาส์ชี้ และไม่วิ่งเมื่อ prefers-reduced-motion |
| FR-DASH-04 | แดชบอร์ดผู้ดูแล: วงแหวนความคืบหน้า กราฟราย 14 วัน ความครบถ้วนของข้อมูล |
| FR-DASH-05 | แดชบอร์ดแสดงรุ่นที่ตอบมากที่สุด/ควรติดตาม |
| FR-DASH-06 | ตัวเลขสถิติอัปเดตแบบ O(1) ด้วย bumpPublicStats เมื่อมีคนส่งข้อมูล |

### 2.6 การส่งออกและส่งมอบ (FR-EXPORT)

| รหัส | ข้อกำหนด |
| --- | --- |
| FR-EXPORT-01 | ส่งออก Excel สำหรับติดตามงาน กรองตามรุ่น/สถานะ |
| FR-EXPORT-02 | ส่งมอบทีมออกแบบ: Excel 4 ชีต + CSV สำหรับ InDesign Data Merge |
| FR-EXPORT-03 | ไฟล์ CSV มีคอลัมน์ `@รูปภาพ` และ UTF-8 BOM |
| FR-EXPORT-04 | รูปถ่ายแยก ZIP รายรุ่น ตั้งชื่อไฟล์ตามเลขลำดับ |
| FR-EXPORT-05 | ชุดส่งมอบรวมเฉพาะคนที่ยืนยันแล้ว ไม่มีรหัสเข้า/ข้อมูลติดตามภายใน |
| FR-EXPORT-06 | ดาวน์โหลดรูปทุกรุ่นเรียงต่อกันอัตโนมัติ |

### 2.7 การติดตามนิสิตเก่า (FR-FOLLOW)

| รหัส | ข้อกำหนด |
| --- | --- |
| FR-FOLLOW-01 | ตัวแทนรุ่นเห็นเบอร์ติดต่อจากไฟล์นำเข้า (outreach) |
| FR-FOLLOW-02 | บันทึกสถานะการติดตาม 6 สถานะ พร้อมหมายเหตุ |
| FR-FOLLOW-03 | สถานะการติดตามแยกจากสถานะการส่งข้อมูล |
| FR-FOLLOW-04 | ตัวแทนรุ่นแก้ไขได้เฉพาะรุ่นใน batchScope |

### 2.8 การตั้งค่าระบบ (FR-SETTINGS)

| รหัส | ข้อกำหนด |
| --- | --- |
| FR-SETTINGS-01 | เปิด/ปิดรับข้อมูลจากนิสิตเก่า |
| FR-SETTINGS-02 | เมื่อปิดรับ หน้าสาธารณะเปลี่ยนเป็นหน้าติดต่อตัวแทนรุ่น |
| FR-SETTINGS-03 | กำหนดจำนวนรุ่นสูงสุด (maxBatch) |
| FR-SETTINGS-04 | กำหนดความยาวประวัติสูงสุด (bioMaxLength) |
| FR-SETTINGS-05 | กำหนดเวอร์ชัน PDPA และชื่อหนังสือ |
| FR-SETTINGS-06 | ล้างข้อมูลทั้งหมด (owner เท่านั้น) สำหรับเตรียมใช้งานจริง |

### 2.9 Audit Log (FR-AUDIT)

| รหัส | ข้อกำหนด |
| --- | --- |
| FR-AUDIT-01 | บันทึกทุกการกระทำของผู้ดูแลอัตโนมัติ |
| FR-AUDIT-02 | IP เก็บเป็น HMAC 16 ตัวอักษร ย้อนกลับไม่ได้ |
| FR-AUDIT-03 | ไม่เก็บข้อมูลส่วนบุคคลในบันทึก |
| FR-AUDIT-04 | บันทึกการล้างข้อมูลต้องรอดจากการล้างข้อมูล |

---

## 3. ข้อกำหนดไม่เชิงหน้าที่ (Non-Functional Requirements)

### 3.1 ประสิทธิภาพ (NFR-PERF)

| รหัส | ข้อกำหนด |
| --- | --- |
| NFR-PERF-01 | รองรับทะเบียนนิสิตเก่า 10,000+ รายการ |
| NFR-PERF-02 | นำเข้า 10,000 แถวเสร็จภายใน 10 วินาที |
| NFR-PERF-03 | หน้าสถิติสาธารณะใช้ Firestore count aggregate cache 5 นาที |
| NFR-PERF-04 | CDN cache สถิติ 30 วินาที |
| NFR-PERF-05 | ค้นหาใช้ index จริง ไม่ดึงทั้ง collection |
| NFR-PERF-06 | API แบ่งหน้าจริง (offset/limit) รองรับสูงสุด 1,000 ต่อ request |
| NFR-PERF-07 | ส่งออก Excel ใช้ listAllAlumni ดึงทีละ 2,000 จนครบ |

### 3.2 ความปลอดภัย (NFR-SEC)

| รหัส | ข้อกำหนด |
| --- | --- |
| NFR-SEC-01 | รหัสผ่าน hash ด้วย scrypt (N=16384, r=8, p=1) พร้อม salt สุ่ม |
| NFR-SEC-02 | รหัสเข้าเก็บเป็น HMAC-SHA256 ด้วย ID_HASH_SECRET |
| NFR-SEC-03 | JWT HS256 อายุ 8 ชั่วโมง ผูกกับ tokenVersion |
| NFR-SEC-04 | Rate limiting: การค้นหา 60 ครั้ง/10 นาที, การยืนยัน 10 ครั้ง/ชั่วโมง/ระเบียน |
| NFR-SEC-05 | ล็อกบัญชี 15 นาทีหลังกรอกผิด 8 ครั้ง |
| NFR-SEC-06 | Firestore/Storage rules ปฏิเสธ client access ทั้งหมด |
| NFR-SEC-07 | ผลค้นหาปกปิดรหัสนิสิตบางส่วน (แสดง 4 หลักแรก + xxxx + 2 หลักสุดท้าย) |
| NFR-SEC-08 | Submit token ผูกกับระเบียนเดียว ไม่สามารถใช้แก้ไขระเบียนอื่น |
| NFR-SEC-09 | IP ใน audit log เก็บเป็น HMAC ย้อนกลับไม่ได้ |

### 3.3 ความเป็นส่วนตัว — PDPA (NFR-PDPA)

| รหัส | ข้อกำหนด |
| --- | --- |
| NFR-PDPA-01 | ขอความยินยอมก่อนเก็บข้อมูลเพื่อเผยแพร่ พร้อมระบุเวอร์ชัน |
| NFR-PDPA-02 | นิสิตเก่าถอนความยินยอมได้ ระบบลบรูปและข้อมูลที่กรอก |
| NFR-PDPA-03 | ข้อมูลติดตามงาน (outreach) แยกจากข้อมูลที่ยินยอมเผยแพร่ (contacts) |
| NFR-PDPA-04 | ไฟล์ส่งมอบทีมออกแบบไม่มี outreach และรหัสเข้า |
| NFR-PDPA-05 | ลบ GPS metadata จากรูปถ่ายก่อนเก็บ |
| NFR-PDPA-06 | alumniSubmissions ไม่มี accessCodeHash, source, outreach |
| NFR-PDPA-07 | สถิติสาธารณะแสดงตัวเลขรวมรายรุ่นเท่านั้น ไม่มีชื่อบุคคล |

### 3.4 ความน่าเชื่อถือ (NFR-REL)

| รหัส | ข้อกำหนด |
| --- | --- |
| NFR-REL-01 | นำเข้าหยุดกลางคันแล้วกดซ้ำได้ ข้อมูลไม่ซ้ำ |
| NFR-REL-02 | Chunk import ตรวจสอบทุกแถวซ้ำ ป้องกันข้อมูลที่ถูกแก้ระหว่างทาง |
| NFR-REL-03 | รูปแบบไฟล์ตรวจจากการถอดรหัสจริง ไม่เชื่อ MIME type |

### 3.5 การใช้งาน (NFR-USE)

| รหัส | ข้อกำหนด |
| --- | --- |
| NFR-USE-01 | Responsive design ใช้งานได้ทั้งมือถือและคอมพิวเตอร์ |
| NFR-USE-02 | รองรับ prefers-reduced-motion |
| NFR-USE-03 | เบอร์โทรจัดรูปแบบให้ทันทีระหว่างพิมพ์ |
| NFR-USE-04 | เบอร์โทรตัวแทนรุ่นกดโทรออกได้ทันที |

---

## 4. สถาปัตยกรรมระบบ

### 4.1 ภาพรวม

```
                    ┌─────────────────┐
                    │   Firebase CDN  │
                    │   (Hosting)     │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
     หน้าเว็บ (SPA)               /api/** rewrite
     React 18 + Vite 8              │
                             ┌──────┴──────┐
                             │ Cloud Func  │
                             │ gen 2       │
                             │ Node.js 22  │
                             │ Express 4   │
                             └──────┬──────┘
                                    │
                        ┌───────────┼───────────┐
                        │           │           │
                   Firestore    Storage    Secret Mgr
                   (asia-se1)  (asia-se1)
```

### 4.2 Technology Stack

| ส่วน | เทคโนโลยี |
| --- | --- |
| Frontend | React 18, Vite 8, vanilla CSS |
| Backend | Node.js 22 ESM, Express 4 |
| Database | Firestore Native (asia-southeast1) |
| Storage | Firebase Storage (asia-southeast1) |
| Hosting | Firebase Hosting + Cloud Functions gen 2 |
| Image Processing | sharp (mozjpeg, sRGB, 4:4:4, 300 dpi) |
| Excel | ExcelJS |
| Auth | JWT HS256 (ไม่พึ่ง library ภายนอก) |
| Crypto | Node.js built-in crypto (scrypt, HMAC-SHA256) |

### 4.3 โหมดพัฒนา

- `FIREBASE_ENABLED=false`: ใช้ไฟล์ JSON ที่ `data/db/` แทน Firestore
- Data adapter (`server/lib/db.js`) รองรับ where/orderBy/limit/count
- Domain layer ไม่ต้องรู้ว่ากำลังใช้ที่เก็บข้อมูลแบบใด

---

## 5. แบบจำลองข้อมูล

### 5.1 Collections

| Collection | คำอธิบาย | จำนวนโดยประมาณ |
| --- | --- | --- |
| `users` | บัญชีผู้ใช้ระบบ | หลักสิบ |
| `usernames` | ดัชนีความไม่ซ้ำของ username | เท่ากับ users |
| `alumni` | ระเบียนหลักนิสิตเก่า (มีข้อมูลส่วนบุคคล) | 10,000+ |
| `alumniSubmissions` | สำเนาไร้ PII สำหรับทีมออกแบบ | เท่ากับ alumni ที่ส่งข้อมูลแล้ว |
| `importJobs` | ประวัติการนำเข้า Excel | หลักสิบ |
| `auditLogs` | บันทึกการกระทำ | หลักพัน |
| `settings` | การตั้งค่าระบบ (1 เอกสาร) | 1 |

### 5.2 รหัสเอกสาร alumni

- มีรหัสนิสิต: `s-{รหัสนิสิต}` เช่น `s-6534000001`
- ไม่มีรหัสนิสิต: `n-{sha1(รุ่น|ชื่อ|นามสกุล) 16 ตัวแรก}`

### 5.3 รหัสนิสิต 10 หลัก

รูปแบบ `YY34SSSSSS`:
- `YY` = `(2483 + รุ่น) % 100` (ปีที่เข้าศึกษา 2 หลักสุดท้าย)
- `34` = รหัสคณะเภสัชศาสตร์ (ค่าคงที่)
- `SSSSSS` = เลขลำดับ 6 หลัก

รายละเอียดเต็ม: [`docs/DATABASE.md`](DATABASE.md)

---

## 6. API Endpoints

### 6.1 สาธารณะ (ไม่ต้องเข้าสู่ระบบ)

| Method | Path | หน้าที่ |
| --- | --- | --- |
| GET | `/api/health` | ตรวจสถานะระบบ |
| GET | `/api/public/settings` | การตั้งค่าที่เปิดเผยได้ |
| GET | `/api/public/stats` | สถิติความคืบหน้า (CDN cache 30s) |
| POST | `/api/public/search` | ค้นหาชื่อในรุ่นที่ระบุ |
| GET | `/api/public/representatives` | ตัวแทนรุ่น (เมื่อปิดรับข้อมูล) |
| POST | `/api/public/verify` | ยืนยันด้วยรหัสเข้า |
| POST | `/api/public/my-record` | ดึงข้อมูลของตนเอง (ต้องมี submit token) |
| POST | `/api/public/submit` | ส่งข้อมูล + รูป (multipart) |
| POST | `/api/public/decline` | แจ้งไม่ประสงค์ลงหนังสือ |

### 6.2 ยืนยันตัวตน

| Method | Path | หน้าที่ |
| --- | --- | --- |
| POST | `/api/auth/login` | เข้าสู่ระบบ |
| GET | `/api/auth/me` | ข้อมูลผู้ใช้ปัจจุบัน |
| POST | `/api/auth/change-password` | เปลี่ยนรหัสผ่าน |
| POST | `/api/auth/emergency-owner-reset` | กู้คืนบัญชี owner |

### 6.3 ผู้ดูแล (ต้องมี Authorization: Bearer token)

| Method | Path | สิทธิ์ |
| --- | --- | --- |
| GET | `/api/admin/summary` | `alumni.read` |
| GET | `/api/admin/alumni` | `alumni.read` |
| GET/PATCH | `/api/admin/alumni/:id` | `alumni.read`/`alumni.write` |
| PATCH | `/api/admin/alumni/:id/follow-up` | `alumni.followUp` |
| GET | `/api/admin/follow-up/states` | `alumni.followUp` |
| GET/POST | `/api/admin/users` | `users.manage` |
| PATCH/DELETE | `/api/admin/users/:uid` | `users.manage` |
| POST | `/api/admin/users/:uid/reset-password` | `users.manage` |
| GET | `/api/admin/import/template.xlsx` | `alumni.import` |
| POST | `/api/admin/import/prepare` | `alumni.import` |
| POST | `/api/admin/import/chunk` | `alumni.import` |
| POST | `/api/admin/import/commit` | `alumni.import` |
| GET | `/api/admin/import/jobs` | `alumni.import` |
| GET | `/api/admin/export.xlsx` | `alumni.export` |
| GET | `/api/admin/handoff/summary` | `alumni.export` |
| GET | `/api/admin/handoff/data.xlsx` | `alumni.export` |
| GET | `/api/admin/handoff/data-merge.csv` | `alumni.export` |
| GET | `/api/admin/handoff/readme.txt` | `alumni.export` |
| GET | `/api/admin/handoff/photos.zip` | `alumni.export` |
| GET/PUT | `/api/admin/settings` | `settings.manage` |
| POST | `/api/admin/reset` | `data.reset` (owner) |
| GET | `/api/admin/audit` | `audit.read` |

---

## 7. ความปลอดภัย

### 7.1 ลำดับชั้นสิทธิ์ (RBAC)

```
owner (40)  →  admin (30)  →  staff (20)  →  alumni (10)
```

จัดการได้เฉพาะบัญชีที่ระดับต่ำกว่าตนเอง

### 7.2 Permission Matrix

| Permission | owner | admin | staff | alumni |
| --- | --- | --- | --- | --- |
| `users.manage` | ทุกบทบาท | staff, alumni | - | - |
| `alumni.read` | ทุกรุ่น | ทุกรุ่น | เฉพาะ batchScope | ตนเองเท่านั้น |
| `alumni.write` | ทุกรุ่น | ทุกรุ่น | - | - |
| `alumni.followUp` | ทุกรุ่น | ทุกรุ่น | เฉพาะ batchScope | - |
| `alumni.import` | yes | yes | - | - |
| `alumni.export` | yes | yes | - | - |
| `settings.manage` | yes | yes | - | - |
| `data.reset` | yes | - | - | - |
| `audit.read` | yes | yes | - | - |

### 7.3 Secrets

| Secret | การใช้งาน |
| --- | --- |
| `AUTH_JWT_SECRET` | ลงชื่อ JWT token |
| `ID_HASH_SECRET` | HMAC รหัสเข้า |
| `ADMIN_ACCESS_KEY` | เปิด endpoint emergency-owner-reset |
| `OWNER_INITIAL_PASSWORD` | รหัสผ่านเริ่มต้นของ owner |

---

## 8. การ Deploy

### 8.1 Infrastructure

| ส่วน | รายละเอียด |
| --- | --- |
| Firebase project | `alumni-13428` |
| URL | https://alumni-13428.web.app |
| Region | `asia-southeast1` |
| Cloud Function | gen 2, 1 GiB memory, timeout 540s |
| Runtime | Node.js 22 |

### 8.2 ขั้นตอน Deploy

```bash
npm run build
firebase deploy --project alumni-13428 \
  --only functions,hosting,firestore:rules,firestore:indexes,storage
```

---

## 9. การทดสอบ

### 9.1 Smoke Test

```bash
npm run server
SMOKE_OWNER_PASSWORD='<password>' npm run smoke
```

ครอบคลุม 176 รายการ:
- การเข้าสู่ระบบและบังคับเปลี่ยนรหัสผ่าน
- การเพิกถอน token และป้องกัน privilege escalation
- ขอบเขตรุ่นของ staff
- การนำเข้า Excel (dry run + จริง + ซ้ำ)
- การค้นหาและยืนยันตัวตน
- การอัปโหลดรูปแบบ multipart
- การส่งออกทั้งสองแบบ
- โครงสร้างเทมเพลต
- Audit log

---

## 10. ข้อจำกัดที่ทราบ

1. Rate limiter เก็บใน memory — หลวมขึ้นเมื่อ Cloud Function มีหลาย instance
2. ไม่มีระบบแจ้งเตือนทางอีเมลเมื่อสร้างบัญชีใหม่
3. ไม่มีสำรองข้อมูลอัตโนมัติ (ต้องตั้ง scheduled export ของ Firestore)
4. ผู้ดูแลแก้ไขระเบียนได้เฉพาะสถานะจากตาราง ยังไม่มีฟอร์มแก้ไขแบบเต็ม

---

## 11. ภาคผนวก

### 11.1 เอกสารอ้างอิง

| เอกสาร | ที่อยู่ |
| --- | --- |
| โครงสร้างฐานข้อมูล | [`docs/DATABASE.md`](DATABASE.md) |
| คู่มือพัฒนา | [`CLAUDE_HANDOFF.md`](../CLAUDE_HANDOFF.md) |
| การตั้งค่า environment | `.env.example` |

### 11.2 ประวัติการเปลี่ยนแปลง

| เวอร์ชัน | วันที่ | การเปลี่ยนแปลง |
| --- | --- | --- |
| 2.0 | - | ระบบ RBAC, โครงสร้างฐานข้อมูลใหม่, แก้ multipart upload |
| 2.1 | 18 ส.ค. 2569 | รหัสนิสิต 10 หลัก, ซ่อน prefix s- จากผู้ดูแล |
