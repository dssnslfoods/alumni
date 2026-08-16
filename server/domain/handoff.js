import { ZipArchive } from "archiver";
import ExcelJS from "exceljs";
import { compareForDisplay, normalizeText } from "./alumni.js";
import { openPhotoStream } from "./photos.js";

/**
 * Design-team handoff package.
 *
 * The whole point is that the graphic designer never has to match a photo to a
 * person by hand. Every record gets a stable sequence number, the photo file is
 * named after it, and the data file carries that exact filename — so an
 * InDesign data merge places 10,000 portraits unattended.
 */

/** Strip characters that break filenames or InDesign paths. */
function fileSafe(value) {
  return normalizeText(value)
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

export function photoFolder(batch) {
  return `batch-${String(batch).padStart(2, "0")}`;
}

/**
 * Assign layout order and the canonical photo filename.
 * Sequence restarts per batch, so รุ่น 45 numbering is independent of รุ่น 46.
 */
export function buildHandoffRows(records) {
  const sorted = [...records].sort(compareForDisplay);
  const perBatch = new Map();

  return sorted.map((record) => {
    const sequence = (perBatch.get(record.batch) || 0) + 1;
    perBatch.set(record.batch, sequence);

    const firstName = record.currentFirstName || record.legalFirstName;
    const lastName = record.currentLastName || record.legalLastName;
    const code = `${String(record.batch).padStart(2, "0")}-${String(sequence).padStart(4, "0")}`;
    const hasPhoto = record.photo?.choice === "upload" && Boolean(record.photo?.storagePath);

    return {
      record,
      sequence,
      code,
      firstName,
      lastName,
      hasPhoto,
      // Relative to the package root, so unzipping several batches side by side
      // keeps every path in the data file valid.
      photoPath: hasPhoto ? `photos/${photoFolder(record.batch)}/${code}-${fileSafe(firstName)}-${fileSafe(lastName)}.jpg` : ""
    };
  });
}

export function handoffSummary(rows) {
  const byBatch = new Map();
  rows.forEach((row) => {
    const current = byBatch.get(row.record.batch) || { batch: row.record.batch, people: 0, photos: 0, placeholders: 0, bytes: 0 };
    current.people += 1;
    if (row.hasPhoto) {
      current.photos += 1;
      current.bytes += row.record.photo?.bytes || 0;
    } else {
      current.placeholders += 1;
    }
    byBatch.set(row.record.batch, current);
  });

  const batches = [...byBatch.values()].sort((left, right) => left.batch - right.batch);
  return {
    batches,
    totals: batches.reduce(
      (carry, item) => ({
        people: carry.people + item.people,
        photos: carry.photos + item.photos,
        placeholders: carry.placeholders + item.placeholders,
        bytes: carry.bytes + item.bytes
      }),
      { people: 0, photos: 0, placeholders: 0, bytes: 0 }
    )
  };
}

const CONTACT_LABELS = { facebook: "Facebook", instagram: "Instagram", line: "LINE", phone: "โทรศัพท์" };

function contactValue(record, type) {
  return (record.contacts || []).find((contact) => contact.type === type)?.value || "";
}

function contactText(record) {
  return (record.contacts || []).map((contact) => `${CONTACT_LABELS[contact.type] || contact.type}: ${contact.value}`).join("  ·  ");
}

/**
 * Columns shared by the workbook and the data-merge CSV, in layout order.
 *
 * Contacts appear twice on purpose: one column per channel so each can sit
 * beside its own icon in the layout, plus a combined string for designs that
 * print all channels on one line.
 */
const LAYOUT_COLUMNS = [
  ["ลำดับ", (row) => row.code, 12],
  ["รุ่น", (row) => row.record.batch, 8],
  ["คำนำหน้า", (row) => row.record.title || "", 12],
  ["ชื่อ", (row) => row.firstName, 18],
  ["นามสกุล", (row) => row.lastName, 20],
  ["ชื่อ-นามสกุล", (row) => `${row.firstName} ${row.lastName}`, 28],
  ["ชื่อสมัยเรียน", (row) => `${row.record.legalFirstName} ${row.record.legalLastName}`, 28],
  ["ประวัติโดยย่อ", (row) => row.record.bio || "", 52],
  ["Facebook", (row) => contactValue(row.record, "facebook"), 26],
  ["Instagram", (row) => contactValue(row.record, "instagram"), 24],
  ["LINE", (row) => contactValue(row.record, "line"), 22],
  ["โทรศัพท์", (row) => contactValue(row.record, "phone"), 18],
  ["ช่องทางติดต่อรวม", (row) => contactText(row.record), 44],
  ["จำนวนช่องทางติดต่อ", (row) => (row.record.contacts || []).length, 20],
  ["มีรูป", (row) => (row.hasPhoto ? "มี" : "ไม่มี — ใช้ภาพคณะแทน"), 20],
  ["ไฟล์รูป", (row) => row.photoPath, 46]
];

/** Multi-sheet workbook: layout data, per-batch counts, and what still needs chasing. */
export async function buildHandoffWorkbook(rows, { generatedBy, generatedAt } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ระบบหนังสืออนุสรณ์ สภจ. 2569";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("ข้อมูลสำหรับจัดหน้า", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = LAYOUT_COLUMNS.map(([header, , width]) => ({ header, key: header, width }));
  rows.forEach((row) => sheet.addRow(Object.fromEntries(LAYOUT_COLUMNS.map(([header, read]) => [header, read(row)]))));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2E7D5" } };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: LAYOUT_COLUMNS.length } };
  rows.forEach((row, index) => {
    if (!row.hasPhoto) sheet.getRow(index + 2).getCell(LAYOUT_COLUMNS.length).font = { color: { argb: "FFA73F3A" } };
  });

  const summary = handoffSummary(rows);
  const overview = workbook.addWorksheet("สรุปตามรุ่น");
  overview.columns = [
    { header: "รุ่น", key: "batch", width: 10 },
    { header: "จำนวนคน", key: "people", width: 14 },
    { header: "มีรูป", key: "photos", width: 12 },
    { header: "ใช้ภาพคณะแทน", key: "placeholders", width: 18 },
    { header: "ขนาดรูปรวม (MB)", key: "size", width: 20 },
    { header: "โฟลเดอร์รูป", key: "folder", width: 20 }
  ];
  summary.batches.forEach((item) => overview.addRow({
    batch: item.batch,
    people: item.people,
    photos: item.photos,
    placeholders: item.placeholders,
    size: Number((item.bytes / 1024 / 1024).toFixed(2)),
    folder: `photos/${photoFolder(item.batch)}`
  }));
  overview.addRow({});
  overview.addRow({
    batch: "รวม",
    people: summary.totals.people,
    photos: summary.totals.photos,
    placeholders: summary.totals.placeholders,
    size: Number((summary.totals.bytes / 1024 / 1024).toFixed(2))
  }).font = { bold: true };
  overview.getRow(1).font = { bold: true };

  const missing = workbook.addWorksheet("ต้องใช้ภาพคณะแทน");
  missing.columns = [
    { header: "ลำดับ", key: "code", width: 12 },
    { header: "รุ่น", key: "batch", width: 8 },
    { header: "ชื่อ-นามสกุล", key: "name", width: 30 },
    { header: "เหตุผล", key: "reason", width: 34 }
  ];
  rows.filter((row) => !row.hasPhoto).forEach((row) => missing.addRow({
    code: row.code,
    batch: row.record.batch,
    name: `${row.firstName} ${row.lastName}`,
    reason: row.record.photo?.choice === "placeholder" ? "เจ้าตัวเลือกไม่แสดงรูป" : "ยังไม่ได้ส่งรูป"
  }));
  missing.getRow(1).font = { bold: true };

  const info = workbook.addWorksheet("ข้อมูลชุดส่งมอบ");
  info.columns = [{ width: 26 }, { width: 60 }];
  [
    ["สร้างเมื่อ", generatedAt || new Date().toISOString()],
    ["สร้างโดย", generatedBy || "-"],
    ["จำนวนคนทั้งหมด", summary.totals.people],
    ["มีรูป", summary.totals.photos],
    ["ใช้ภาพคณะแทน", summary.totals.placeholders],
    ["คอลัมน์ไฟล์รูป", "ตรงกับ path ในโฟลเดอร์ photos/ ของไฟล์ ZIP รูปภาพ"],
    ["หมายเหตุ", "ไฟล์นี้ไม่มีเลขบัตรประชาชนและไม่มีอีเมล/เบอร์โทรที่ใช้ติดตามงานภายใน"]
  ].forEach((pair) => info.addRow(pair));
  info.getColumn(1).font = { bold: true };

  return workbook.xlsx.writeBuffer();
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV for InDesign Data Merge.
 *
 * InDesign treats a column whose header starts with `@` as an image path, so
 * `@รูปภาพ` places the portrait automatically. A UTF-8 BOM is required or Thai
 * text arrives as mojibake.
 */
export function buildDataMergeCsv(rows) {
  const headers = ["@รูปภาพ", ...LAYOUT_COLUMNS.filter(([header]) => header !== "ไฟล์รูป").map(([header]) => header)];
  const lines = [headers.map(csvCell).join(",")];

  rows.forEach((row) => {
    const cells = [
      row.photoPath || "",
      ...LAYOUT_COLUMNS.filter(([header]) => header !== "ไฟล์รูป").map(([, read]) => read(row))
    ];
    lines.push(cells.map(csvCell).join(","));
  });

  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join("\r\n"), "utf8")]);
}

export function buildReadme(rows, { generatedBy, generatedAt, batches } = {}) {
  const summary = handoffSummary(rows);
  return [
    "ชุดส่งมอบข้อมูลสำหรับจัดทำหนังสืออนุสรณ์ สภจ. 2569",
    "===========================================================",
    "",
    `สร้างเมื่อ : ${generatedAt || new Date().toISOString()}`,
    `สร้างโดย   : ${generatedBy || "-"}`,
    `รุ่นที่รวมอยู่ : ${batches?.length ? batches.join(", ") : "ทุกรุ่น"}`,
    `จำนวนคน    : ${summary.totals.people}`,
    `มีรูป       : ${summary.totals.photos}`,
    `ใช้ภาพคณะแทน : ${summary.totals.placeholders}`,
    "",
    "สิ่งที่อยู่ในชุดนี้",
    "-----------------------------------------------------------",
    "ข้อมูลนิสิตเก่า.xlsx   ตารางข้อมูลสำหรับจัดหน้า พร้อมชีตสรุปตามรุ่น",
    "                       และชีตรายชื่อที่ต้องใช้ภาพคณะแทน",
    "data-merge.csv         ไฟล์สำหรับ InDesign Data Merge (UTF-8 BOM)",
    "photos/batch-NN/       รูปถ่าย แยกโฟลเดอร์ตามรุ่น",
    "",
    "วิธีใช้กับ InDesign Data Merge",
    "-----------------------------------------------------------",
    "1. แตกไฟล์ ZIP ของทุกรุ่นลงในโฟลเดอร์เดียวกัน",
    "   โครงสร้างจะรวมกันเป็น photos/batch-45, photos/batch-46 ... โดยอัตโนมัติ",
    "2. วาง data-merge.csv ไว้ระดับเดียวกับโฟลเดอร์ photos/",
    "3. ใน InDesign เปิด Window > Utilities > Data Merge > Select Data Source",
    "   แล้วเลือก data-merge.csv",
    "4. คอลัมน์ @รูปภาพ จะขึ้นเป็น field รูปภาพ ลากวางลงกรอบรูปในเทมเพลตได้เลย",
    "5. คอลัมน์อื่นลากวางเป็นข้อความได้ตามปกติ",
    "6. กด Create Merged Document เพื่อวางทั้งรุ่นในครั้งเดียว",
    "",
    "หมายเหตุ",
    "-----------------------------------------------------------",
    "* คอลัมน์ ลำดับ (เช่น 45-0012) ตรงกับชื่อไฟล์รูป ใช้ตรวจสอบย้อนกลับได้",
    "* ช่องทางติดต่อมีให้ทั้งแบบแยกคอลัมน์ (Facebook / Instagram / LINE / โทรศัพท์)",
    "  สำหรับวางคู่ไอคอนแต่ละช่อง และแบบรวมบรรทัดเดียว (ช่องทางติดต่อรวม)",
    "  ช่องที่เจ้าตัวไม่ได้ให้ไว้จะเว้นว่าง ให้ซ่อนกรอบนั้นในเลย์เอาต์",
    "* คนที่ไม่มีรูป ช่องไฟล์รูปจะว่าง ให้ใช้ภาพคณะแทนตามที่เจ้าตัวเลือกไว้",
    "  รายชื่อทั้งหมดดูได้ในชีต ต้องใช้ภาพคณะแทน",
    "* รูปถูกปรับขนาดไม่เกิน 1600x1600 พิกเซล และหมุนตาม EXIF มาแล้ว",
    "* หากตัวอักษรไทยใน CSV เพี้ยน ให้เปิดด้วย Excel แล้วบันทึกใหม่เป็น UTF-16",
    "",
    "ข้อมูลส่วนบุคคล (PDPA)",
    "-----------------------------------------------------------",
    "ข้อมูลชุดนี้เผยแพร่ได้เฉพาะในหนังสืออนุสรณ์ตามที่เจ้าของข้อมูลยินยอมเท่านั้น",
    "ไม่มีเลขบัตรประชาชน และไม่มีอีเมล/เบอร์โทรที่ใช้ติดตามงานภายใน",
    "กรุณาเก็บไฟล์ในที่ปลอดภัย และลบเมื่อจบงานออกแบบ",
    ""
  ].join("\n");
}

/**
 * Stream a ZIP of one batch straight to the response.
 *
 * Photos are already JPEG, so the archive uses no compression — that keeps
 * memory flat and the CPU idle while several hundred megabytes stream through.
 */
export async function streamPhotoArchive(res, rows, { batch, generatedBy, generatedAt } = {}) {
  const archive = new ZipArchive({ store: true });
  archive.on("warning", (error) => console.error("zip warning", error?.message));
  archive.pipe(res);

  const withPhotos = rows.filter((row) => row.hasPhoto);
  archive.append(buildReadme(rows, { generatedBy, generatedAt, batches: batch ? [batch] : [] }), { name: "อ่านก่อน-README.txt" });

  for (const row of withPhotos) {
    const stream = await openPhotoStream(row.record.photo);
    if (!stream) continue;
    archive.append(stream, { name: row.photoPath });
  }

  await archive.finalize();
  return withPhotos.length;
}
