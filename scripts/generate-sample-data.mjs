/**
 * Write a sample alumni spreadsheet to `outputs/`.
 *
 *   node scripts/generate-sample-data.mjs            # 8,000 rows
 *   node scripts/generate-sample-data.mjs 500        # any size
 *
 * The same data is available from the admin console
 * (นำเข้า / ส่งออก → ดาวน์โหลดไฟล์ตัวอย่างพร้อมข้อมูล) — this script exists for
 * generating files offline or at sizes the UI does not offer.
 */
import fs from "node:fs";
import path from "node:path";
import { buildImportTemplate } from "../server/domain/excel.js";
import { generateSampleRows, summariseSampleRows } from "../server/domain/sample-data.js";
import { rootDir } from "../server/lib/env.js";

const total = Number(process.argv[2]) || 8000;
const rows = generateSampleRows(total);
const stats = summariseSampleRows(rows);

const outputDir = path.join(rootDir, "outputs");
fs.mkdirSync(outputDir, { recursive: true });
const target = path.join(outputDir, `ตัวอย่างข้อมูลนิสิตเก่า-${rows.length}-รายการ.xlsx`);
fs.writeFileSync(target, Buffer.from(await buildImportTemplate({ rows })));

const thai = (value) => value.toLocaleString("th-TH");
console.log(`
สร้างไฟล์ตัวอย่างเรียบร้อย
  ไฟล์            : ${path.relative(rootDir, target)}
  ขนาด            : ${(fs.statSync(target).size / 1024 / 1024).toFixed(2)} MB
  จำนวนรายการ      : ${thai(stats.total)}
  จำนวนรุ่น        : ${stats.batches}
  รหัสนิสิตไม่ซ้ำ   : ${stats.uniqueStudentIds === stats.total ? "ใช่" : `ไม่ใช่ (ซ้ำ ${stats.total - stats.uniqueStudentIds})`}
  มีการเปลี่ยนชื่อ  : ${thai(stats.withNameChange)} คน
  มีอีเมล          : ${thai(stats.withEmail)} คน
  มีเบอร์โทร       : ${thai(stats.withPhone)} คน

ข้อมูลทั้งหมดเป็นข้อมูลสมมติที่ระบบสร้างขึ้น ไม่ใช่ข้อมูลของบุคคลจริง
`);
