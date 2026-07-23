import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(here, "..");

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

async function copyEntry(relative, destinationRoot) {
  const source = path.resolve(sourceRoot, relative);
  const destination = path.resolve(destinationRoot, relative);
  if (!contained(sourceRoot, source) || !contained(destinationRoot, destination)) throw new Error("Release entry escaped its root");
  const stat = await fs.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe release entry: ${relative}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  await fs.chmod(destination, stat.mode & 0o777);
}

export async function assembleAdapterRelease(destinationRoot) {
  const manifest = JSON.parse(await fs.readFile(path.join(sourceRoot, "contracts/adapter-release-manifest.json"), "utf8"));
  if (manifest.kind !== "mac-doubao-adapter.release-manifest" || manifest.revision !== 1 ||
      manifest.adapterId !== "mac-doubao" || manifest.adapterVersion !== "2.19.9" ||
      manifest.adapterReleaseRevision !== 4 || manifest.platform !== "macos" || manifest.architecture !== "arm64" ||
      manifest.assetIdentity !== "mac-doubao-2.19.9-r4-macos-arm64" || !Array.isArray(manifest.entries)) {
    throw new Error("Invalid Mac Doubao Adapter release manifest");
  }
  await fs.mkdir(destinationRoot, { recursive: true });
  for (const entry of manifest.entries) await copyEntry(entry, path.resolve(destinationRoot));
  return manifest.entries.length;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  if (!destination) throw new Error("Usage: adapter-release.mjs <destination>");
  const files = await assembleAdapterRelease(path.resolve(destination));
  console.log(JSON.stringify({ kind: "mac-doubao-adapter.release", files }));
}
