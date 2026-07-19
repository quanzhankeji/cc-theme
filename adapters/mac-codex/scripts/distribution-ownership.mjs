import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_DIRECTORIES = new Set(["presets", "themes", "theme-sources"]);
const THEME_MEDIA_EXTENSIONS = new Set([
  ".mp4", ".mov", ".webm", ".png", ".jpg", ".jpeg", ".webp", ".cctheme",
]);
const KNOWN_PRODUCTION_IDENTITIES = [
  ["x", "txg"].join(""),
  String.fromCodePoint(0x7ebf, 0x6761, 0x5c0f, 0x72d7),
  ["WO", "LP"].join(""),
];
const TEXT_EXTENSIONS = new Set([
  "", ".command", ".css", ".json", ".md", ".mjs", ".js", ".sh", ".txt", ".yaml", ".yml",
]);

function relativeParts(relative) {
  return relative.split("/").filter(Boolean);
}

async function walk(root, directory = root) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Distribution contains a symbolic link: ${path.relative(root, absolute)}`);
    if (stat.isDirectory()) result.push(...await walk(root, absolute));
    else if (stat.isFile()) result.push({
      absolute,
      relative: path.relative(root, absolute).split(path.sep).join("/"),
      size: stat.size,
    });
  }
  return result;
}

export async function inspectOwnership(root, { distribution = false } = {}) {
  const absoluteRoot = path.resolve(root);
  const files = await walk(absoluteRoot);
  const violations = [];
  for (const file of files) {
    const parts = relativeParts(file.relative);
    const extension = path.extname(file.relative).toLowerCase();
    const testFixture = parts[0] === "tests" && parts[1] === "fixtures";
    if (parts.some((part) => FORBIDDEN_DIRECTORIES.has(part))) {
      violations.push({ code: "production-theme-directory", path: file.relative });
    }
    if (distribution && parts[0] === "tests") {
      violations.push({ code: "test-content-in-distribution", path: file.relative });
    }
    if (THEME_MEDIA_EXTENSIONS.has(extension) && (distribution || !testFixture)) {
      violations.push({ code: "theme-media-owned-by-adapter", path: file.relative });
    }
    if (["theme.json", "preset-source.json"].includes(path.basename(file.relative).toLowerCase()) && !testFixture) {
      violations.push({ code: "installable-theme-document", path: file.relative });
    }
    if (TEXT_EXTENSIONS.has(extension) && file.size <= 5 * 1024 * 1024) {
      const text = await fs.readFile(file.absolute, "utf8").catch(() => "");
      for (const identity of KNOWN_PRODUCTION_IDENTITIES) {
        if (text.includes(identity)) {
          violations.push({ code: "known-production-theme-identity", path: file.relative });
          break;
        }
      }
    }
  }
  return {
    kind: "cc-theme.adapter-ownership-report",
    revision: 1,
    adapterId: "mac-codex",
    mode: distribution ? "distribution" : "repository",
    allowed: violations.length === 0,
    files: files.length,
    violations,
  };
}

async function main(argv) {
  const [operation, root, ...flags] = argv;
  if (operation !== "scan-directory" || !root) {
    throw new Error("Usage: distribution-ownership.mjs scan-directory <root> [--distribution]");
  }
  const report = await inspectOwnership(root, { distribution: flags.includes("--distribution") });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.allowed) process.exitCode = 1;
}

if (path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2));
}
