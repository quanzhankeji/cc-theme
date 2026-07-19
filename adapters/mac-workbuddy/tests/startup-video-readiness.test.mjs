import assert from "node:assert/strict";
import { assessVideoStartup } from "../scripts/injector.mjs";

const visiblePlaying = {
  videoEnabled: true,
  videoTransport: "loopback-range",
  videoPresent: true,
  videoReady: true,
  videoPlaybackState: "playing",
  videoUserPaused: false,
  videoDisabled: false,
  documentHidden: false,
  reducedMotion: false,
};

assert.deepEqual(assessVideoStartup(visiblePlaying),
  { outcome: "ready", settled: true, code: "video-playing" });
assert.deepEqual(assessVideoStartup({ ...visiblePlaying, videoTransport: "blob-fallback" }),
  { outcome: "ready", settled: true, code: "video-playing-blob-fallback" });
assert.deepEqual(assessVideoStartup({ ...visiblePlaying, videoReady: false, videoPlaybackState: "loading" }),
  { outcome: "pending", settled: false, code: "video-not-ready" });
assert.deepEqual(assessVideoStartup({ ...visiblePlaying, videoPlaybackState: "paused" }),
  { outcome: "pending", settled: false, code: "video-not-playing" });
assert.deepEqual(assessVideoStartup({ ...visiblePlaying, documentHidden: true, videoPlaybackState: "paused" }),
  { outcome: "degraded", settled: true, code: "background-paused" });
assert.deepEqual(assessVideoStartup({ ...visiblePlaying, reducedMotion: true, videoPlaybackState: "reduced-motion" }),
  { outcome: "degraded", settled: true, code: "reduced-motion-static" });
assert.deepEqual(assessVideoStartup({ ...visiblePlaying, videoUserPaused: true, videoPlaybackState: "paused" }),
  { outcome: "degraded", settled: true, code: "user-paused" });
assert.deepEqual(assessVideoStartup({ ...visiblePlaying, videoDisabled: true, videoPlaybackState: "disabled" }),
  { outcome: "degraded", settled: true, code: "video-disabled" });
assert.deepEqual(assessVideoStartup({ ...visiblePlaying, videoTransport: "rejected" }),
  { outcome: "failed", settled: true, code: "video-transport-rejected" });
assert.deepEqual(assessVideoStartup({ ...visiblePlaying, videoPlaybackState: "error" }),
  { outcome: "failed", settled: true, code: "video-playback-error" });
assert.deepEqual(assessVideoStartup({ videoEnabled: false }),
  { outcome: "ready", settled: true, code: "startup-ready" });

console.log("PASS: visible video requires ready+playing while background, Reduced Motion, user pause, and disabled states are explicit degradations.");
