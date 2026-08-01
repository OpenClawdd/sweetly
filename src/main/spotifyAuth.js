/**
 * Spotify OAuth (Authorization Code + PKCE) for the Spicy Lyrics API.
 *
 * api.spicylyrics.org gates the `lyrics` operation behind a real Spotify access
 * token: the request carries `SpicyLyrics-WebAuth: Bearer <token>` and names
 * that header in `variables.auth`. Upstream gets the token from
 * `sp://oauth/v2/token`, a resolver that only exists inside the Spotify desktop
 * client, so a standalone host has to obtain one the ordinary way — the user
 * signs in to their own Spotify account and we present that token.
 *
 * The API states access is "granted solely for personal, individual use through
 * official Spicy Lyrics clients or their public forks", which this is. Nothing
 * here bypasses the check; it satisfies it.
 *
 * PKCE rather than a client secret: this is a desktop app, so a secret shipped
 * alongside it would not be secret. PKCE is the flow Spotify documents for
 * exactly this case and needs no secret at all.
 *
 * Deliberately plain Node — no electron imports — so the consent flow can run
 * from `scripts/spotify-login.mjs` without booting the app, and so the token
 * logic is unit-testable.
 */
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";

/** Must match a Redirect URI registered on the Spotify app, character for character. */
export const REDIRECT_PORT = 8888;
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

/**
 * Stored plainly at 0600, matching the ~/.sweetly-token convention this project
 * already uses for the Apple media-user-token. It is a refresh token for a
 * Spotify account, not a password, and it is revocable from Spotify's account
 * page at any time.
 */
const TOKEN_PATH = path.join(os.homedir(), ".sweetly-spotify-token");
const CLIENT_ID_PATH = path.join(os.homedir(), ".sweetly-spotify");

/**
 * No scopes requested. The API only needs to see that the caller is a real
 * Spotify user; asking for library or playback access we never use would be
 * privilege we have no reason to hold.
 */
const SCOPES = "";

/** Refresh this long before actual expiry so a fetch never races the deadline. */
const REFRESH_MARGIN_MS = 60_000;

const AUTH_HOST = "https://accounts.spotify.com";

/** base64url with no padding, per RFC 7636. */
function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createPkcePair() {
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export async function readClientId() {
  if (process.env.SPOTIFY_CLIENT_ID) return process.env.SPOTIFY_CLIENT_ID.trim();
  try {
    const raw = await fs.readFile(CLIENT_ID_PATH, "utf8");
    return raw.trim() || null;
  } catch {
    return null;
  }
}

async function readStoredToken() {
  try {
    return JSON.parse(await fs.readFile(TOKEN_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function writeStoredToken(record) {
  await fs.writeFile(TOKEN_PATH, JSON.stringify(record, null, 2), { mode: 0o600 });
  // writeFile only applies mode when creating, so an existing file keeps its
  // old permissions unless we say otherwise.
  await fs.chmod(TOKEN_PATH, 0o600);
}

export async function clearStoredToken() {
  try {
    await fs.unlink(TOKEN_PATH);
    return true;
  } catch {
    return false;
  }
}

/** POST to Spotify's token endpoint. Returns the parsed body or throws. */
async function tokenRequest(params) {
  const res = await fetch(`${AUTH_HOST}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Spotify token request failed (${res.status}): ${body?.error_description || body?.error || "unknown"}`
    );
  }
  return body;
}

/**
 * Turn a token response into the record we persist. Spotify does not always
 * return a new refresh token on refresh, so the previous one carries forward.
 */
function toRecord(body, previousRefresh) {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || previousRefresh || null,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

/** Open a URL in the user's default browser. macOS-only, like the rest of the host. */
function openInBrowser(url) {
  execFile("open", [url], (err) => {
    if (err) console.error("[SpotifyAuth] Could not open a browser:", err.message);
  });
}

/**
 * Run the interactive consent flow. Starts a loopback listener, opens the
 * system browser, and resolves once Spotify redirects back with a code.
 */
export async function authorize({
  clientId,
  timeoutMs = 300_000,
  openBrowser = openInBrowser,
} = {}) {
  const id = clientId || (await readClientId());
  if (!id) {
    throw new Error(
      `No Spotify client id. Create an app at https://developer.spotify.com/dashboard, ` +
        `add "${REDIRECT_URI}" as a Redirect URI, then write the client id to ${CLIENT_ID_PATH} ` +
        `(or set SPOTIFY_CLIENT_ID).`
    );
  }

  const { verifier, challenge } = createPkcePair();
  // Guards against a stray request to the loopback port completing the flow
  // with someone else's code.
  const state = base64url(crypto.randomBytes(16));

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      const returnedState = url.searchParams.get("state");
      const returnedCode = url.searchParams.get("code");

      const done = (message) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Sweetly</title>` +
            `<body style="font:16px system-ui;padding:3rem;max-width:32rem">` +
            `<h1 style="font-size:1.2rem">${message}</h1>` +
            `<p style="opacity:.7">You can close this tab and go back to Sweetly.</p>`
        );
        server.close();
      };

      if (err) {
        done("Sign-in was cancelled.");
        reject(new Error(`Spotify returned an error: ${err}`));
        return;
      }
      if (returnedState !== state) {
        done("Sign-in could not be verified.");
        reject(new Error("State mismatch on the OAuth callback; ignoring the response."));
        return;
      }
      if (!returnedCode) {
        done("Sign-in did not return a code.");
        reject(new Error("No authorization code on the callback."));
        return;
      }
      done("Signed in. Sweetly can reach Spicy Lyrics now.");
      resolve(returnedCode);
    });

    server.on("error", reject);
    const timer = setTimeout(() => {
      server.close();
      reject(
        new Error(
          `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the Spotify redirect.`
        )
      );
    }, timeoutMs);
    // Do not hold the process open on the timer alone.
    timer.unref?.();
    server.on("close", () => clearTimeout(timer));

    server.listen(REDIRECT_PORT, "127.0.0.1", () => {
      const authUrl =
        `${AUTH_HOST}/authorize?` +
        new URLSearchParams({
          client_id: id,
          response_type: "code",
          redirect_uri: REDIRECT_URI,
          code_challenge_method: "S256",
          code_challenge: challenge,
          state,
          ...(SCOPES ? { scope: SCOPES } : {}),
        }).toString();
      console.log("[SpotifyAuth] Opening browser to sign in…");
      console.log("[SpotifyAuth] If nothing opens, visit:\n" + authUrl);
      openBrowser(authUrl);
    });
  });

  const record = toRecord(
    await tokenRequest({
      client_id: id,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
    null
  );
  await writeStoredToken(record);
  return record;
}

/**
 * A usable access token, or null when signed out.
 *
 * Non-interactive by default: a lyrics fetch must never pop a browser window
 * mid-track. Callers that want the consent flow ask for it explicitly.
 */
export async function getSpotifyAccessToken({ interactive = false } = {}) {
  let record = await readStoredToken();

  if (record?.accessToken && record.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return record.accessToken;
  }

  if (record?.refreshToken) {
    const id = await readClientId();
    if (!id) return null;
    try {
      record = toRecord(
        await tokenRequest({
          client_id: id,
          grant_type: "refresh_token",
          refresh_token: record.refreshToken,
        }),
        record.refreshToken
      );
      await writeStoredToken(record);
      return record.accessToken;
    } catch (e) {
      // A revoked or rotated refresh token is not recoverable without the user.
      console.log("[SpotifyAuth] Refresh failed, sign-in required:", e.message);
      if (!interactive) return null;
    }
  }

  if (!interactive) return null;
  return (await authorize()).accessToken;
}

/** Is there a stored credential at all? Used to decide whether to try the source. */
export async function isSignedIn() {
  const record = await readStoredToken();
  return Boolean(record?.refreshToken || record?.accessToken);
}
