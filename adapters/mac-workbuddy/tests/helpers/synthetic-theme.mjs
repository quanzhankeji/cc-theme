import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, "..", "fixtures", "minimal-theme.json");
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export async function readSyntheticTheme(overrides = {}) {
  const base = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  return { ...base, ...structuredClone(overrides) };
}

export async function writeSyntheticImage(destination) {
  await fs.writeFile(destination, onePixelPng);
  return destination;
}

export async function createSyntheticTheme(directory, overrides = {}) {
  const theme = await readSyntheticTheme(overrides);
  await fs.mkdir(directory, { recursive: true });
  await writeSyntheticImage(path.join(directory, theme.image));
  await fs.writeFile(path.join(directory, "theme.json"), `${JSON.stringify(theme, null, 2)}\n`);
  return theme;
}
