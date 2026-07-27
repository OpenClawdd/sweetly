import Store from "electron-store";
import { parseTtmlXmlToJson } from "./lyrics/ttmlXml.js";

const store = new Store({ name: "sweetly-config" });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const DEVELOPER_TOKEN =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiIsImtpZCI6IldlYlBsYXlLaWQifQ.eyJpc3MiOiJBTVBXZWJQbGF5IiwiaWF0IjoxNzg0NTk1NDgzLCJleHAiOjE3OTA2NDM0ODMsInJvb3RfaHR0cHNfb3JpZ2luIjpbImFwcGxlLmNvbSJdfQ.wGNQxVF22xjRId3ZP34tfuDEQ0plV-hxtYOu2SC8AKdAzoCqmLEillT5BVDLdD5x5cyMhB3jJitKZJckRVMVew";

let cachedStorefront = null;
let cachedLanguage = null;

export function getMediaUserToken() {
  return store.get("mediaUserToken") || null;
}

export function setMediaUserToken(token) {
  if (token) {
    store.set("mediaUserToken", token);
    return true;
  }
  return false;
}

function getDeveloperToken() {
  return DEVELOPER_TOKEN;
}

function cleanPrimaryArtist(artist) {
  if (!artist) return "";
  return artist.split(/[&,]|\bx\b|feat\./i)[0].trim();
}

/** Lowercase, drop feat./with clauses and punctuation, for loose comparison. */
function normalizeForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s*[([]\s*(feat|ft|with)\.?\s[^)\]]*[)\]]/g, "")
    .replace(/\s*-\s*single$|\s*-\s*ep$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Rank a search hit against what's actually playing.
 *
 * Apple's catalog carries an explicit and a clean cut of most tracks, and the
 * relevance order is not stable — adding the album to the query is enough to
 * float the clean version to the top. Taking songs[0] therefore produced
 * fully-censored lyrics ("****" on ass/bitch/shit) at random. Explicit wins
 * ties, and DJ-mix re-releases are pushed down.
 */
function scoreSong(song, name, artist, album) {
  const a = song?.attributes || {};
  const qName = normalizeForMatch(name);
  const qArtist = normalizeForMatch(artist);
  const qAlbum = normalizeForMatch(album);
  const sName = normalizeForMatch(a.name);
  const sArtist = normalizeForMatch(a.artistName);
  const sAlbum = normalizeForMatch(a.albumName);

  let score = 0;
  if (sName && qName) {
    if (sName === qName) score += 100;
    else if (sName.startsWith(qName) || qName.startsWith(sName)) score += 60;
    else if (sName.includes(qName) || qName.includes(sName)) score += 30;
    else score -= 40;
  }
  if (sArtist && qArtist) {
    if (sArtist === qArtist) score += 40;
    else if (sArtist.includes(qArtist) || qArtist.includes(sArtist)) score += 25;
    else score -= 20;
  }
  if (sAlbum && qAlbum && (sAlbum === qAlbum || sAlbum.includes(qAlbum) || qAlbum.includes(sAlbum))) {
    score += 20;
  }

  // A remix/DJ-mix cut has different timings than the album version.
  const rawName = String(a.name || "");
  if (/\[(mixed|remix)\]|\bdj mix\b/i.test(`${rawName} ${a.albumName || ""}`) && !/mix|remix/i.test(name || "")) {
    score -= 70;
  }

  if (a.contentRating === "explicit") score += 12;
  else if (a.contentRating === "clean") score -= 12;

  return score;
}

async function getStorefront(mediaUserToken) {
  if (cachedStorefront && cachedLanguage) {
    return { storefront: cachedStorefront, language: cachedLanguage };
  }

  console.log("[AppleMusicAPI] Fetching storefront...");
  try {
    const res = await fetch("https://amp-api.music.apple.com/v1/me/storefront", {
      headers: {
        Authorization: `Bearer ${getDeveloperToken()}`,
        "media-user-token": mediaUserToken,
        "User-Agent": UA,
        Origin: "https://music.apple.com",
        Referer: "https://music.apple.com/",
      },
    });
    if (!res.ok) {
      console.log("[AppleMusicAPI] Storefront fetch failed:", res.status);
      return null;
    }
    const json = await res.json();
    const storefront = json?.data?.[0]?.id;
    const language = json?.data?.[0]?.attributes?.defaultLanguageTag;
    if (!storefront) {
      console.log("[AppleMusicAPI] No storefront in response");
      return null;
    }
    cachedStorefront = storefront;
    cachedLanguage = language || "en-US";
    console.log("[AppleMusicAPI] Storefront:", storefront, "Language:", language);
    return { storefront, language };
  } catch (e) {
    console.error("[AppleMusicAPI] Storefront error:", e.message);
    return null;
  }
}

async function searchTrack(name, artist, album, mediaUserToken) {
  const sf = await getStorefront(mediaUserToken);
  if (!sf) return null;

  const primaryArtist = cleanPrimaryArtist(artist);
  const queryWithAlbum = album ? `${name} ${primaryArtist} ${album}` : `${name} ${primaryArtist}`;
  console.log("[AppleMusicAPI] Searching:", queryWithAlbum);

  try {
    const params = new URLSearchParams({
      term: queryWithAlbum,
      types: "songs",
      limit: "10",
      l: sf.language,
    });
    const res = await fetch(
      `https://amp-api.music.apple.com/v1/catalog/${sf.storefront}/search?${params}`,
      {
        headers: {
          Authorization: `Bearer ${getDeveloperToken()}`,
          "media-user-token": mediaUserToken,
          "User-Agent": UA,
          Origin: "https://music.apple.com",
          Referer: "https://music.apple.com/",
        },
      }
    );
    if (res.ok) {
      const json = await res.json();
      const songs = json?.results?.songs?.data;
      if (songs && songs.length > 0) {
        const ranked = songs
          .map((s) => ({ s, score: scoreSong(s, name, primaryArtist, album) }))
          .sort((a, b) => b.score - a.score);
        const { s: song, score } = ranked[0];
        const artworkUrl = song?.attributes?.artwork?.url?.replace("{w}", "640").replace("{h}", "640") || "";
        console.log(
          "[AppleMusicAPI] Found:", song.id, song.attributes?.name,
          `[${song.attributes?.contentRating || "none"}] score=${score}`,
          "artwork:", artworkUrl ? artworkUrl.slice(0, 60) + "..." : "NONE",
        );
        return { id: song.id, type: "songs", artworkUrl };
      }
    }
  } catch (e) {
    console.error("[AppleMusicAPI] Search error:", e.message);
  }

  // Fallback: retry without album if album search returned no results
  if (album) {
    console.log("[AppleMusicAPI] Retrying search without album...");
    return searchTrack(name, artist, null, mediaUserToken);
  }

  return null;
}

async function fetchLyrics(trackId, mediaUserToken) {
  if (!trackId) return null;
  const sf = await getStorefront(mediaUserToken);
  if (!sf) return null;
  const headers = {
    Authorization: `Bearer ${getDeveloperToken()}`,
    "media-user-token": mediaUserToken,
    Origin: "https://music.apple.com",
    Referer: "https://music.apple.com/",
    "User-Agent": UA,
  };

  console.log("[AppleMusicAPI] Fetching lyrics for:", trackId);

  const songUrl = `https://amp-api.music.apple.com/v1/catalog/${sf.storefront}/songs/${trackId}?include[songs]=lyrics,syllable-lyrics&l=${sf.language}`;
  try {
    const res = await fetch(songUrl, { headers });
    if (res.ok) {
      const json = await res.json();
      const songData = json?.data?.[0];
      const rels = songData?.relationships;

      const sylData = rels?.["syllable-lyrics"]?.data;
      if (sylData && Array.isArray(sylData) && sylData.length > 0) {
        const ttml = sylData[0]?.attributes?.ttml;
        if (ttml) {
          console.log("[AppleMusicAPI] syllable-lyrics from song endpoint, length:", ttml.length);
          console.log("[AppleMusicAPI] TTML first 500 chars:", ttml.slice(0, 500));
          return ttml.replace(/\b[a-z]+(?=:)/g, "");
        }
      }

      const lyrData = rels?.lyrics?.data;
      if (lyrData && Array.isArray(lyrData) && lyrData.length > 0) {
        const ttml = lyrData[0]?.attributes?.ttml;
        if (ttml) {
          console.log("[AppleMusicAPI] lyrics from song endpoint, length:", ttml.length);
          return ttml.replace(/\b[a-z]+(?=:)/g, "");
        }
      }
    } else {
      console.log("[AppleMusicAPI] Song endpoint HTTP:", res.status);
    }
  } catch (e) {
    console.log("[AppleMusicAPI] Song endpoint failed:", e.message);
  }

  const sylUrl = `https://amp-api.music.apple.com/v1/catalog/${sf.storefront}/songs/${trackId}/syllable-lyrics`;
  try {
    const res = await fetch(sylUrl, { headers });
    if (res.ok) {
      const json = await res.json();
      const ttml = json?.data?.[0]?.attributes?.ttml;
      if (ttml) {
        console.log("[AppleMusicAPI] syllable-lyrics sub-resource obtained, length:", ttml.length);
        console.log("[AppleMusicAPI] TTML first 500 chars:", ttml.slice(0, 500));
        return ttml.replace(/\b[a-z]+(?=:)/g, "");
      }
    } else {
      console.log("[AppleMusicAPI] syllable-lyrics sub-resource HTTP:", res.status);
    }
  } catch (e) {
    console.log("[AppleMusicAPI] syllable-lyrics sub-resource failed:", e.message);
  }

  const lyrUrl = `https://amp-api.music.apple.com/v1/catalog/${sf.storefront}/songs/${trackId}/lyrics`;
  try {
    const res = await fetch(lyrUrl, { headers });
    if (res.ok) {
      const json = await res.json();
      const ttml = json?.data?.[0]?.attributes?.ttml;
      if (ttml) {
        console.log("[AppleMusicAPI] line-level lyrics obtained (fallback), length:", ttml.length);
        return ttml.replace(/\b[a-z]+(?=:)/g, "");
      }
    } else {
      console.log("[AppleMusicAPI] line-level lyrics HTTP:", res.status);
    }
  } catch (e) {
    console.log("[AppleMusicAPI] standard lyrics failed:", e.message);
  }

  console.log("[AppleMusicAPI] No lyrics data found");
  return null;
}

export async function findAppleMusicLyrics(name, artist, album) {
  const mediaUserToken = getMediaUserToken();
  if (!mediaUserToken) {
    console.log("[AppleMusicAPI] No media-user-token configured");
    return null;
  }

  const track = await searchTrack(name, artist, album, mediaUserToken);
  if (!track) return null;

  const rawTtml = await fetchLyrics(track.id, mediaUserToken);
  const lyrics = rawTtml ? parseTtmlXmlToJson(rawTtml) : null;

  return {
    lyrics,
    artworkUrl: track.artworkUrl || null,
  };
}
