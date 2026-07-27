import { SEARCH_UA, SPICY_USER_AGENT } from "../utils.js";

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": SEARCH_UA, "Accept": "text/html,*/*", "Accept-Language": "en-US" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    console.log("[Sweetly-Main] Fetched", url.slice(0, 60), ":", res.status, html.length, "bytes");
    return html;
  } catch (e) {
    return null;
  }
}

export async function scrapeSpotifySearch(query) {
  const encoded = encodeURIComponent(query);
  let html = await fetchPage(`https://open.spotify.com/embed/search/${encoded}`);
  if (!html) html = await fetchPage(`https://open.spotify.com/search/${encoded}`);
  if (!html) {
    console.log("[Sweetly-Main] Spotify scrape: no page loaded");
    return null;
  }

  const patterns = [
    /spotify:track:([A-Za-z0-9]{22})/,
    /"uri":"spotify:track:([A-Za-z0-9]{22})"/,
    /data\-uri="spotify:track:([^"]+)"/,
    /\/track\/([A-Za-z0-9]{22})/,
    /open\.spotify\.com\/track\/([A-Za-z0-9]{22})/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      console.log("[Sweetly-Main] Spotify scrape: found", m[1]);
      return m[1];
    }
  }
  console.log("[Sweetly-Main] Spotify scrape: no match in", html.length, "bytes");
  return null;
}

export async function fetchSpicyLyricsData(spotifyTrackId) {
  if (!spotifyTrackId) return null;
  try {
    const res = await fetch("https://api.spicylyrics.org/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": SPICY_USER_AGENT,
      },
      body: JSON.stringify({
        queries: [{ operation: "lyrics", variables: { id: spotifyTrackId } }],
        client: { version: "0.1.0" },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.queries?.[0]?.result;
    if (result?.httpStatus !== 200 || !result?.data) return null;
    return result.data;
  } catch {
    return null;
  }
}
