import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config, uploadsDir } from "../lib/env.js";
import { storageBucket } from "../lib/db.js";
import { badRequest } from "../lib/http.js";

/** Formats accepted after decoding — the client-declared MIME type is not trusted. */
const ACCEPTED_FORMATS = ["jpeg", "jpg", "png", "webp", "heif", "heic", "avif"];

/**
 * Normalize an uploaded photo entirely in memory: honour the EXIF orientation,
 * strip metadata, fit inside 1600x1600 and re-encode as JPEG. Working from the
 * buffer (rather than a temp file) is what makes this work inside Cloud
 * Functions, where the filesystem is read-only apart from /tmp.
 */
export async function normalizePhoto(file) {
  if (!file?.buffer?.length) throw badRequest("ไม่พบไฟล์รูปภาพ");
  if (file.buffer.length > config.maxUploadBytes) {
    throw badRequest(`ไฟล์รูปภาพต้องมีขนาดไม่เกิน ${Math.round(config.maxUploadBytes / (1024 * 1024))} MB`);
  }

  let metadata;
  const image = sharp(file.buffer, { limitInputPixels: 40_000_000, failOn: "error" });
  try {
    metadata = await image.metadata();
  } catch (error) {
    throw badRequest(`ไฟล์รูปภาพไม่สมบูรณ์หรืออ่านไม่ได้ (${error.message})`);
  }
  if (!ACCEPTED_FORMATS.includes(String(metadata.format).toLowerCase())) {
    throw badRequest("รองรับเฉพาะไฟล์ JPG, PNG, WEBP, HEIC และ HEIF");
  }
  if (!metadata.width || !metadata.height) throw badRequest("ไฟล์รูปภาพไม่สมบูรณ์");

  try {
    const buffer = await image
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    return { buffer, width: metadata.width, height: metadata.height, mimeType: "image/jpeg" };
  } catch (error) {
    throw badRequest(`ประมวลผลรูปภาพไม่สำเร็จ (${error.message})`);
  }
}

function destinationFor(record) {
  const stem = `${record.studentId || record.id}_${record.currentFirstName || record.legalFirstName}_${record.currentLastName || record.legalLastName}`
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "");
  return `${config.storageFolder}/batch-${String(record.batch).padStart(2, "0")}/${stem}_${Date.now()}.jpg`;
}

/**
 * Store the normalized photo. Uses Firebase Storage when configured and the
 * local `uploads/` folder otherwise, so local development stays usable.
 */
export async function storePhoto(record, normalized) {
  const destination = destinationFor(record);

  if (!storageBucket) {
    const localName = destination.replace(/\//g, "__");
    fs.writeFileSync(path.join(uploadsDir, localName), normalized.buffer);
    return {
      choice: "upload",
      bucket: "local",
      storagePath: localName,
      downloadUrl: `/uploads/${localName}`,
      width: normalized.width,
      height: normalized.height,
      bytes: normalized.buffer.length,
      updatedAt: new Date().toISOString()
    };
  }

  const token = crypto.randomUUID();
  await storageBucket.file(destination).save(normalized.buffer, {
    resumable: false,
    contentType: "image/jpeg",
    metadata: {
      contentType: "image/jpeg",
      cacheControl: "private, max-age=3600",
      metadata: { firebaseStorageDownloadTokens: token, alumniId: record.id, batch: String(record.batch) }
    }
  });

  return {
    choice: "upload",
    bucket: storageBucket.name,
    storagePath: destination,
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${storageBucket.name}/o/${encodeURIComponent(destination)}?alt=media&token=${token}`,
    width: normalized.width,
    height: normalized.height,
    bytes: normalized.buffer.length,
    updatedAt: new Date().toISOString()
  };
}

export async function deletePhoto(photo) {
  if (!photo?.storagePath) return;
  try {
    if (photo.bucket === "local") {
      const file = path.join(uploadsDir, photo.storagePath);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } else if (storageBucket) {
      await storageBucket.file(photo.storagePath).delete({ ignoreNotFound: true });
    }
  } catch (error) {
    console.error("delete photo failed", error?.message);
  }
}
