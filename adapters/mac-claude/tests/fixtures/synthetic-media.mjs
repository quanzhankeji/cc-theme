import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function syntheticPng(width = 64, height = 36) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

export async function createMinimalThemeDirectory(directory, id = "runtime-fixture") {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "fixture.png"), syntheticPng());
  await fs.writeFile(path.join(directory, "theme.json"), `${JSON.stringify({
    kind: "skin.theme",
    id,
    name: "Runtime Fixture",
    image: "fixture.png",
    art: { analysis: "off", paletteMode: "system" },
    appearance: { shellMode: "auto" },
  })}\n`);
  return directory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await createMinimalThemeDirectory(path.resolve(process.argv[2]));
}
