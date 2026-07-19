import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSkinTheme, themeMediaNames } from "../scripts/skin-theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(await fs.readFile(path.join(root, "contracts", "skin-theme.schema.json"), "utf8"));
assert.equal(schema.properties.interactiveBackground.oneOf.length, 2);
assert.deepEqual(schema.properties.interactiveBackground.oneOf[1].properties.directions.enum, [8, 16, 32]);

const base = { kind: "skin.theme", id: "interactive", image: "background.png" };
const ripple = normalizeSkinTheme({ ...base, interactiveBackground: { type: "ripple" } });
assert.equal(ripple.backgroundRenderMode, "ripple");
assert.deepEqual(ripple.interactiveBackground, {
  type: "ripple",
  intensity: 0.35,
  radiusPx: 24,
  quality: "auto",
  scrimOpacity: 0.16,
});
assert.deepEqual(themeMediaNames({ ...base, interactiveBackground: { type: "ripple" } }), ["background.png"]);

const directionalSource = {
  ...base,
  interactiveBackground: {
    type: "directional",
    atlas: "directions.webp",
    directions: 16,
    columns: 4,
    rows: 4,
    firstDirectionDegrees: -90,
    idleFrame: 3,
    origin: { xPercent: 48, yPercent: 52 },
    scrimOpacity: 0.12,
  },
};
const directional = normalizeSkinTheme(directionalSource);
assert.equal(directional.backgroundRenderMode, "directional");
assert.deepEqual(directional.interactiveBackground, directionalSource.interactiveBackground);
assert.deepEqual(themeMediaNames(directionalSource), ["background.png", "directions.webp"]);

assert.throws(
  () => normalizeSkinTheme({ ...directionalSource, backgroundVideo: "ambient.mp4" }),
  /must not be combined with backgroundVideo/,
);
assert.throws(
  () => normalizeSkinTheme({
    ...directionalSource,
    interactiveBackground: { ...directionalSource.interactiveBackground, rows: 3 },
  }),
  /columns × rows must equal directions/,
);
for (const atlas of ["https://example.com/a.webp", "/tmp/a.webp", "../a.webp", "folder/a.webp"]) {
  assert.throws(
    () => normalizeSkinTheme({
      ...directionalSource,
      interactiveBackground: { ...directionalSource.interactiveBackground, atlas },
    }),
    /local static WebP filename/,
  );
}
for (const field of ["script", "css", "shader"]) {
  assert.throws(
    () => normalizeSkinTheme({
      ...directionalSource,
      interactiveBackground: { ...directionalSource.interactiveBackground, [field]: "evil" },
    }),
    /unsupported fields/,
  );
}
for (const field of ["script", "css", "shader"]) {
  assert.throws(
    () => normalizeSkinTheme({ ...base, [field]: "evil" }),
    /unsupported fields/,
  );
}

console.log("PASS: WorkBuddy interactive background contract is allowlisted and media-exclusive.");
