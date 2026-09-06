export const thai = (value) => Number(value || 0).toLocaleString("th-TH");

export const FACULTY_TITLES = ["ศ.", "รศ.", "ผศ.", "อ.", "ศ.ดร.", "รศ.ดร.", "ผศ.ดร.", "อ.ดร."];

export function formatPhoneInput(value) {
  const digits = String(value).replace(/\D/g, "").slice(0, 10);
  if (digits.length > 6) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length > 3) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return digits;
}

export function formatPhone(digits) {
  const value = String(digits || "").replace(/\D/g, "");
  if (value.length === 10) return `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}`;
  if (value.length === 9) return `${value.slice(0, 2)}-${value.slice(2, 5)}-${value.slice(5)}`;
  return value || "—";
}

export function formatTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return value;
  }
}
