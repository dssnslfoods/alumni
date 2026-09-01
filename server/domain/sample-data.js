import { config } from "../lib/env.js";

/**
 * Synthetic alumni rows for load-testing the importer and for showing new
 * administrators what a correctly filled sheet looks like.
 *
 * Every name, student code, ID digit, email and phone number here is generated.
 * None of it belongs to a real person.
 */

/** Deterministic PRNG (mulberry32) — the same seed always produces the same rows. */
function createRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
const EMAIL_STEMS = ["somchai", "suda", "kitti", "wanna", "anusorn", "piya", "natt", "chai", "siri", "porn", "thana", "arun"];

/**
 * Map a batch number to the 2-digit entry-year suffix.
 *
 * Chulalongkorn student IDs encode the last two digits of the Buddhist-era
 * year the student entered the university. The Faculty of Pharmaceutical
 * Sciences opened its first cohort (รุ่น 1) in B.E. 2484 (1941 CE).
 *
 * batch 1  → B.E. 2482 → "82"
 * batch 45 → B.E. 2526 → "26"
 * batch 82 → B.E. 2563 → "63"
 */
function entryYearSuffix(batch) {
  const entryYear = 2481 + batch;
  return String(entryYear % 100).padStart(2, "0");
}

/**
 * Build a 10-digit student ID in the Chulalongkorn format.
 *
 *   YY 34 SSSSSS
 *   │  │  └─ 6-digit sequential number within the faculty
 *   │  └──── faculty code (34 = Pharmaceutical Sciences)
 *   └─────── last 2 digits of the B.E. entry year
 */
export function formatStudentId(batch, sequence) {
  return `${entryYearSuffix(batch)}34${String(sequence).padStart(6, "0")}`;
}

/**
 * Older batches are smaller (fewer members still on the register), newer
 * batches larger — so per-batch counts resemble a real association roster
 * rather than a flat distribution.
 */
function batchSizes(total, maxBatch) {
  const weights = Array.from({ length: maxBatch }, (_, index) => 0.35 + (index / (maxBatch - 1)) * 1.3);
  const sum = weights.reduce((carry, weight) => carry + weight, 0);
  const sizes = weights.map((weight) => Math.floor((weight / sum) * total));
  let remainder = total - sizes.reduce((carry, size) => carry + size, 0);
  for (let index = sizes.length - 1; remainder > 0; index -= 1, remainder -= 1) sizes[index % sizes.length] += 1;
  return sizes;
}

export function generateSampleRows(total = 10000, { seed = 25690816, maxBatch = config.maxBatch } = {}) {
  const random = createRandom(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const chance = (probability) => random() < probability;
  const digits = (length) => Array.from({ length }, () => Math.floor(random() * 10)).join("");

  const rows = [];
  batchSizes(total, maxBatch).forEach((size, index) => {
    const batch = index + 1;
    for (let sequence = 1; sequence <= size; sequence += 1) {
      const isFemale = chance(0.62);
      const firstName = isFemale ? pick(FEMALE_NAMES) : pick(MALE_NAMES);
      const changedSurname = isFemale && chance(0.22);
      const changedFirstName = chance(0.04);

      rows.push({
        "คำนำหน้า": isFemale ? (chance(0.45) ? "นาง" : "นางสาว") : "นาย",
        "ชื่อ": firstName,
        "นามสกุล": pick(SURNAMES),
        "รุ่น": batch,
        "ปีที่เข้าศึกษา": 2481 + batch,
        "รหัสนิสิต": formatStudentId(batch, sequence),
        "ชื่อปัจจุบัน": changedFirstName ? (isFemale ? pick(FEMALE_NAMES) : pick(MALE_NAMES)) : "",
        "นามสกุลปัจจุบัน": changedSurname ? pick(SURNAMES) : "",
        "อีเมลสำหรับติดต่อ": chance(0.55) ? `${pick(EMAIL_STEMS)}${Math.floor(random() * 900 + 100)}@${pick(EMAIL_DOMAINS)}` : "",
        "เบอร์โทรสำหรับติดต่อ": chance(0.68) ? `0${pick(["6", "8", "9"])}${digits(8)}` : "",
        "หมายเหตุ": chance(0.09) ? pick(NOTES) : ""
      });
    }
  });
  return rows;
}

export function summariseSampleRows(rows) {
  return {
    total: rows.length,
    batches: new Set(rows.map((row) => row["รุ่น"])).size,
    uniqueStudentIds: new Set(rows.map((row) => row["รหัสนิสิต"])).size,
    withNameChange: rows.filter((row) => row["ชื่อปัจจุบัน"] || row["นามสกุลปัจจุบัน"]).length,
    withEmail: rows.filter((row) => row["อีเมลสำหรับติดต่อ"]).length,
    withPhone: rows.filter((row) => row["เบอร์โทรสำหรับติดต่อ"]).length
  };
}
