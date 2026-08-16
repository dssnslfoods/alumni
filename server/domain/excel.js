import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { config } from "../lib/env.js";
import { bulkSet, getDocsByIds, setDoc } from "../lib/db.js";
import { newId } from "../lib/crypto.js";
import { badRequest } from "../lib/http.js";
import {
  alumniId,
  defaultSubmissionFields,
  normalizeText,
  onlyDigits,
  parseBatch,
  referenceFields,
  searchKey
} from "./alumni.js";

const { alumni: ALUMNI, importJobs: IMPORT_JOBS } = config.collections;

/** Accepted spreadsheet headers, Thai first then English aliases. */
export const COLUMN_ALIASES = {
  firstName: ["ชื่อ", "ชื่อจริง", "ชื่อสมัยเรียน", "firstname", "first name", "given name", "name"],
  lastName: ["นามสกุล", "นามสกุลสมัยเรียน", "สกุล", "lastname", "last name", "surname", "family name"],
  batch: ["รุ่น", "รุ่นที่", "batch", "class", "year"],
  studentId: ["รหัสนิสิต", "รหัสประจำตัวนิสิต", "student id", "studentid", "student code"],
  idCardLast5: [
    "เลขท้ายบัตรประชาชน 5 หลัก",
    "เลขท้ายบัตรประชาชน",
    "เลขบัตรประชาชน 5 หลักท้าย",
    "id card last 5",
    "idcardlast5",
    "national id last 5"
  ],
  title: ["คำนำหน้า", "คำนำหน้าชื่อ", "title", "prefix"],
  currentFirstName: ["ชื่อปัจจุบัน", "ชื่อปัจจุบัน (ถ้าทราบ)", "current firstname", "current first name"],
  currentLastName: ["นามสกุลปัจจุบัน", "นามสกุลปัจจุบัน (ถ้าทราบ)", "current lastname", "current last name"],
  outreachEmail: ["อีเมลสำหรับติดต่อ", "อีเมล", "email", "e-mail"],
  outreachPhone: ["เบอร์โทรสำหรับติดต่อ", "เบอร์โทร", "โทรศัพท์", "phone", "mobile", "tel"],
  note: ["หมายเหตุ", "note", "remark", "comment"]
};

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    if (value.text) return String(value.text);
    if (value.richText) return value.richText.map((part) => part.text).join("");
    if (value.result !== undefined) return String(value.result);
    if (value.hyperlink) return String(value.text || value.hyperlink);
    if (value instanceof Date) return value.toISOString();
  }
  return String(value);
}

/** Read the first worksheet into `{header: value}` rows. */
export async function readWorkbookRows(buffer, filename = "") {
  const workbook = new ExcelJS.Workbook();
  const isCsv = /\.csv$/i.test(filename);
  try {
    if (isCsv) await workbook.csv.read(Readable.from(buffer));
    else await workbook.xlsx.load(buffer);
  } catch (error) {
    // ExcelJS surfaces low-level zip errors that mean nothing to an administrator.
    const looksCorrupt = /zip|central directory|end of data/i.test(error.message || "");
    throw badRequest(
      looksCorrupt
        ? "ไฟล์นี้ไม่ใช่ไฟล์ Excel ที่สมบูรณ์ หากบันทึกมาจากโปรแกรมอื่น ให้เปิดด้วย Excel หรือ Google Sheets แล้วบันทึกใหม่เป็น .xlsx"
        : "อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบว่าเป็นไฟล์ .xlsx หรือ .csv ที่ถูกต้องและไม่ได้ตั้งรหัสผ่านไว้",
      { reason: error.message }
    );
  }

  const worksheet = workbook.worksheets.find((sheet) => sheet.rowCount > 1) || workbook.worksheets[0];
  if (!worksheet) throw badRequest("ไม่พบข้อมูลในไฟล์ที่อัปโหลด");

  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => { headers[columnNumber] = normalizeText(cellText(cell.value)); });
  if (!headers.filter(Boolean).length) throw badRequest("แถวแรกของไฟล์ต้องเป็นชื่อคอลัมน์");

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const item = { __row: rowNumber };
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const header = headers[columnNumber];
      if (header) item[header] = cellText(cell.value);
    });
    if (Object.keys(item).length > 1) rows.push(item);
  });
  return { headers: headers.filter(Boolean), rows };
}

function pick(row, aliases) {
  const key = Object.keys(row).find((header) => aliases.some((alias) => searchKey(header) === searchKey(alias)));
  return key ? normalizeText(row[key]) : "";
}

export function mapRow(row) {
  const firstName = pick(row, COLUMN_ALIASES.firstName);
  const lastName = pick(row, COLUMN_ALIASES.lastName);
  const batch = parseBatch(pick(row, COLUMN_ALIASES.batch));
  const studentId = onlyDigits(pick(row, COLUMN_ALIASES.studentId));
  const idCardLast5 = onlyDigits(pick(row, COLUMN_ALIASES.idCardLast5)).slice(-5);
  const title = pick(row, COLUMN_ALIASES.title);
  const currentFirstName = pick(row, COLUMN_ALIASES.currentFirstName);
  const currentLastName = pick(row, COLUMN_ALIASES.currentLastName);
  const outreachEmail = pick(row, COLUMN_ALIASES.outreachEmail).toLowerCase();
  const outreachPhone = pick(row, COLUMN_ALIASES.outreachPhone);
  const note = pick(row, COLUMN_ALIASES.note);

  const errors = [];
  if (!firstName) errors.push("ไม่มีชื่อ");
  if (!lastName) errors.push("ไม่มีนามสกุล");
  if (batch === null) errors.push(`รุ่นไม่ถูกต้อง (ต้องเป็น 1-${config.maxBatch})`);
  if (idCardLast5.length !== 5) errors.push("เลขท้ายบัตรประชาชนต้องมี 5 หลัก");
  if (errors.length) return { ok: false, rowNumber: row.__row, errors };

  const warnings = [];
  if (!studentId) warnings.push("ไม่มีรหัสนิสิต — ระบบจะสร้างรหัสระเบียนจากชื่อและรุ่นแทน");
  if (outreachEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(outreachEmail)) warnings.push("รูปแบบอีเมลไม่ถูกต้อง จึงไม่บันทึกอีเมล");

  return {
    ok: true,
    rowNumber: row.__row,
    warnings,
    value: {
      firstName,
      lastName,
      batch,
      studentId,
      idCardLast5,
      title,
      currentFirstName,
      currentLastName,
      outreachEmail: warnings.some((item) => item.includes("อีเมล")) ? "" : outreachEmail,
      outreachPhone: onlyDigits(outreachPhone),
      note: note.slice(0, 300)
    }
  };
}

/**
 * Read and validate a workbook without writing anything.
 *
 * Splitting parse from write is what lets the browser show a real progress
 * bar: it gets the validated rows back, then feeds them to `writeImportRows`
 * in slices and counts completed slices.
 */
export async function parseImportWorkbook({ buffer, filename }) {
  const { headers, rows } = await readWorkbookRows(buffer, filename);
  if (!rows.length) throw badRequest("ไม่พบแถวข้อมูลในไฟล์");

  const mapped = rows.map(mapRow);
  const invalid = mapped.filter((item) => !item.ok);
  const valid = mapped.filter((item) => item.ok);
  if (!valid.length) {
    throw badRequest("ไม่พบแถวที่ใช้งานได้ กรุณาตรวจสอบชื่อคอลัมน์", {
      headersFound: headers,
      expected: Object.entries(COLUMN_ALIASES).map(([field, aliases]) => ({ field, accepted: aliases })),
      sampleErrors: invalid.slice(0, 10)
    });
  }

  // Collapse duplicate rows that resolve to the same person; last row wins.
  const byId = new Map();
  const duplicates = [];
  valid.forEach((item) => {
    const id = alumniId(item.value);
    if (byId.has(id)) duplicates.push({ rowNumber: item.rowNumber, id });
    byId.set(id, item);
  });

  return {
    jobId: newId("imp"),
    filename,
    headers,
    totalRows: rows.length,
    validRows: valid.length,
    skipped: invalid.length,
    duplicateRows: duplicates.length,
    errors: invalid.slice(0, 200),
    warnings: valid.filter((item) => item.warnings?.length).slice(0, 50).map((item) => ({ rowNumber: item.rowNumber, warnings: item.warnings })),
    entries: [...byId.values()].map((item) => ({ rowNumber: item.rowNumber, value: item.value }))
  };
}

/**
 * Re-validate a row that arrived from the browser. The parsed rows make a
 * round trip through the client so it can drive the progress bar, so nothing
 * coming back is trusted — the same rules as the original parse are applied.
 */
export function validateImportValue(raw) {
  const value = {
    firstName: normalizeText(raw?.firstName),
    lastName: normalizeText(raw?.lastName),
    batch: parseBatch(raw?.batch),
    studentId: onlyDigits(raw?.studentId),
    idCardLast5: onlyDigits(raw?.idCardLast5).slice(-5),
    title: normalizeText(raw?.title),
    currentFirstName: normalizeText(raw?.currentFirstName),
    currentLastName: normalizeText(raw?.currentLastName),
    outreachEmail: normalizeText(raw?.outreachEmail).toLowerCase(),
    outreachPhone: onlyDigits(raw?.outreachPhone),
    note: normalizeText(raw?.note).slice(0, 300)
  };
  if (!value.firstName || !value.lastName || value.batch === null || value.idCardLast5.length !== 5) return null;
  return value;
}

/** Upsert one slice of validated rows. Returns how many were new vs updated. */
export async function writeImportRows({ entries, actor, jobId, filename }) {
  const byId = new Map();
  entries.forEach((entry) => {
    const value = validateImportValue(entry?.value);
    if (value) byId.set(alumniId(value), { rowNumber: entry.rowNumber, value });
  });
  if (!byId.size) return { inserted: 0, updated: 0, written: 0, rejected: entries.length };

  const existing = await getDocsByIds(ALUMNI, [...byId.keys()]);
  const now = new Date().toISOString();
  const documents = [...byId.entries()].map(([id, item]) => {
    const previous = existing.get(id);

    // The "ชื่อปัจจุบัน" columns only seed records the alumnus has not filled in
    // yet. Once someone has submitted, their own answer always wins over the sheet.
    const untouched = !previous || previous.status === "pending";
    const seededName = untouched && (item.value.currentFirstName || item.value.currentLastName)
      ? {
          currentFirstName: item.value.currentFirstName || item.value.firstName,
          currentLastName: item.value.currentLastName || item.value.lastName
        }
      : {};

    return {
      id,
      data: {
        ...(previous ? {} : defaultSubmissionFields(item.value)),
        ...referenceFields(item.value),
        ...seededName,
        createdAt: previous?.createdAt || now,
        updatedAt: now,
        updatedBy: actor?.uid || "system",
        source: { importJobId: jobId, rowNumber: item.rowNumber, filename }
      }
    };
  });

  await bulkSet(ALUMNI, documents, { merge: true });
  const inserted = documents.filter((entry) => !existing.has(entry.id)).length;
  return { inserted, updated: documents.length - inserted, written: documents.length, rejected: entries.length - byId.size };
}

export async function recordImportJob(job) {
  await setDoc(IMPORT_JOBS, job.jobId, job);
  return job;
}

/**
 * Single-shot import: parse then write everything in one request.
 * Used by scripts and the API; the console uses the chunked flow instead so it
 * can show progress.
 */
export async function importAlumniWorkbook({ buffer, filename, actor, dryRun = false }) {
  const startedAt = new Date().toISOString();
  const parsed = await parseImportWorkbook({ buffer, filename });
  const { jobId, headers, totalRows, validRows, skipped, duplicateRows, errors, entries } = parsed;

  const written = dryRun
    ? { inserted: 0, updated: 0 }
    : await writeImportRows({ entries, actor, jobId, filename });

  // A dry run still needs accurate insert/update counts, so look the ids up.
  const counts = dryRun
    ? await previewCounts(entries)
    : written;

  const inserted = counts.inserted;
  const updated = counts.updated;

  const job = {
    jobId,
    filename,
    headers,
    dryRun,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: "completed",
    uploadedBy: actor?.uid || "system",
    uploadedByUsername: actor?.username || "system",
    totalRows,
    validRows,
    inserted,
    updated,
    duplicateRows,
    skipped,
    errors
  };
  if (!dryRun) await recordImportJob(job);
  return job;
}

/** Insert/update split for a dry run, without writing anything. */
async function previewCounts(entries) {
  const ids = entries.map((entry) => {
    const value = validateImportValue(entry?.value);
    return value ? alumniId(value) : "";
  }).filter(Boolean);
  const existing = await getDocsByIds(ALUMNI, ids);
  const unique = new Set(ids);
  let updated = 0;
  unique.forEach((id) => { if (existing.has(id)) updated += 1; });
  return { inserted: unique.size - updated, updated };
}

const EXPORT_COLUMNS = [
  ["รหัสระเบียน", (record) => record.id],
  ["รหัสนิสิต", (record) => record.studentId || ""],
  ["รุ่น", (record) => record.batch],
  ["ชื่อสมัยเรียน", (record) => record.legalFirstName],
  ["นามสกุลสมัยเรียน", (record) => record.legalLastName],
  ["ชื่อที่ใช้ในหนังสือ", (record) => record.currentFirstName || ""],
  ["นามสกุลที่ใช้ในหนังสือ", (record) => record.currentLastName || ""],
  ["ประวัติการเปลี่ยนชื่อ", (record) => (record.nameHistory || []).map((item) => item.fullName).join("; ")],
  ["สถานะ", (record) => ({ submitted: "ยืนยันลงหนังสือ", declined: "ไม่ประสงค์ลงหนังสือ", pending: "ยังไม่ตอบ" }[record.status] || record.status)],
  ["รูปภาพ", (record) => (record.photo?.choice === "upload" ? "ส่งรูปแล้ว" : record.photo?.choice === "placeholder" ? "ใช้ภาพคณะแทน" : "")],
  ["ลิงก์รูปภาพ", (record) => record.photo?.downloadUrl || ""],
  ["ช่องทางติดต่อ", (record) => (record.contacts || []).map((contact) => `${contact.type}: ${contact.value}`).join(" | ")],
  ["ประวัติโดยย่อ", (record) => record.bio || ""],
  ["PDPA", (record) => (record.pdpa?.consent ? "ยินยอม" : "ยังไม่ยินยอม")],
  ["เวลาที่ยินยอม", (record) => record.pdpa?.consentAt || ""],
  ["เวอร์ชันคำยินยอม", (record) => record.pdpa?.version || ""],
  ["เวลาที่ส่งข้อมูล", (record) => record.submittedAt || ""]
];

/** Follow-up columns. Only added when an administrator explicitly asks for them. */
const OUTREACH_COLUMNS = [
  ["อีเมลสำหรับติดต่อ", (record) => record.outreach?.email || ""],
  ["เบอร์โทรสำหรับติดต่อ", (record) => record.outreach?.phone || ""],
  ["หมายเหตุจากไฟล์นำเข้า", (record) => record.outreach?.note || ""]
];

/**
 * Excel export. The ID-card hash is never included.
 *
 * `includeOutreach` adds the administrator's follow-up contact columns. It is
 * off by default so the file handed to the design team carries only what the
 * alumnus consented to publish.
 */
export async function buildExportWorkbook(records, { includeOutreach = false } = {}) {
  const columns = includeOutreach ? [...EXPORT_COLUMNS, ...OUTREACH_COLUMNS] : EXPORT_COLUMNS;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ระบบหนังสืออนุสรณ์ สภจ. 2569";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("yearbook-2569");
  worksheet.columns = columns.map(([header]) => ({ header, key: header, width: Math.max(16, header.length + 6) }));
  records.forEach((record) => worksheet.addRow(Object.fromEntries(columns.map(([header, read]) => [header, read(record)]))));
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2E7D5" } };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return workbook.xlsx.writeBuffer();
}

/**
 * Column plan for the import template.
 * `required` drives the header colour and the instruction sheet.
 */
const TEMPLATE_COLUMNS = [
  { header: "คำนำหน้า", width: 12, required: false, text: false, purpose: "คำนำหน้าชื่อสมัยเรียน เช่น นาย นางสาว", example: "นาย" },
  { header: "ชื่อ", width: 20, required: true, text: false, purpose: "ชื่อจริง “สมัยเรียน” ใช้ให้นิสิตเก่าค้นหาตัวเอง", example: "สมชาย" },
  { header: "นามสกุล", width: 22, required: true, text: false, purpose: "นามสกุล “สมัยเรียน” ใช้ให้นิสิตเก่าค้นหาตัวเอง", example: "ใจดี" },
  { header: "รุ่น", width: 8, required: true, text: false, purpose: `ตัวเลข 1-${config.maxBatch} ใช้กรองก่อนค้นหาชื่อเสมอ`, example: 45 },
  { header: "รหัสนิสิต", width: 14, required: false, text: true, purpose: "แนะนำอย่างยิ่ง — ทำให้นำเข้าไฟล์ซ้ำเป็นการอัปเดต ไม่สร้างข้อมูลซ้ำ", example: "2676061" },
  { header: "เลขท้ายบัตรประชาชน 5 หลัก", width: 26, required: true, text: true, purpose: "ใช้ยืนยันตัวตน เก็บแบบเข้ารหัสทางเดียว ไม่ปรากฏในหนังสือหรือไฟล์ส่งออก", example: "12345" },
  { header: "ชื่อปัจจุบัน", width: 20, required: false, text: false, purpose: "ถ้าสมาคมทราบว่าเปลี่ยนชื่อแล้ว ระบบจะเติมให้ล่วงหน้า (เจ้าตัวแก้ได้)", example: "สมชาย" },
  { header: "นามสกุลปัจจุบัน", width: 22, required: false, text: false, purpose: "เช่นเดียวกับชื่อปัจจุบัน — จะไม่ทับข้อมูลที่เจ้าตัวกรอกเองแล้ว", example: "ใจงาม" },
  { header: "อีเมลสำหรับติดต่อ", width: 26, required: false, text: false, purpose: "สำหรับผู้ดูแลใช้ติดตามให้มากรอกข้อมูล ไม่ลงหนังสือ", example: "somchai@example.com" },
  { header: "เบอร์โทรสำหรับติดต่อ", width: 20, required: false, text: true, purpose: "สำหรับผู้ดูแลใช้ติดตาม ไม่ลงหนังสือ", example: "0812345678" },
  { header: "หมายเหตุ", width: 30, required: false, text: false, purpose: "บันทึกภายใน เช่น ติดต่อไม่ได้ / ย้ายต่างประเทศ", example: "ตัวแทนรุ่นยืนยันข้อมูลแล้ว" }
];

const HEADER_REQUIRED = "FFE8D7A8";
const HEADER_OPTIONAL = "FFE6ECE0";

/**
 * Import template with two sheets: an empty, validated data sheet and an
 * instruction sheet that carries the example rows. Keeping the examples off the
 * data sheet means nobody can accidentally import "สมชาย ใจดี" as a real person.
 */
export async function buildImportTemplate({ rows = [] } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ระบบหนังสืออนุสรณ์ สภจ. 2569";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("รายชื่อนิสิตเก่า", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = TEMPLATE_COLUMNS.map((column) => ({ header: column.header, key: column.header, width: column.width }));

  const headerRow = sheet.getRow(1);
  headerRow.height = 34;
  headerRow.font = { bold: true, size: 11 };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  TEMPLATE_COLUMNS.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: column.required ? HEADER_REQUIRED : HEADER_OPTIONAL } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFAAB3A2" } } };
    cell.note = `${column.required ? "จำเป็นต้องกรอก" : "ไม่บังคับ"}\n${column.purpose}`;
  });

  // Force text format on identifier columns so Excel keeps leading zeros.
  TEMPLATE_COLUMNS.forEach((column, index) => {
    if (column.text) sheet.getColumn(index + 1).numFmt = "@";
  });

  rows.forEach((row) => sheet.addRow(row));

  // Validation on 2,000 blank rows — enough for the largest batch, and the
  // rules survive copy-paste from the association's own spreadsheet.
  const batchColumn = TEMPLATE_COLUMNS.findIndex((column) => column.header === "รุ่น") + 1;
  const idColumn = TEMPLATE_COLUMNS.findIndex((column) => column.header === "เลขท้ายบัตรประชาชน 5 หลัก") + 1;
  for (let row = 2; row <= 2000; row += 1) {
    sheet.getCell(row, batchColumn).dataValidation = {
      type: "whole",
      operator: "between",
      formulae: [1, config.maxBatch],
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: "รุ่นไม่ถูกต้อง",
      error: `กรุณากรอกรุ่นเป็นตัวเลข 1 ถึง ${config.maxBatch}`
    };
    sheet.getCell(row, idColumn).dataValidation = {
      type: "textLength",
      operator: "equal",
      formulae: [5],
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: "เลขท้ายบัตรประชาชนไม่ถูกต้อง",
      error: "ต้องเป็นตัวเลข 5 หลักพอดี หากขึ้นต้นด้วย 0 ให้จัดรูปแบบเซลล์เป็นข้อความ"
    };
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: TEMPLATE_COLUMNS.length } };

  buildInstructionSheet(workbook);
  return workbook.xlsx.writeBuffer();
}

function buildInstructionSheet(workbook) {
  const guide = workbook.addWorksheet("คำแนะนำการกรอก");
  guide.columns = [{ width: 28 }, { width: 12 }, { width: 62 }, { width: 24 }];

  const title = guide.addRow(["วิธีเตรียมไฟล์รายชื่อนิสิตเก่า"]);
  title.font = { bold: true, size: 14 };
  guide.mergeCells(`A${title.number}:D${title.number}`);
  guide.addRow([]);

  [
    "1. กรอกข้อมูลในชีต “รายชื่อนิสิตเก่า” เท่านั้น หนึ่งคนต่อหนึ่งแถว ห้ามลบหรือแก้ไขแถวหัวตาราง",
    "2. คอลัมน์พื้นหลังสีเข้มคือคอลัมน์ที่จำเป็น หากขาดข้อมูลระบบจะข้ามแถวนั้นและรายงานให้ทราบ",
    "3. ลำดับคอลัมน์สลับกันได้ ระบบอ่านจากชื่อหัวคอลัมน์ และจะไม่สนใจคอลัมน์อื่นที่เพิ่มเข้ามา",
    "4. “รหัสนิสิต” ไม่บังคับ แต่แนะนำอย่างยิ่ง เพราะเป็นตัวระบุตัวตนถาวรของแต่ละระเบียน",
    "5. อัปโหลดที่หน้า /admin แท็บ “นำเข้า / ส่งออก” แล้วกด “ตรวจสอบไฟล์ก่อน” เพื่อดูผลโดยยังไม่บันทึก",
    "6. นำเข้าไฟล์เดิมซ้ำได้เสมอ ระบบจะอัปเดตข้อมูลอ้างอิงให้ โดยไม่ทับข้อมูลที่นิสิตเก่ากรอกไว้แล้ว"
  ].forEach((line) => {
    const row = guide.addRow([line]);
    guide.mergeCells(`A${row.number}:D${row.number}`);
    row.alignment = { wrapText: true, vertical: "top" };
  });

  guide.addRow([]);
  const specHeader = guide.addRow(["คอลัมน์", "จำเป็น", "คำอธิบาย", "ตัวอย่าง"]);
  specHeader.font = { bold: true };
  specHeader.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_OPTIONAL } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFAAB3A2" } } };
  });

  TEMPLATE_COLUMNS.forEach((column) => {
    const row = guide.addRow([column.header, column.required ? "จำเป็น" : "—", column.purpose, String(column.example)]);
    row.alignment = { wrapText: true, vertical: "top" };
    if (column.required) row.getCell(2).font = { bold: true, color: { argb: "FF8A6A12" } };
  });

  guide.addRow([]);
  const privacy = guide.addRow(["ข้อควรระวังด้านข้อมูลส่วนบุคคล (PDPA)"]);
  privacy.font = { bold: true, size: 12 };
  guide.mergeCells(`A${privacy.number}:D${privacy.number}`);

  [
    "• เลขท้ายบัตรประชาชนใช้เพื่อยืนยันตัวตนเท่านั้น ระบบเก็บเป็นค่าเข้ารหัสทางเดียว อ่านย้อนกลับไม่ได้",
    "• อีเมลและเบอร์โทรในไฟล์นี้ใช้สำหรับผู้ดูแลติดตามงานเท่านั้น จะไม่ถูกนำไปลงหนังสือ",
    "  ช่องทางติดต่อที่ลงหนังสือคือช่องทางที่นิสิตเก่าเลือกและยินยอมด้วยตนเองในระบบ",
    "• ไฟล์ต้นฉบับนี้มีข้อมูลส่วนบุคคล กรุณาเก็บในที่ปลอดภัยและอย่าส่งต่อโดยไม่จำเป็น"
  ].forEach((line) => {
    const row = guide.addRow([line]);
    guide.mergeCells(`A${row.number}:D${row.number}`);
    row.alignment = { wrapText: true, vertical: "top" };
  });

  return guide;
}
