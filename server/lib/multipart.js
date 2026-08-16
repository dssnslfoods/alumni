import Busboy from "busboy";
import { Readable } from "node:stream";
import { config } from "./env.js";

export class UploadError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

/**
 * Parse a multipart/form-data request into memory buffers.
 *
 * Firebase Cloud Functions consumes the request stream before Express sees it
 * and exposes the bytes as `req.rawBody`. Reading `req.rawBody` when present —
 * and only piping the live stream otherwise — is what makes uploads work in
 * both runtimes. The previous implementation also resolved on Busboy's
 * `finish` event, which fires before the file streams have flushed, so file
 * buffers arrived empty or truncated. Busboy 1.x signals completion with
 * `close`, which is what we wait for here.
 */
export function parseMultipart(req, { maxFileBytes = config.maxUploadBytes, maxFiles = 1 } = {}) {
  return new Promise((resolve, reject) => {
    if (!/multipart\/form-data/i.test(req.headers["content-type"] || "")) {
      resolve({ fields: {}, files: {} });
      return;
    }

    const busboy = Busboy({
      headers: req.headers,
      // Busboy defaults form-data parameters to latin1 per the old RFC, which
      // turns a Thai filename into mojibake ("à¸„à¸±à¸§"). Browsers send UTF-8.
      defParamCharset: "utf8",
      limits: { fileSize: maxFileBytes, files: maxFiles, fields: 50 }
    });
    const fields = {};
    const files = {};
    let pending = 0;
    let closed = false;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error instanceof UploadError ? error : new UploadError(error?.message || "อ่านไฟล์ที่อัปโหลดไม่สำเร็จ"));
    };

    const done = () => {
      if (settled || !closed || pending > 0) return;
      settled = true;
      resolve({ fields, files });
    };

    busboy.on("field", (name, value) => { fields[name] = value; });

    busboy.on("file", (name, stream, info) => {
      pending += 1;
      const chunks = [];
      let truncated = false;
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("limit", () => { truncated = true; });
      stream.on("error", fail);
      stream.on("end", () => {
        pending -= 1;
        if (truncated) {
          fail(new UploadError(`ไฟล์มีขนาดเกิน ${Math.round(maxFileBytes / (1024 * 1024))} MB`, 413));
          return;
        }
        files[name] = {
          fieldName: name,
          buffer: Buffer.concat(chunks),
          filename: info.filename || "upload",
          mimeType: info.mimeType || "application/octet-stream"
        };
        done();
      });
    });

    busboy.on("filesLimit", () => fail(new UploadError("อัปโหลดไฟล์ได้ครั้งละ 1 ไฟล์เท่านั้น")));
    busboy.on("error", fail);
    busboy.on("close", () => { closed = true; done(); });

    if (req.rawBody) Readable.from([req.rawBody]).pipe(busboy);
    else req.pipe(busboy);
  });
}

/**
 * Express middleware. Populates `req.body` with text fields and `req.files`
 * with in-memory file buffers. JSON bodies pass straight through.
 */
export function multipartBody(options) {
  return async (req, res, next) => {
    if (!/multipart\/form-data/i.test(req.headers["content-type"] || "")) return next();
    try {
      const { fields, files } = await parseMultipart(req, options);
      req.body = { ...(req.body || {}), ...fields };
      req.files = files;
      next();
    } catch (error) {
      res.status(error.status || 400).json({ message: error.message });
    }
  };
}
