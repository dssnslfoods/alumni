/**
 * Generate a realistic sample alumni spreadsheet for load-testing the importer.
 *
 *   node scripts/generate-sample-data.mjs            # 8,000 rows
 *   node scripts/generate-sample-data.mjs 500        # any size
 *
 * The output uses the exact same template as the real import file, so it also
 * doubles as a worked example of how the sheet should be filled in.
 *
 * All names, student codes, ID digits, emails and phone numbers are synthetic.
 * Nothing here comes from a real person.
 */
import fs from "node:fs";
import path from "node:path";
import { buildImportTemplate } from "../server/domain/excel.js";
import { rootDir } from "../server/lib/env.js";

const TOTAL = Number(process.argv[2]) || 8000;
const MAX_BATCH = 88;

/** Deterministic PRNG (mulberry32) — the same seed always produces the same file. */
function createRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(25690816);
const pick = (list) => list[Math.floor(random() * list.length)];
const chance = (probability) => random() < probability;
const digits = (length) => Array.from({ length }, () => Math.floor(random() * 10)).join("");

const MALE_NAMES = [
  "สมชาย", "อนุสรณ์", "กิตติ", "ธนวัฒน์", "ปรีชา", "วิชัย", "ณัฐพงษ์", "ชัยวัฒน์", "สุรศักดิ์", "พงศ์พันธ์",
  "อดิศักดิ์", "ภาณุพงศ์", "จิรายุ", "เอกชัย", "ธีรพงษ์", "วีระชัย", "นครินทร์", "ศุภชัย", "ประวิทย์", "อภิสิทธิ์",
  "ธนกร", "รัชพล", "กันตพงศ์", "ปิยะพงษ์", "สิทธิชัย", "ธเนศ", "วรพล", "ชนาธิป", "ภูริช", "ณัฐดนัย",
  "พีรพัฒน์", "อาทิตย์", "สมพงษ์", "จักรพันธ์", "ยุทธนา", "ไพโรจน์", "มานพ", "สุทธิพงษ์", "กฤษฎา", "ธนดล",
  "ศรัณย์", "พิชญ์", "อรรถพล", "นพดล", "วิทวัส", "ก้องภพ", "ทศพล", "เกียรติศักดิ์", "ปณิธาน", "สุเมธ"
];

const FEMALE_NAMES = [
  "สุดา", "วรรณา", "ปิยะนุช", "ณัฐธิดา", "กมลชนก", "ศิริพร", "อรวรรณ", "พรทิพย์", "จันทิมา", "รัตนา",
  "สุภาพร", "นันทนา", "ชลธิชา", "ธนพร", "พิมพ์ชนก", "วิภาวี", "อาภัสรา", "ศศิธร", "กนกวรรณ", "ปรียาภรณ์",
  "ญาณิศา", "เบญจวรรณ", "มลฤดี", "สิริกัญญา", "อัจฉรา", "ทิพย์วรรณ", "ณัฐชา", "พัชราภรณ์", "วรินทร", "สโรชา",
  "ขวัญฤทัย", "จิราพร", "นภัสสร", "ภัทรานิษฐ์", "รุ่งทิวา", "สายฝน", "อริสา", "กัลยรัตน์", "ดวงกมล", "ปาริชาต",
  "วนิดา", "สุพรรณี", "อนงค์นาถ", "ชนม์นิภา", "ธัญญลักษณ์", "พิมลรัตน์", "ยุพิน", "วาสนา", "สุชาดา", "อทิตยา"
];

const SURNAMES = [
  "ใจดี", "เรืองรอง", "วัฒนกุล", "ทองสะอาด", "ศรีสุวรรณ", "บุญมาก", "พงษ์ไพบูลย์", "รัตนพันธ์", "สุขสมบูรณ์", "อินทรวิเชียร",
  "ชูเกียรติ", "แสงทอง", "จันทร์เพ็ญ", "ธรรมรักษ์", "ภูมิใจ", "วงศ์สว่าง", "สมบูรณ์ทรัพย์", "อารีย์วงศ์", "กิตติวัฒน์", "เจริญสุข",
  "ดำรงเดช", "ถาวรกุล", "นาคสุวรรณ", "ประเสริฐศรี", "พูนสวัสดิ์", "มงคลชัย", "ยิ่งเจริญ", "รุ่งเรืองกิจ", "ลิ้มสุวรรณ", "วิริยะพงศ์",
  "ศักดิ์ศรี", "สถาพรชัย", "หิรัญรัตน์", "อุดมทรัพย์", "เกษมสันต์", "คงคาเขต", "ชัยมงคล", "ณ นคร", "ดิษฐ์ประเสริฐ", "ตันติกุล",
  "ทวีสิน", "นิลรัตน์", "บวรสิน", "ปัญญาดี", "ผลบุญ", "พิทักษ์ไทย", "ภักดีวงศ์", "มณีโชติ", "ยอดขวัญ", "รักไทย",
  "ลาภประเสริฐ", "วรรณศิลป์", "ศิริมงคล", "สกุลทอง", "หาญกล้า", "อภิรักษ์", "เอี่ยมสะอาด", "โชติรส", "ไกรสร", "กมลาศน์",
  "ขจรเดช", "จรัสแสง", "ฉัตรมงคล", "เชิดชูเกียรติ", "ญาณเดช", "ฐิติวัฒน์", "ณรงค์ฤทธิ์", "เดชอุดม", "ตรีเนตร", "ถนอมศักดิ์"
];

const NOTES = [
  "ตัวแทนรุ่นยืนยันข้อมูลแล้ว",
  "ติดต่อทางอีเมลเท่านั้น",
  "ปัจจุบันทำงานต่างประเทศ",
  "รอยืนยันเบอร์โทรใหม่",
  "ขอให้ติดต่อผ่านตัวแทนรุ่น",
  "เปลี่ยนนามสกุลหลังสมรส",
  "เกษียณแล้ว",
  "ที่อยู่เดิมติดต่อไม่ได้"
];

const EMAIL_DOMAINS = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "pharm.example.ac.th"];

/**
 * Older batches are smaller (fewer members still on the register), newer
 * batches larger — so per-batch counts look like a real association roster
 * rather than a flat distribution.
 */
function batchSizes(total) {
  const weights = Array.from({ length: MAX_BATCH }, (_, index) => 0.35 + (index / (MAX_BATCH - 1)) * 1.3);
  const sum = weights.reduce((carry, weight) => carry + weight, 0);
  const sizes = weights.map((weight) => Math.floor((weight / sum) * total));
  let remainder = total - sizes.reduce((carry, size) => carry + size, 0);
  for (let index = sizes.length - 1; remainder > 0; index -= 1, remainder -= 1) sizes[index % sizes.length] += 1;
  return sizes;
}

function transliterate(name) {
  // Rough Latin stem for email addresses — good enough for synthetic data.
  const stems = ["somchai", "suda", "kitti", "wanna", "anusorn", "piya", "natt", "chai", "siri", "porn", "thana", "arun"];
  return `${pick(stems)}${Math.floor(random() * 900 + 100)}`;
}

function buildRow(batch, sequence) {
  const isFemale = chance(0.62); // การเภสัชฯ มีสัดส่วนผู้หญิงมากกว่า
  const firstName = isFemale ? pick(FEMALE_NAMES) : pick(MALE_NAMES);
  const lastName = pick(SURNAMES);
  const title = isFemale ? (chance(0.45) ? "นาง" : "นางสาว") : "นาย";

  // Surname changes are common for married alumnae; first-name changes are rarer.
  const changedSurname = isFemale && chance(0.22);
  const changedFirstName = chance(0.04);

  const row = {
    "คำนำหน้า": title,
    "ชื่อ": firstName,
    "นามสกุล": lastName,
    "รุ่น": batch,
    "รหัสนิสิต": `${String(batch).padStart(2, "0")}${String(sequence).padStart(5, "0")}`,
    "เลขท้ายบัตรประชาชน 5 หลัก": digits(5),
    "ชื่อปัจจุบัน": changedFirstName ? (isFemale ? pick(FEMALE_NAMES) : pick(MALE_NAMES)) : "",
    "นามสกุลปัจจุบัน": changedSurname ? pick(SURNAMES) : "",
    "อีเมลสำหรับติดต่อ": chance(0.55) ? `${transliterate(firstName)}@${pick(EMAIL_DOMAINS)}` : "",
    "เบอร์โทรสำหรับติดต่อ": chance(0.68) ? `0${pick(["6", "8", "9"])}${digits(8)}` : "",
    "หมายเหตุ": chance(0.09) ? pick(NOTES) : ""
  };
  return row;
}

const sizes = batchSizes(TOTAL);
const rows = [];
sizes.forEach((size, index) => {
  const batch = index + 1;
  for (let sequence = 1; sequence <= size; sequence += 1) rows.push(buildRow(batch, sequence));
});

const outputDir = path.join(rootDir, "outputs");
fs.mkdirSync(outputDir, { recursive: true });
const target = path.join(outputDir, `ตัวอย่างข้อมูลนิสิตเก่า-${rows.length}-รายการ.xlsx`);
fs.writeFileSync(target, Buffer.from(await buildImportTemplate({ rows })));

const withNameChange = rows.filter((row) => row["ชื่อปัจจุบัน"] || row["นามสกุลปัจจุบัน"]).length;
const withEmail = rows.filter((row) => row["อีเมลสำหรับติดต่อ"]).length;
const withPhone = rows.filter((row) => row["เบอร์โทรสำหรับติดต่อ"]).length;
const ids = new Set(rows.map((row) => row["รหัสนิสิต"]));

console.log(`
สร้างไฟล์ตัวอย่างเรียบร้อย
  ไฟล์            : ${path.relative(rootDir, target)}
  ขนาด            : ${(fs.statSync(target).size / 1024 / 1024).toFixed(2)} MB
  จำนวนรายการ      : ${rows.length.toLocaleString("th-TH")}
  รุ่น             : 1-${MAX_BATCH} (รุ่นละ ${Math.min(...sizes)}-${Math.max(...sizes)} คน)
  รหัสนิสิตไม่ซ้ำ   : ${ids.size === rows.length ? "ใช่" : `ไม่ใช่ (ซ้ำ ${rows.length - ids.size})`}
  มีการเปลี่ยนชื่อ  : ${withNameChange.toLocaleString("th-TH")} คน
  มีอีเมล          : ${withEmail.toLocaleString("th-TH")} คน
  มีเบอร์โทร       : ${withPhone.toLocaleString("th-TH")} คน

ข้อมูลทั้งหมดเป็นข้อมูลสมมติที่ระบบสร้างขึ้น ไม่ใช่ข้อมูลของบุคคลจริง
`);
