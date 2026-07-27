export let customLyricsStore = {};

export function getCustomLyrics(name, artist) {
  const key = `${name}|||${artist}`;
  return customLyricsStore[key] || null;
}

export function saveCustomLyrics(name, artist, ttml) {
  const key = `${name}|||${artist}`;
  customLyricsStore[key] = ttml;
  return true;
}
