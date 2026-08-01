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
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
    const mbQuery = artistName
      ? `recording:"${query}" AND artist:"${artistName}"`
      : `recording:"${query}"`;
    const mbRes = await fetch(
      `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(mbQuery)}&fmt=json`,
      {
        headers: { "User-Agent": MUSICBRAINZ_UA },
      }
    );
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
  const ddgHtml = await fetchPage(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent("site:open.spotify.com/track " + query)}`,
    {
      Referer: "https://html.duckduckgo.com/",
    }
  );
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

/**
 * The version we claim is the Spicy Lyrics release this host actually vendors
 * (see NOTICE), not the Sweetly version from package.json. The server reads it
 * to decide what response shape a client can handle, so it has to describe the
 * renderer we are really running.
 */
const SPICY_CLIENT_VERSION = "6.2.3";

/** The header the API expects the bearer token in, named back to it in `variables.auth`. */
const AUTH_HEADER = "SpicyLyrics-WebAuth";

/**
 * Ask api.spicylyrics.org for a track's lyrics.
 *
 * Shaped to match the official client (`utils/API/Query.ts` plus the call in
 * `utils/Lyrics/fetchLyrics.ts` of the upstream clone) because the endpoint
 * validates the whole envelope: omitting `X-mode` alone gets a flat
 * `400 Invalid Request` before the operation is even looked at.
 *
 * Authorization is a real Spotify token for the signed-in user. Without one the
 * server answers 401 and we fall through to the next source rather than
 * retrying, since nothing about the request will change until someone signs in.
 */
export async function fetchSpicyLyricsData(spotifyTrackId, accessToken = null) {
  if (!spotifyTrackId) return null;
  try {
    const res = await fetch("https://api.spicylyrics.org/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "SpicyLyrics-Version": SPICY_CLIENT_VERSION,
        "X-mode": "2",
        "User-Agent": SPICY_USER_AGENT,
        ...(accessToken ? { [AUTH_HEADER]: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        queries: [
          {
            operation: "lyrics",
            variables: {
              id: spotifyTrackId,
              ...(accessToken ? { auth: AUTH_HEADER } : {}),
            },
          },
        ],
        client: { version: SPICY_CLIENT_VERSION },
      }),
    });
    if (!res.ok) {
      console.log(
        "[Sweetly-Main] SpicyLyrics API HTTP",
        res.status,
        "(falling through to BiniLyrics/LRCLIB)"
      );
      return null;
    }

    const data = await res.json();
    // Results are keyed by operationId, not ordered. Reading [0] happened to
    // work for a single-operation request and would silently pick the wrong
    // answer the moment one is batched.
    const result = (data?.queries ?? []).find((job) => job?.operationId === "0")?.result;
    if (!result) {
      console.log("[Sweetly-Main] SpicyLyrics API returned no result for operation 0");
      return null;
    }

    if (result.httpStatus === 401) {
      console.log(
        "[Sweetly-Main] SpicyLyrics API needs a Spotify sign-in — run `node scripts/spotify-login.mjs`"
      );
      return null;
    }
    if (result.httpStatus === 503) {
      // The track is queued for processing server-side. Upstream keeps a
      // retry loop with backoff; here the next track change re-asks anyway.
      console.log("[Sweetly-Main] SpicyLyrics API has this track queued, trying again later");
      return null;
    }
    if (result.httpStatus !== 200 || !result.data) {
      if (result.httpStatus !== 404) {
        console.log("[Sweetly-Main] SpicyLyrics API status", result.httpStatus);
      }
      return null;
    }

    return await unpackLyrics(result.data);
  } catch (e) {
    console.log("[Sweetly-Main] SpicyLyrics API fetch error:", e.message);
    return null;
  }
}

/**
 * Responses come back through SLObjPack, upstream's structural packer. The
 * vendored copy is the same implementation the official client decodes with, so
 * it is imported rather than reimplemented — a hand-rolled decoder would be a
 * second definition of the wire format to keep in step.
 *
 * Imported lazily because it is TypeScript: keeping it out of module scope means
 * a failure to load degrades this one source instead of the whole main process.
 */
async function unpackLyrics(packed) {
  try {
    const { SLObjPack } = await import("../../../utils/objpack.ts");
    return new SLObjPack().unpack(packed);
  } catch (e) {
    console.log("[Sweetly-Main] SpicyLyrics unpack failed:", e.message);
    return null;
  }
}
