/**
 * Canonical filename keys for ~/.sweetly-custom/*.ttml
 *
 * Three places touch this directory — the reader (sources/custom.js), the
 * background aligner (autoAligner.js), and the CLI converter
 * (scripts/convert-whisperx.js). They previously each rolled their own
 * slugifier and disagreed, so files written by one were invisible to the
 * others. Everything goes through customKey() now.
 *
 * The slug is deliberately lossy (lowercase, non-alphanumerics collapsed to a
 * single underscore) so that filenames produced by any of the older schemes
 * normalize onto the same key and keep resolving.
 */

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

export function customKey(name, artist) {
  const n = slugify(name);
  const a = slugify(artist);
  if (!n) return "";
  return a ? `${n}_${a}` : n;
}

/** Strip the extensions we write into the custom dir. */
export function stripLyricsExt(filename) {
  return String(filename || "").replace(/\.(ttml|json)$/i, "");
}

/** Drop parenthetical/bracketed qualifiers: "Song (Deluxe) [Remastered]" -> "Song". */
export function stripQualifiers(value) {
  return String(value || "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s*\[[^\]]*\]/g, "")
    .trim();
}

/**
 * Ordered lookup keys for a track, most specific first.
 * Callers try each in turn and take the first file that matches.
 */
export function customKeyCandidates(name, artist) {
  const bareName = stripQualifiers(name);
  const bareArtist = stripQualifiers(artist);
  const candidates = [
    customKey(name, artist),
    customKey(bareName, bareArtist),
    customKey(bareName, artist),
    customKey(name, ""),
    customKey(bareName, ""),
  ];
  return [...new Set(candidates.filter(Boolean))];
}
