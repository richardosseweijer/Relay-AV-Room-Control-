const COMMON = new Set([
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "1234", "4321", "1212", "1122", "1221", "2112", "2580", "0852", "1313", "1000", "2000",
  "0123", "12345", "00000", "11111",
]);

export function isWeakPin(pin: string | null | undefined) {
  const p = String(pin ?? "").trim();
  if (p.length < 4) return true;
  if (/^(\d)\1+$/.test(p)) return true;
  if ("01234567890".includes(p) || "09876543210".includes(p)) return true;
  return COMMON.has(p);
}

export function isHashedPin(stored: string | null | undefined) {
  return String(stored ?? "").startsWith("scrypt$");
}
