/** Shape of the `get-setup-status` IPC response, mirrored in src/preload/index.js. */
export interface SetupStatus {
  hasMediaUserToken: boolean;
  spotifySignedIn: boolean;
  spotifyClientIdConfigured: boolean;
}
