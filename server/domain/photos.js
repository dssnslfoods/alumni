import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config, uploadsDir } from "../lib/env.js";
import { storageBucket } from "../lib/db.js";
import { badRequest } from "../lib/http.js";

/** Formats accepted after decoding — the client-declared MIME type is not trusted. */
const ACCEPTED_FORMATS = ["jpeg", "jpg", "png", "webp", "heif", "heic", "avif"];

/* ------------------------- print-ready photo policy ----------------------- */

/** Offset printing standard. Everything below is expressed against this. */
const PRINT_DPI = 300;

/**
 * 2000 px on the long edge = 169 mm at 300 dpi, which covers a half-page
 * portrait with room to crop. Yearbook grid portraits are 35-60 mm, so this is
 * generous rather than tight — going larger mostly adds storage cost.
 */
const MAX_EDGE = Number(process.env.PHOTO_MAX_EDGE || 2000);

/** 90 with 4:4:4 chroma is the usual floor for offset print without visible artefacts. */
const JPEG_QUALITY = Number(process.env.PHOTO_JPEG_QUALITY || 90);

/** Below this the photo prints soft at a normal portrait size — flagged, not rejected. */
const MIN_PRINT_EDGE = Number(process.env.PHOTO_MIN_EDGE || 700);

/** Smaller than this cannot be printed acceptably at any size. */
const REJECT_EDGE = 250;

export const printPolicy = { dpi: PRINT_DPI, maxEdge: MAX_EDGE, quality: JPEG_QUALITY, minEdge: MIN_PRINT_EDGE };

const mm = (pixels) => Math.round((pixels / PRINT_DPI) * 25.4);

/**
 * Write the print resolution into the JPEG's JFIF header.
 *
 * sharp's `withMetadata({ density })` would do this, but it also copies the
 * source EXIF back in — including the GPS coordinates a phone camera embeds,
 * which is exactly what must not reach the design team. So the pipeline strips
 * all metadata and the density header is inserted here instead. No re-encode,
 * so there is no extra generation loss.
 */
export function withPrintDensity(buffer, dpi = PRINT_DPI) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return buffer;

  if (buffer[2] === 0xff && buffer[3] === 0xe0 && buffer.toString("latin1", 6, 10) === "JFIF") {
    const patched = Buffer.from(buffer);
    patched[13] = 1; // units: dots per inch
    patched.writeUInt16BE(dpi, 14);
    patched.writeUInt16BE(dpi, 16);
    return patched;
  }

  const app0 = Buffer.alloc(18);
  app0.writeUInt16BE(0xffe0, 0); // APP0 marker
  app0.writeUInt16BE(16, 2); // segment length
  app0.write("JFIF\0", 4, "latin1");
  app0[9] = 1; // version 1.02
  app0[10] = 2;
  app0[11] = 1; // units: dots per inch
  app0.writeUInt16BE(dpi, 12);
  app0.writeUInt16BE(dpi, 14);
  return Buffer.concat([buffer.subarray(0, 2), app0, buffer.subarray(2)]);
}

/**
 * Normalize an uploaded photo for print, entirely in memory.
 *
 * Straighten by EXIF, strip every metadata tag (a phone photo carries the GPS
 * coordinates of where it was taken), convert to sRGB, fit inside the print
 * ceiling and re-encode as 4:4:4 JPEG with a 300 dpi header. Working from the
 * buffer rather than a temp file is what makes this run inside Cloud Functions,
 * where the filesystem is read-only apart from /tmp.
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

  // EXIF orientation swaps the reported dimensions for sideways photos.
  const upright = (metadata.orientation || 0) >= 5;
  const sourceWidth = upright ? metadata.height : metadata.width;
  const sourceHeight = upright ? metadata.width : metadata.height;
  if (Math.min(sourceWidth, sourceHeight) < REJECT_EDGE) {
    throw badRequest(`รูปมีความละเอียดต่ำเกินกว่าจะพิมพ์ได้ (${sourceWidth}x${sourceHeight} พิกเซล) กรุณาใช้รูปที่ด้านสั้นอย่างน้อย ${MIN_PRINT_EDGE} พิกเซล`);
  }

  try {
    const encoded = await image
      .rotate() // apply EXIF orientation, then drop the tag
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      // Phone cameras often shoot Display P3; printers expect a known space.
      .toColorspace("srgb")
      .jpeg({
        quality: JPEG_QUALITY,
        // 4:4:4 keeps full colour resolution. The default 4:2:0 shows colour
        // fringing on edges once a photo is printed rather than viewed on screen.
        chromaSubsampling: "4:4:4",
        mozjpeg: true
      })
      .toBuffer();

    const buffer = withPrintDensity(encoded);
    const output = await sharp(buffer).metadata();
    const shortEdge = Math.min(output.width, output.height);

    return {
      buffer,
      width: output.width,
      height: output.height,
      mimeType: "image/jpeg",
      print: {
        dpi: PRINT_DPI,
        widthMm: mm(output.width),
        heightMm: mm(output.height),
        // "low" means it will look soft at a normal portrait size — the design
        // team gets this list up front instead of discovering it at proofing.
        quality: shortEdge >= MIN_PRINT_EDGE ? "ok" : "low",
        sourceWidth,
        sourceHeight
      }
    };
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
      print: normalized.print || null,
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
    print: normalized.print || null,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Open a stored photo as a readable stream, from either backend.
 * Streaming (rather than buffering) is what lets a whole batch be zipped
 * without holding hundreds of megabytes in memory.
 */
export async function openPhotoStream(photo) {
  if (!photo?.storagePath) return null;
  try {
    if (photo.bucket === "local" || !storageBucket) {
      const file = path.join(uploadsDir, photo.storagePath);
      return fs.existsSync(file) ? fs.createReadStream(file) : null;
    }
    return storageBucket.file(photo.storagePath).createReadStream();
  } catch (error) {
    console.error("open photo failed", photo.storagePath, error?.message);
    return null;
  }
}

/** Remove every stored yearbook photo. Part of the "clear all data" action. */
export async function deleteAllPhotos() {
  if (!storageBucket) {
    const files = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).filter((name) => name !== ".gitkeep") : [];
    files.forEach((name) => fs.unlinkSync(path.join(uploadsDir, name)));
    return files.length;
  }
  const [files] = await storageBucket.getFiles({ prefix: `${config.storageFolder}/` });
  await storageBucket.deleteFiles({ prefix: `${config.storageFolder}/`, force: true });
  return files.length;
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
