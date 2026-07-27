/**
 * Replaces components/Global/Platform.ts.
 *
 * Upstream's version spins a requestAnimationFrame loop until Spicetify.Platform
 * and Spicetify.CosmosAsync appear. Neither ever does here, so the original
 * would poll forever — a real cost, since Spicy's resource efficiency is half
 * the reason for using it at all.
 *
 * There is no Spotify session, and the main process owns every network call, so
 * OnSpotifyReady resolves immediately and the token path is never exercised.
 */
const Platform = {
  OnSpotifyReady: Promise.resolve(),
  GetSpotifyAccessToken: (): Promise<string> => Promise.resolve(""),
  get SpotifyVersion(): number[] {
    return [1, 2, 0];
  },
};

export default Platform;
