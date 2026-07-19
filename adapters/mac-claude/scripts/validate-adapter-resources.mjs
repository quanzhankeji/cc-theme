import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const execFile = promisify(execFileCallback);
const contract = JSON.parse(await fs.readFile(path.join(projectRoot, "contracts", "adapter-resource-ownership.json"), "utf8"));
const knownProductionIdentities = [
  ["xt", "xg"].join(""),
  String.fromCodePoint(0x7ebf, 0x6761, 0x5c0f, 0x72d7),
  ["WO", "LP"].join(""),
  ["mac", "claude", "skin"].join("-"),
];
const textualExtensions = new Set(["", ".css", ".js", ".json", ".md", ".mjs", ".sh", ".txt", ".yaml"]);

async function walk(root, directory = root) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    const stat = await fs.lstat(absolute);
    assert.equal(stat.isSymbolicLink(), false, `Symbolic links are forbidden: ${relative}`);
    if (entry.isDirectory()) result.push(...await walk(root, absolute));
    else if (entry.isFile()) result.push({ absolute, relative });
    else assert.fail(`Unsupported release entry: ${relative}`);
  }
  return result;
}

async function walkNodes(root, directory = root) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    const stat = await fs.lstat(absolute);
    assert.equal(stat.isSymbolicLink(), false, `Symbolic links are forbidden: ${relative}`);
    if (entry.isDirectory()) {
      result.push({ absolute, relative, directory: true });
      result.push(...await walkNodes(root, absolute));
    } else if (entry.isFile()) result.push({ absolute, relative, directory: false });
    else assert.fail(`Unsupported release entry: ${relative}`);
  }
  return result;
}

function assertNoKnownIdentity(text, label) {
  const normalized = text.toLocaleLowerCase("en-US");
  for (const identity of knownProductionIdentities) {
    assert.equal(normalized.includes(identity.toLocaleLowerCase("en-US")), false, `Forbidden legacy or production identity remains in ${label}`);
  }
}

async function validateRepository(root) {
  for (const directory of contract.repository.forbiddenTopLevelDirectories) {
    await assert.rejects(fs.access(path.join(root, directory)), (error) => error?.code === "ENOENT");
  }
  for (const file of await walk(root)) {
    if (/^(?:release|runtime|tests)(?:\/|$)/.test(file.relative)) continue;
    const extension = path.extname(file.relative).toLowerCase();
    assert.equal(contract.release.forbiddenExtensions.includes(extension), false, `Production theme media remains in repository: ${file.relative}`);
    assert.equal(contract.release.forbiddenThemeFiles.includes(path.basename(file.relative).toLowerCase()), false, `Production theme document remains in repository: ${file.relative}`);
    if (textualExtensions.has(extension)) assertNoKnownIdentity(await fs.readFile(file.absolute, "utf8"), file.relative);
  }
}

async function validateRelease(root) {
  const entries = await walk(root);
  const allowedDirectories = new Set(contract.release.allowedTopLevelDirectories);
  const allowedFiles = new Set([
    "CHANGELOG.md", "CLIENT_DEPLOY_PROMPT.md", "LICENSE", "MIGRATION.md", "NOTICE.md",
    "PROJECT_MANIFEST.json", "README.md", "RELEASE_CHECKLIST.md", "SOURCE_ATTRIBUTION.md", "VERSION", "package.json",
  ]);
  for (const entry of entries) {
    const segments = entry.relative.split("/").map((segment) => segment.toLowerCase());
    assert.equal(
      allowedDirectories.has(segments[0]) || allowedFiles.has(entry.relative),
      true,
      `Release entry is outside the Adapter allowlist: ${entry.relative}`,
    );
    assert.equal(segments.some((segment) => contract.release.forbiddenPathSegments.includes(segment)), false, `Forbidden release path: ${entry.relative}`);
    const extension = path.extname(entry.relative).toLowerCase();
    assert.equal(contract.release.allowedExtensions.includes(extension), true, `Release file type is outside the closed allowlist: ${entry.relative}`);
    assert.equal(contract.release.forbiddenExtensions.includes(extension), false, `Theme media/package leaked into release: ${entry.relative}`);
    assert.equal(contract.release.forbiddenThemeFiles.includes(path.basename(entry.relative).toLowerCase()), false, `Theme document leaked into release: ${entry.relative}`);
    if (textualExtensions.has(extension)) assertNoKnownIdentity(await fs.readFile(entry.absolute, "utf8"), entry.relative);
  }
  for (const asset of contract.release.allowedAdapterAssets) {
    assert.equal(entries.some((entry) => entry.relative === asset), true, `Required fixed Adapter asset is missing: ${asset}`);
  }
  return entries.length;
}

async function validateArchive(archive) {
  assert.equal(path.extname(archive).toLowerCase(), ".zip", "Only ZIP release archives are supported");
  const { stdout } = await execFile("/usr/bin/unzip", ["-Z1", archive], { maxBuffer: 16 * 1024 * 1024 });
  const listedPaths = stdout.split("\n").filter(Boolean);
  assert(listedPaths.length > 0, "Release archive is empty");
  for (const listed of listedPaths) {
    assert.equal(listed.includes("\\"), false, `Archive path contains a backslash: ${listed}`);
    assert.equal(path.posix.isAbsolute(listed), false, `Archive path is absolute: ${listed}`);
    assert.equal(listed.split("/").includes(".."), false, `Archive path escapes its root: ${listed}`);
    const segments = listed.replace(/\/$/, "").split("/").map((segment) => segment.toLowerCase());
    assert.equal(segments.some((segment) => contract.release.forbiddenPathSegments.includes(segment)), false, `Forbidden archive directory: ${listed}`);
  }

  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "mac-claude-release-scan-"));
  try {
    await execFile("/usr/bin/unzip", ["-qq", archive, "-d", temporary], { maxBuffer: 16 * 1024 * 1024 });
    const nodes = await walkNodes(temporary);
    const entries = nodes.filter((entry) => !entry.directory);
    for (const entry of entries) {
      const segments = entry.relative.split("/").map((segment) => segment.toLowerCase());
      assert.equal(segments.some((segment) => contract.release.forbiddenPathSegments.includes(segment)), false, `Forbidden archive path: ${entry.relative}`);
      const extension = path.extname(entry.relative).toLowerCase();
      assert.equal(contract.release.forbiddenExtensions.includes(extension), false, `Theme media/package leaked into archive: ${entry.relative}`);
      assert.equal(contract.release.forbiddenThemeFiles.includes(path.basename(entry.relative).toLowerCase()), false, `Theme document leaked into archive: ${entry.relative}`);
      if (textualExtensions.has(extension)) assertNoKnownIdentity(await fs.readFile(entry.absolute, "utf8"), entry.relative);
    }
    const manifests = entries.filter((entry) => path.basename(entry.relative) === "PROJECT_MANIFEST.json");
    assert.equal(manifests.length, 1, "Release archive must contain exactly one Adapter manifest");
    const engineRoot = path.dirname(manifests[0].absolute);
    const engineRelative = path.relative(temporary, engineRoot).split(path.sep).join("/");
    const clientEngineRelative = "CC Theme - mac-claude/.mac-claude";
    assert(
      engineRelative === "mac-claude" || engineRelative === clientEngineRelative,
      `Release archive has an unsupported layout: ${engineRelative}`,
    );
    const allowedClientWrapperPaths = new Set([
      "CC Theme - mac-claude",
      "CC Theme - mac-claude/安装 CC Theme.command",
      "CC Theme - mac-claude/使用说明.txt",
      "CC Theme - mac-claude/给 Claude 的部署提示词.md",
    ]);
    for (const entry of nodes) {
      const normalized = entry.relative;
      const insideEngine = normalized === engineRelative || normalized.startsWith(`${engineRelative}/`);
      assert(
        insideEngine || (engineRelative === clientEngineRelative && allowedClientWrapperPaths.has(normalized)),
        `Archive entry is outside the closed release layout: ${entry.relative}`,
      );
    }
    const fileCount = await validateRelease(engineRoot);
    return { archiveEntries: entries.length, adapterEntries: fileCount };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

const mode = process.argv[2];
const target = path.resolve(process.argv[3] || projectRoot);
let details = null;
if (mode === "--repository") await validateRepository(target);
else if (mode === "--release-directory") details = { adapterEntries: await validateRelease(target) };
else if (mode === "--release-archive") details = await validateArchive(target);
else throw new Error("Usage: validate-adapter-resources.mjs <--repository|--release-directory|--release-archive> <path>");
process.stdout.write(`${JSON.stringify({ kind: "cc-theme.adapter-resource-validation", pass: true, mode, target, ...(details ?? {}) })}\n`);
