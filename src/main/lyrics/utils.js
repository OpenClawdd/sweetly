export const SPICY_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export const SEARCH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export function parseTTMLTime(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  const clean = String(ts).replace(/s$/i, "").replace(/^['"]+|['"]+$/g, "").trim();
  if (!clean) return 0;
  const parts = clean.split(":");
  if (parts.length === 3) return parseFloat(parts[0] || 0) * 3600 + parseFloat(parts[1] || 0) * 60 + parseFloat(parts[2] || 0);
  if (parts.length === 2) return parseFloat(parts[0] || 0) * 60 + parseFloat(parts[1] || 0);
  return parseFloat(clean) || 0;
}
