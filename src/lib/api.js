const TOKEN_KEY = "alumni.session.token";

export const session = {
  get token() {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  },
  save(token) {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    sessionStorage.removeItem(TOKEN_KEY);
  }
};

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/**
 * Thin fetch wrapper. Attaches the bearer token, unwraps JSON and turns any
 * non-2xx response into an ApiError carrying the server's Thai message.
 */
export async function api(path, { method = "GET", body, headers = {}, auth = true, raw = false } = {}) {
  const options = { method, headers: { ...headers } };
  if (auth && session.token) options.headers.Authorization = `Bearer ${session.token}`;
  if (body instanceof FormData) options.body = body;
  else if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(path, options);
  if (raw) {
    if (!response.ok) throw new ApiError(response.status, "ดาวน์โหลดไฟล์ไม่สำเร็จ");
    return response.blob();
  }

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(response.status, "ระบบตอบกลับในรูปแบบที่ไม่รองรับ");
  }
  if (!response.ok) {
    if (response.status === 401 && auth && session.token) session.clear();
    throw new ApiError(response.status, data.message || "เกิดข้อผิดพลาด", data.details);
  }
  return data;
}

export async function download(path, filename) {
  const blob = await api(path, { raw: true });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
