export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, message, details);
export const unauthorized = (message = "กรุณาเข้าสู่ระบบ") => new ApiError(401, message);
export const forbidden = (message = "ไม่มีสิทธิ์ใช้งานส่วนนี้") => new ApiError(403, message);
export const notFound = (message = "ไม่พบข้อมูล") => new ApiError(404, message);
export const tooMany = (message = "ทำรายการถี่เกินไป กรุณารอสักครู่") => new ApiError(429, message);

/** Wraps an async route so rejected promises reach the error handler. */
export const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function errorHandler(error, _req, res, _next) {
  const status = error?.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    message: status >= 500 ? "เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง" : error.message,
    details: error?.details
  });
}

/** Fixed-window rate limiter kept in process memory. */
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return function consume(key) {
    const now = Date.now();
    const history = (hits.get(key) || []).filter((time) => now - time < windowMs);
    if (history.length >= max) {
      hits.set(key, history);
      return false;
    }
    history.push(now);
    hits.set(key, history);
    if (hits.size > 5000) {
      for (const [existing, times] of hits) {
        if (!times.some((time) => now - time < windowMs)) hits.delete(existing);
      }
    }
    return true;
  };
}

export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "unknown";
}
