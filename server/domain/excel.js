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
  title: ["คำนำหน้า", "คำนำหน้าชื่อ", "title", "prefix"]
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
    throw badRequest(`อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบว่าเป็นไฟล์ .xlsx หรือ .csv ที่ถูกต้อง (${error.message})`);
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

  const errors = [];
  if (!firstName) errors.push("ไม่มีชื่อ");
  if (!lastName) errors.push("ไม่มีนามสกุล");
  if (batch === null) errors.push(`รุ่นไม่ถูกต้อง (ต้องเป็น 1-${config.maxBatch})`);
  if (idCardLast5.length !== 5) errors.push("เลขท้ายบัตรประชาชนต้องมี 5 หลัก");
  if (errors.length) return { ok: false, rowNumber: row.__row, errors };

  return { ok: true, rowNumber: row.__row, value: { firstName, lastName, batch, studentId, idCardLast5, title } };
}

/**
 * Import an alumni master list. Existing records keep every field the alumnus
 * has already submitted; only the reference columns are overwritten.
 */
export async function importAlumniWorkbook({ buffer, filename, actor, dryRun = false }) {
  const startedAt = new Date().toISOString();
  const { headers, rows } = await readWorkbookRows(buffer, filename);
  if (!rows.length) throw badRequest("ไม่พบแถวข้อมูลในไฟล์");

  const jobId = newId("imp");
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

  const existing = await getDocsByIds(ALUMNI, [...byId.keys()]);
  const now = new Date().toISOString();
  const entries = [...byId.entries()].map(([id, item]) => {
    const previous = existing.get(id);
    return {
      id,
      data: {
        ...(previous ? {} : defaultSubmissionFields(item.value)),
        ...referenceFields(item.value),
        createdAt: previous?.createdAt || now,
        updatedAt: now,
        updatedBy: actor?.uid || "system",
        source: { importJobId: jobId, rowNumber: item.rowNumber, filename }
      }
    };
  });

  const inserted = entries.filter((entry) => !existing.has(entry.id)).length;
  const updated = entries.length - inserted;

  if (!dryRun) await bulkSet(ALUMNI, entries, { merge: true });

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
    totalRows: rows.length,
    validRows: valid.length,
    inserted,
    updated,
    duplicateRows: duplicates.length,
    skipped: invalid.length,
    errors: invalid.slice(0, 200)
  };
  if (!dryRun) await setDoc(IMPORT_JOBS, jobId, job);
  return job;
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

/** Excel export. The ID-card hash is never included. */
export async function buildExportWorkbook(records) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ระบบหนังสืออนุสรณ์ สภจ. 2569";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("yearbook-2569");
  worksheet.columns = EXPORT_COLUMNS.map(([header]) => ({ header, key: header, width: Math.max(16, header.length + 6) }));
  records.forEach((record) => worksheet.addRow(Object.fromEntries(EXPORT_COLUMNS.map(([header, read]) => [header, read(record)]))));
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2E7D5" } };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_COLUMNS.length } };
  return workbook.xlsx.writeBuffer();
}

/** Blank spreadsheet an administrator can fill in and re-upload. */
export async function buildImportTemplate() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("รายชื่อนิสิตเก่า");
  const headers = ["คำนำหน้า", "ชื่อ", "นามสกุล", "รุ่น", "รหัสนิสิต", "เลขท้ายบัตรประชาชน 5 หลัก"];
  worksheet.columns = headers.map((header) => ({ header, key: header, width: Math.max(18, header.length + 6) }));
  worksheet.addRow({ "คำนำหน้า": "นาย", "ชื่อ": "สมชาย", "นามสกุล": "ใจดี", "รุ่น": 45, "รหัสนิสิต": "2676061", "เลขท้ายบัตรประชาชน 5 หลัก": "12345" });
  worksheet.getRow(1).font = { bold: true };
  worksheet.getColumn("เลขท้ายบัตรประชาชน 5 หลัก").numFmt = "@";
  worksheet.getColumn("รหัสนิสิต").numFmt = "@";
  return workbook.xlsx.writeBuffer();
}
