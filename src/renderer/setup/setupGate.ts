/**
 * First-run setup gate.
 *
 * The app's best lyrics source (Apple Music's native word-level TTML) needs a
 * per-user `media-user-token`, which nothing can obtain automatically. This
 * screen walks the user through pasting theirs before the Spicy UI mounts, so
 * the first song they play already has word-synced lyrics instead of silently
 * falling back.
 *
 * Deliberately plain DOM + inline styles: this mounts before Spicy's UI and
 * its stylesheets assume containers that do not exist yet. It is also the one
 * screen that must never depend on the rest of the renderer.
 */
import type { SetupStatus } from "./setupTypes";

const SKIP_KEY = "sweetly:setup-skipped";

function getApi() {
  return (globalThis as unknown as { electronAPI?: any }).electronAPI;
}

function mountRoot(): HTMLElement {
  const existing = document.getElementById("sweetly-setup");
  if (existing) return existing;
  const root = document.createElement("div");
  root.id = "sweetly-setup";
  document.getElementById("app")?.appendChild(root);
  return root;
}

function style(): HTMLStyleElement {
  const el = document.createElement("style");
  el.textContent = `
    #sweetly-setup {
      position: fixed; inset: 0;
      z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
      background: rgba(18, 18, 20, 0.82);
      backdrop-filter: blur(24px) saturate(140%);
      -webkit-app-region: drag;
      font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
      color: #f5f5f7;
      overflow-y: auto;
      padding: 28px;
    }
    #sweetly-setup .card {
      -webkit-app-region: no-drag;
      width: 100%; max-width: 460px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 18px;
      padding: 24px;
      box-sizing: border-box;
    }
    #sweetly-setup h1 {
      font-size: 20px; font-weight: 700; letter-spacing: -0.02em;
      margin: 0 0 4px;
    }
    #sweetly-setup p.sub {
      font-size: 13px; line-height: 1.5; color: rgba(245, 245, 247, 0.65);
      margin: 0 0 18px;
    }
    #sweetly-setup ol {
      margin: 0 0 16px; padding-left: 20px;
      font-size: 12.5px; line-height: 1.6; color: rgba(245, 245, 247, 0.75);
    }
    #sweetly-setup code {
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 11.5px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 5px;
      padding: 1px 5px;
      white-space: nowrap;
    }
    #sweetly-setup textarea {
      width: 100%; box-sizing: border-box;
      min-height: 64px;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 10px;
      color: #f5f5f7;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 12px;
      padding: 10px 12px;
      resize: vertical;
      margin: 0 0 12px;
    }
    #sweetly-setup textarea:focus {
      outline: none;
      border-color: #ff2d55;
      box-shadow: 0 0 0 3px rgba(255, 45, 85, 0.25);
    }
    #sweetly-setup .row {
      display: flex; gap: 10px; align-items: center;
    }
    #sweetly-setup button {
      -webkit-app-region: no-drag;
      font: 600 13px -apple-system, "SF Pro Text", system-ui, sans-serif;
      border: none; border-radius: 10px;
      padding: 10px 16px; cursor: pointer;
      transition: transform 0.15s ease, background 0.15s ease;
    }
    #sweetly-setup button.primary {
      background: linear-gradient(180deg, #ff3b5c, #e02346);
      color: #fff;
      flex: 1;
    }
    #sweetly-setup button.primary:hover { transform: translateY(-1px); }
    #sweetly-setup button.ghost {
      background: transparent; color: rgba(245, 245, 247, 0.65);
    }
    #sweetly-setup button.ghost:hover { color: #f5f5f7; }
    #sweetly-setup button:disabled { opacity: 0.5; cursor: default; }
    #sweetly-setup .status {
      font-size: 12px; margin-top: 14px;
      display: flex; align-items: center; gap: 6px;
      color: rgba(245, 245, 247, 0.55);
    }
    #sweetly-setup .status.ok { color: #30d158; }
    #sweetly-setup .status.err { color: #ff453a; }
    #sweetly-setup .skip {
      -webkit-app-region: no-drag;
      display: block; margin: 16px auto 0;
      background: none; border: none; cursor: pointer;
      color: rgba(245, 245, 247, 0.45);
      font: 500 12px -apple-system, system-ui, sans-serif;
    }
    #sweetly-setup .skip:hover { color: rgba(245, 245, 247, 0.75); }
    #sweetly-setup .spotify {
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      margin-top: 18px; padding-top: 16px;
    }
    #sweetly-setup .spotify .label {
      font-size: 12.5px; font-weight: 600; margin: 0 0 4px;
    }
    #sweetly-setup .spotify .desc {
      font-size: 12px; line-height: 1.5;
      color: rgba(245, 245, 247, 0.55); margin: 0 0 12px;
    }
    #sweetly-setup .spotify button.signin {
      background: #1db954; color: #fff; width: 100%;
    }
  `;
  return el;
}

function buildCard(setup: SetupStatus): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";

  const h1 = document.createElement("h1");
  h1.textContent = "Welcome to Sweetly";

  const sub = document.createElement("p");
  sub.className = "sub";
  sub.textContent = "One quick step to unlock word-by-word lyrics for anything in Apple Music.";

  const ol = document.createElement("ol");
  for (const step of [
    "Open music.apple.com in a browser and sign in to your Apple Music account.",
    "Open the Developer Console (Cmd+Opt+I), then the Network tab.",
    "Click any request to music.apple.com and copy the value of the `media-user-token` header.",
    "Paste it below. It is stored locally on this Mac and never leaves it.",
  ]) {
    const li = document.createElement("li");
    li.textContent = step;
    ol.appendChild(li);
  }

  const textarea = document.createElement("textarea");
  textarea.placeholder = "media-user-token …";
  textarea.spellcheck = false;

  const row = document.createElement("div");
  row.className = "row";

  const saveBtn = document.createElement("button");
  saveBtn.className = "primary";
  saveBtn.textContent = "Save & Start";
  saveBtn.disabled = true;
  textarea.addEventListener("input", () => {
    saveBtn.disabled = !textarea.value.trim();
  });

  const status = document.createElement("div");
  status.className = "status";

  saveBtn.addEventListener("click", async () => {
    const token = textarea.value.trim();
    if (!token) return;
    saveBtn.disabled = true;
    status.className = "status";
    status.textContent = "Saving…";
    try {
      const ok = await getApi().setMediaUserToken(token);
      if (ok) {
        status.className = "status ok";
        status.textContent = "Token saved. Starting Sweetly…";
        await new Promise((r) => setTimeout(r, 400));
        window.location.reload();
      } else {
        status.className = "status err";
        status.textContent = "That didn't look like a token — try again.";
        saveBtn.disabled = false;
      }
    } catch (e) {
      status.className = "status err";
      status.textContent = `Could not save: ${(e as Error).message}`;
      saveBtn.disabled = false;
    }
  });

  row.appendChild(saveBtn);

  const skip = document.createElement("button");
  skip.className = "skip";
  skip.textContent = "Skip for now — I'll use fallback lyrics";
  skip.addEventListener("click", () => {
    try {
      localStorage.setItem(SKIP_KEY, "1");
    } catch {}
    card.dataset.skipped = "1";
    card.closest("#sweetly-setup")?.remove();
    resolve();
  });

  card.append(h1, sub, ol, textarea, row, status);

  // Optional Spotify section — powers the community Spicy Lyrics source. Only
  // shown when there's no stored client id, so configured users aren't nagged.
  const hasSpotify = setup.spotifyClientIdConfigured ?? false;
  if (!hasSpotify) {
    const spotify = document.createElement("div");
    spotify.className = "spotify";
    const label = document.createElement("p");
    label.className = "label";
    label.textContent = "Optional: link a Spotify account";
    const desc = document.createElement("p");
    desc.className = "desc";
    desc.textContent =
      "Unlocks the community lyrics library as a fallback. You'll be taken to Spotify to authorize — no app setup needed from you.";
    const signin = document.createElement("button");
    signin.className = "signin";
    signin.textContent = "Sign in with Spotify";
    const spotifyStatus = document.createElement("div");
    spotifyStatus.className = "status";
    signin.addEventListener("click", async () => {
      signin.disabled = true;
      spotifyStatus.textContent = "Opening Spotify…";
      try {
        const result = await getApi().spotifySignIn();
        if (result?.ok) {
          spotifyStatus.className = "status ok";
          spotifyStatus.textContent = "Linked. Sweetly can use community lyrics now.";
        } else {
          spotifyStatus.className = "status err";
          spotifyStatus.textContent = result?.error || "Sign-in didn't complete.";
        }
      } catch (e) {
        spotifyStatus.className = "status err";
        spotifyStatus.textContent = `Sign-in failed: ${(e as Error).message}`;
      }
      signin.disabled = false;
    });
    spotify.append(label, desc, signin, spotifyStatus);
    card.appendChild(spotify);
  }

  card.appendChild(skip);
  return card;
}

let resolve: () => void = () => {};

/**
 * Show the setup gate if the app isn't configured yet.
 *
 * Returns immediately when setup was already done or skipped. When the gate is
 * shown it resolves after the user either saves a token (which reloads) or
 * skips — the caller only continues past a skip.
 */
export async function ensureSetup(): Promise<void> {
  const api = getApi();
  if (!api) return;

  let skipped = false;
  try {
    skipped = localStorage.getItem(SKIP_KEY) === "1";
  } catch {}

  const status: SetupStatus = await api.getSetupStatus().catch(() => ({
    hasMediaUserToken: true,
    spotifySignedIn: false,
    spotifyClientIdConfigured: false,
  }));

  // Everything needed is in place — or the user chose to skip. No gate.
  if (status.hasMediaUserToken || skipped) return;

  const root = mountRoot();
  root.appendChild(style());
  const card = buildCard(status);
  root.appendChild(card);

  await new Promise<void>((r) => {
    resolve = r;
  });
  if (card.dataset.skipped === "1") return;
  // A token was saved → the reload is in flight; nothing more to do here.
}
