/**
 * System-audio capture for the lyrics aligner.
 *
 * Apple Music downloads are FairPlay-protected .m4p files — ffmpeg cannot
 * decode them, so there is no file on disk we can hand to an aligner. The only
 * way to get usable audio for a streamed track is to record it as it plays.
 *
 * Electron's `loopback` audio source is Windows-only, so on macOS this needs a
 * virtual output device (BlackHole). The user routes output through a
 * Multi-Output Device so sound still reaches the speakers while a copy lands
 * on BlackHole, which ffmpeg reads via avfoundation.
 */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";

const execFileAsync = promisify(execFile);

const LOOPBACK_NAME = /blackhole|loopback|soundflower|virtual\s*audio/i;

const FFMPEG_CANDIDATES = [
  process.env.SWEETLY_FFMPEG_BIN,
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
];

export function resolveFfmpeg() {
  return FFMPEG_CANDIDATES.find((p) => p && fs.existsSync(p)) || "ffmpeg";
}

/**
 * Find the avfoundation index of a loopback input device.
 * Returns { index, name } or null when none is installed.
 */
export async function findLoopbackDevice() {
  const ffmpeg = resolveFfmpeg();
  let output = "";
  try {
    // -list_devices always exits non-zero; the listing is on stderr.
    await execFileAsync(ffmpeg, [
      "-hide_banner",
      "-f",
      "avfoundation",
      "-list_devices",
      "true",
      "-i",
      "",
    ]);
  } catch (e) {
    output = `${e.stderr || ""}${e.stdout || ""}`;
  }

  const audioSection = output.split(/AVFoundation audio devices:/i)[1];
  if (!audioSection) return null;

  for (const line of audioSection.split("\n")) {
    const m = line.match(/\[(\d+)\]\s+(.+?)\s*$/);
    if (!m) continue;
    const [, index, name] = m;
    if (LOOPBACK_NAME.test(name)) return { index: Number(index), name: name.trim() };
  }
  return null;
}

/**
 * Record `seconds` of audio from the loopback device to a 16 kHz mono wav
 * (what the aligners expect).
 *
 * Returns { ok, path, reason }. Never throws — a failed capture should
 * downgrade the feature, not break lyrics fetching.
 */
export function captureSystemAudio({ seconds, outPath, deviceIndex, signal }) {
  return new Promise((resolve) => {
    const ffmpeg = resolveFfmpeg();
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-f",
      "avfoundation",
      "-i",
      `:${deviceIndex}`,
      "-t",
      String(Math.max(1, Math.round(seconds))),
      "-ac",
      "1",
      "-ar",
      "16000",
      "-y",
      outPath,
    ];

    const child = spawn(ffmpeg, args);
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    const onAbort = () => {
      try {
        child.kill("SIGINT");
      } catch {}
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });

    child.on("error", (e) => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve({ ok: false, reason: `ffmpeg spawn failed: ${e.message}` });
    });

    child.on("close", (code) => {
      signal?.removeEventListener?.("abort", onAbort);
      if (code !== 0 && !fs.existsSync(outPath)) {
        resolve({ ok: false, reason: `ffmpeg exited ${code}: ${stderr.trim().slice(0, 200)}` });
        return;
      }
      const size = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
      if (size < 32000) {
        // ~1s of 16 kHz mono. Anything smaller means we captured silence or nothing.
        resolve({
          ok: false,
          reason: `captured only ${size} bytes — is output routed through the loopback device?`,
        });
        return;
      }
      resolve({ ok: true, path: outPath });
    });
  });
}

/** One-time setup instructions, surfaced when no loopback device is present. */
export const SETUP_HINT = [
  "Sweetly needs a loopback device to align lyrics for DRM-protected Apple Music tracks.",
  "  1. brew install --cask blackhole-2ch",
  "  2. Open Audio MIDI Setup -> + -> Create Multi-Output Device",
  "  3. Tick both your speakers and BlackHole 2ch (speakers listed first)",
  "  4. Set that Multi-Output Device as the system output",
].join("\n");
