import Store from "electron-store";

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

async function searchTrack(name, artist, mediaUserToken) {
  const sf = await getStorefront(mediaUserToken);
  if (!sf) return null;

  const primaryArtist = cleanPrimaryArtist(artist);
  const query = `${name} ${primaryArtist}`;
  console.log("[AppleMusicAPI] Searching:", query);

  try {
    const params = new URLSearchParams({
      term: query,
      types: "songs",
      limit: "3",
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
    if (!res.ok) {
      console.log("[AppleMusicAPI] Search failed:", res.status);
      return null;
    }
    const json = await res.json();
    const songs = json?.results?.songs?.data;
    if (!songs || songs.length === 0) {
      console.log("[AppleMusicAPI] No results for:", query);
      return null;
    }
    const song = songs[0];
    const artworkUrl = song?.attributes?.artwork?.url?.replace("{w}", "640").replace("{h}", "640") || "";
    console.log("[AppleMusicAPI] Found:", song.id, song.attributes?.name, "artwork:", artworkUrl ? artworkUrl.slice(0, 60) + "..." : "NONE");
    return { id: song.id, type: "songs", artworkUrl };
  } catch (e) {
    console.error("[AppleMusicAPI] Search error:", e.message);
    return null;
  }
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

export async function findAppleMusicLyrics(name, artist) {
  const mediaUserToken = getMediaUserToken();
  if (!mediaUserToken) {
    console.log("[AppleMusicAPI] No media-user-token configured");
    return null;
  }

  const track = await searchTrack(name, artist, mediaUserToken);
  if (!track) return null;

  const rawTtml = await fetchLyrics(track.id, mediaUserToken);
  const lyrics = rawTtml ? parseTtmlXmlToJson(rawTtml) : null;

  return {
    lyrics,
    artworkUrl: track.artworkUrl || null,
  };
}

function parseTtmlXmlToJson(xml) {
  const parseTime = (ts) => {
    if (!ts) return 0;
    if (typeof ts === "number") return ts;
    const clean = String(ts)
      .replace(/s$/i, "")
      .replace(/^['"]+|['"]+$/g, "")
      .trim();
    if (!clean) return 0;
    const parts = clean.split(":");
    if (parts.length === 3) {
      return parseFloat(parts[0] || 0) * 3600 + parseFloat(parts[1] || 0) * 60 + parseFloat(parts[2] || 0);
    }
    if (parts.length === 2) {
      return parseFloat(parts[0] || 0) * 60 + parseFloat(parts[1] || 0);
    }
    return parseFloat(clean) || 0;
  };

  const cleanText = (raw) => {
    if (!raw) return "";
    return raw
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  };

  const cleanTextKeepTrailing = (raw) => {
    if (!raw) return { text: "", endsWithSpace: false };
    let text = raw
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, " ");
    const endsWithSpace = text.endsWith(" ");
    return { text: text.trim(), endsWithSpace };
  };

  const lines = [];

  const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
  let pm;
  while ((pm = pRegex.exec(xml)) !== null) {
    const pTag = pm[0];
    const pContent = pm[1];
    const pBegin = (pTag.match(/begin="([^"]+)"/) || [])[1];
    const pEnd = (pTag.match(/end="([^"]+)"/) || [])[1];

    const lead = {
      StartTime: parseTime(pBegin || "0"),
      EndTime: parseTime(pEnd || pBegin || "0"),
      Syllables: [],
      IsBackground: /(?:ttm:)?role="(?:Background|x-bg)"|agent="v(?:[2-9]|1[0-9])"/i.test(pTag),
    };

    const spanRegex = /<(?:span|sy)\b[^>]*>([\s\S]*?)<\/(?:span|sy)>/g;
    const spanMatches = [];
    let sm;
    while ((sm = spanRegex.exec(pContent)) !== null) {
      spanMatches.push({ fullTag: sm[0], content: sm[1], index: sm.index });
    }

    for (let si = 0; si < spanMatches.length; si++) {
      const { fullTag, content, index } = spanMatches[si];
      const { text: rawText, endsWithSpace } = cleanTextKeepTrailing(content);
      const sBegin = (fullTag.match(/begin="([^"]+)"/) || [])[1];
      const sEnd = (fullTag.match(/end="([^"]+)"/) || [])[1];

      if (!rawText) continue;

      lead.Syllables.push({
        Text: rawText,
        StartTime: parseTime(sBegin || "0"),
        EndTime: parseTime(sEnd || "0"),
        IsPartOfWord: !endsWithSpace,
      });

      if (si < spanMatches.length - 1) {
        const nextIndex = spanMatches[si + 1].index;
        const between = pContent.slice(index + fullTag.length, nextIndex);
        if (/\s/.test(between)) {
          lead.Syllables[lead.Syllables.length - 1].IsPartOfWord = false;
        }
      }
    }

    if (lead.Syllables.length > 0) {
      lines.push({ Lead: lead, OppositeAligned: false });
    } else {
      const plainText = cleanText(pContent);
      if (plainText) {
        lines.push({ Lead: { StartTime: lead.StartTime, EndTime: lead.EndTime, Syllables: [{ Text: plainText, StartTime: lead.StartTime, EndTime: lead.EndTime, IsPartOfWord: false }] }, OppositeAligned: false });
      }
    }
  }

  if (lines.length > 0) {
    console.log("[AppleMusicAPI] Parsed TTML:", lines.length, "lines");
    return { Content: lines, Type: "Syllable" };
  }

  return null;
}
