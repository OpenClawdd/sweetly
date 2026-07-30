import { SEARCH_UA, SPICY_USER_AGENT } from "../utils.js";

// MusicBrainz requires an identifying User-Agent and blocks clients that send a
// placeholder contact. Their format is `App/version ( contact )`, where contact
// is a real address or project URL — a fake one is worse than none, so this
// sends the application identity alone. Set SWEETLY_CONTACT to a reachable
// address before distributing this app; MB throttles anonymous clients harder.
const MUSICBRAINZ_UA = process.env.SWEETLY_CONTACT
  ? `SweetlyOverlay/0.1.0 ( ${process.env.SWEETLY_CONTACT} )`
  : "SweetlyOverlay/0.1.0";

async function fetchPage(url, extraHeaders = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": SEARCH_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...extraHeaders,
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    console.log("[Sweetly-Main] Fetched", url.slice(0, 60), ":", res.status, html.length, "bytes");
    return html;
  } catch (e) {
    return null;
  }
}

export async function scrapeSpotifySearch(query, artistName = "") {
  if (!query) return null;
  if (/^[A-Za-z0-9]{22}$/.test(query.trim())) {
    return query.trim();
  }

  // 1. Check MusicBrainz for direct Spotify track relations
  try {
    const mbQuery = artistName ? `recording:"${query}" AND artist:"${artistName}"` : `recording:"${query}"`;
    const mbRes = await fetch(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(mbQuery)}&fmt=json`, {
      headers: { "User-Agent": MUSICBRAINZ_UA },
    });
    if (mbRes.ok) {
      const mbData = await mbRes.json();
      for (const rec of mbData.recordings || []) {
        for (const rel of rec.relations || []) {
          if (rel.url?.resource?.includes("open.spotify.com/track/")) {
            const m = rel.url.resource.match(/\/track\/([A-Za-z0-9]{22})/);
            if (m) {
              console.log("[Sweetly-Main] Spotify track resolved via MusicBrainz:", m[1]);
              return m[1];
            }
          }
        }
      }
    }
  } catch {}

  const encoded = encodeURIComponent(query);

  // 2. Check DuckDuckGo HTML search for site:open.spotify.com/track
  const ddgHtml = await fetchPage(`https://html.duckduckgo.com/html/?q=${encodeURIComponent("site:open.spotify.com/track " + query)}`, {
    "Referer": "https://html.duckduckgo.com/",
  });
  if (ddgHtml) {
    const ddgMatch = ddgHtml.match(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})/);
    if (ddgMatch) {
      console.log("[Sweetly-Main] Spotify scrape: found via DDG", ddgMatch[1]);
      return ddgMatch[1];
    }
  }

  // 3. Fall back to Spotify search pages
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
        "SpicyLyrics-Version": "1.0.0",
        "X-mode": "2",
        "User-Agent": SPICY_USER_AGENT,
      },
      body: JSON.stringify({
        queries: [{ operationId: "0", operation: "lyrics", variables: { id: spotifyTrackId } }],
        client: { version: "1.0.0" },
      }),
    });
    if (!res.ok) {
      console.log("[Sweetly-Main] SpicyLyrics API HTTP", res.status, "(falling through to BiniLyrics/LRCLIB)");
      return null;
    }
    const data = await res.json();
    const result = data.queries?.[0]?.result;
    if (result?.httpStatus !== 200 || !result?.data) return null;
    return result.data;
  } catch (e) {
    console.log("[Sweetly-Main] SpicyLyrics API fetch error:", e.message);
    return null;
  }
}
