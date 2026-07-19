import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builder = path.join(root, "scripts", "build-client-release.sh");
const version = (await fs.readFile(path.join(root, "VERSION"), "utf8")).trim();
const project = JSON.parse(await fs.readFile(path.join(root, "PROJECT_MANIFEST.json"), "utf8"));
const identity = project.releaseIdentity;
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-client-release-test-"));
const home = path.join(temporary, "home");
const desktop = path.join(home, "Desktop");
const archiveName = `cc-theme-${identity.adapterId}-v${version}-r${identity.adapterReleaseRevision}-${identity.os}-${identity.arch}.zip`;
const archive = path.join(desktop, archiveName);
const extracted = path.join(temporary, "extracted");
const applyScript = path.join(root, "scripts", "apply-cc-theme-macos.sh");
const resourceValidator = path.join(root, "scripts", "validate-adapter-resources.mjs");

async function walk(directory, prefix = "") {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    result.push({ relative, absolute, directory: entry.isDirectory() });
    if (entry.isDirectory()) result.push(...await walk(absolute, relative));
  }
  return result;
}

try {
  pausedRegistration: {
    if (project.managerRegistration?.status === "paused") {
      assert.equal(project.projectStatus, "preserved-source");
      assert.equal(project.managerRegistration.engineDeliveryAllowed, false);
      await fs.mkdir(home, { recursive: true });
      await assert.rejects(
        execFile(builder, ["--skip-tests"], {
          env: { ...process.env, HOME: home, NODE: process.execPath },
          maxBuffer: 1024 * 1024,
        }),
        /Manager registration is paused; client Engine delivery is disabled/,
      );
      await assert.rejects(fs.access(archive), { code: "ENOENT" });
      console.log("PASS: paused Mac-Claude registration cannot build or deliver a client Engine.");
      break pausedRegistration;
    }
  assert.notEqual((await fs.stat(applyScript)).mode & 0o111, 0, "source apply script must be executable");
  const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
  assert.ok(readme.includes(`\`${archiveName}\``));
  assert.ok(readme.includes(`\`${archiveName}.sha256\``));
  assert.ok(readme.includes(`\`${identity.adapterId}-v${version}-r${identity.adapterReleaseRevision}\``));
  assert.equal(readme.includes("mac-claude-installer-v0.1.0.zip"), false);
  await fs.mkdir(home, { recursive: true });
  const { stdout } = await execFile(builder, ["--skip-tests"], {
    env: { ...process.env, HOME: home, NODE: process.execPath },
    maxBuffer: 1024 * 1024,
  });
  assert.match(stdout, new RegExp(`Created .*${archiveName.replaceAll(".", "\\.")}`));
  const firstChecksum = (await fs.readFile(`${archive}.sha256`, "utf8")).trim();
  const replacement = await execFile(builder, ["--skip-tests"], {
    env: { ...process.env, HOME: home, NODE: process.execPath, SOURCE_DATE_EPOCH: "1784246460" },
    maxBuffer: 1024 * 1024,
  });
  assert.match(replacement.stdout, new RegExp(`Created .*${archiveName.replaceAll(".", "\\.")}`));
  const replacementChecksum = (await fs.readFile(`${archive}.sha256`, "utf8")).trim();
  assert.notEqual(replacementChecksum, firstChecksum, "development rebuild must invalidate the previous digest");
  await execFile("/usr/bin/unzip", ["-tq", archive]);
  const archiveValidation = JSON.parse((await execFile(process.execPath, [resourceValidator, "--release-archive", archive])).stdout);
  assert.equal(archiveValidation.pass, true);
  assert.equal(archiveValidation.mode, "--release-archive");

  const checksum = (await fs.readFile(`${archive}.sha256`, "utf8")).trim();
  assert.match(checksum, new RegExp(`^[a-f0-9]{64}  ${archiveName.replaceAll(".", "\\.")}$`));

  await fs.mkdir(extracted, { recursive: true });
  await execFile("/usr/bin/ditto", ["-x", "-k", archive, extracted]);
  assert.deepEqual(await fs.readdir(extracted), ["CC Theme - mac-claude"]);

  const packageRoot = path.join(extracted, "CC Theme - mac-claude");
  const packageEntries = await walk(packageRoot);
  const names = new Set(packageEntries.map((entry) => entry.relative));
  assert.ok(names.has("安装 CC Theme.command"));
  const installCommand = await fs.readFile(path.join(packageRoot, "安装 CC Theme.command"), "utf8");
  assert.ok(installCommand.includes("--no-launchers --no-launch"));
  assert.ok(names.has(".mac-claude/contracts/cc-theme-package.json"));
  assert.ok(names.has(".mac-claude/contracts/adapter-resource-ownership.json"));
  assert.ok(names.has(".mac-claude/contracts/adapter-capability.json"));
  assert.ok(names.has(".mac-claude/contracts/claude-target-profile.schema.json"));
  assert.ok(names.has(".mac-claude/contracts/runtime-overrides-interface.json"));
  assert.ok(names.has(".mac-claude/contracts/theme-style-catalog.json"));
  assert.ok(names.has(".mac-claude/contracts/diagnostic-preview-interface.json"));
  assert.ok(names.has(".mac-claude/compatibility/claude-macos/1.22209.3/host-evidence.json"));
  assert.ok(names.has(".mac-claude/compatibility/claude-macos/1.22209.3/ui-surface-catalog.json"));
  assert.ok(names.has(".mac-claude/assets/ui-interpreter.js"));
  assert.ok(names.has(".mac-claude/scripts/validate-adapter-resources.mjs"));
  assert.ok(names.has(".mac-claude/scripts/project-unified-theme.mjs"));
  assert.ok(names.has(".mac-claude/scripts/adapter-transaction.mjs"));
  assert.ok(names.has(".mac-claude/scripts/diagnostic-preview.mjs"));
  assert.ok(names.has(".mac-claude/scripts/diagnostic-preview-server.mjs"));
  assert.ok(names.has(".mac-claude/scripts/start-diagnostic-preview-macos.sh"));
  assert.ok(names.has(".mac-claude/scripts/stop-diagnostic-preview-macos.sh"));
  assert.ok(names.has(".mac-claude/scripts/import-cc-theme.mjs"));
  assert.ok(names.has(".mac-claude/scripts/apply-cc-theme-macos.sh"));
  const packagedPackageJson = JSON.parse(await fs.readFile(path.join(packageRoot, ".mac-claude/package.json"), "utf8"));
  assert.equal(packagedPackageJson.repository.directory, "adapters/mac-claude");
  assert.equal(packagedPackageJson.version, version);
  const packagedProject = JSON.parse(await fs.readFile(path.join(packageRoot, ".mac-claude/PROJECT_MANIFEST.json"), "utf8"));
  assert.equal(packagedProject.adapterVersion, version);
  assert.deepEqual(packagedProject.releaseIdentity, identity);
  for (const schemaName of ["skin-theme.schema.json", "claude-target-profile.schema.json"]) {
    const packagedSchema = JSON.parse(await fs.readFile(path.join(packageRoot, ".mac-claude/contracts", schemaName), "utf8"));
    assert.equal(
      packagedSchema.$id,
      `https://raw.githubusercontent.com/quanzhankeji/cc-theme/main/adapters/mac-claude/contracts/${schemaName}`,
    );
  }
  assert.notEqual(
    (await fs.stat(path.join(packageRoot, ".mac-claude/scripts/apply-cc-theme-macos.sh"))).mode & 0o111,
    0,
    "packaged apply script must be executable",
  );
  const packageNotice = await fs.readFile(path.join(packageRoot, "使用说明.txt"), "utf8");
  assert.match(packageNotice, /诊断预览/);
  assert.match(packageNotice, /projection-only/);

  const forbiddenSegments = new Set(["presets", "themes", "theme-sources", "tests", "fixtures", "generator", "skills"]);
  const forbiddenExtensions = new Set([".cctheme", ".mp4", ".gif", ".png", ".jpg", ".jpeg", ".webp", ".heic", ".tif", ".tiff"]);
  for (const entry of packageEntries) {
    assert.equal(entry.relative.split("/").some((segment) => forbiddenSegments.has(segment)), false, `forbidden release path: ${entry.relative}`);
    assert.equal(forbiddenExtensions.has(path.extname(entry.relative).toLowerCase()), false, `theme media/package leaked into release: ${entry.relative}`);
    assert.notEqual(path.basename(entry.relative), "theme.json", `theme document leaked into release: ${entry.relative}`);
  }

  for (const retired of [
    "安装 mac-claude.command",
    ".mac-claude/contracts/claudeskin-package.json",
    ".mac-claude/scripts/import-claudeskin.mjs",
    ".mac-claude/scripts/apply-claudeskin-macos.sh",
  ]) {
    assert.equal(names.has(retired), false, `retired release entry remains: ${retired}`);
  }
  assert.equal(
    packageEntries.some((entry) => /(^|\/)(?:build-claude-skin|[^/]*claudeskin[^/]*)($|\/)/i.test(entry.relative)),
    false,
    "retired file or directory name remains in the client ZIP",
  );

  const retiredMime = Buffer.from(["application/vnd.", "claudeskin", ".theme+zip"].join(""));
  const retiredJobNamespace = Buffer.from(["com", "openai", "cc-theme-studio"].join("."));
  const oldWorkspacePath = Buffer.from(["/codexskin", "/mac-claude"].join(""));
  const oldGithubPath = Buffer.from(["/main", "/mac-claude/"].join(""));
  const retiredManagerPath = Buffer.from(["mac", "app"].join("-"));
  const retiredAdapterAlias = Buffer.from(["mac", "claude", "skin"].join("-"));
  for (const entry of packageEntries) {
    if (entry.directory) continue;
    const bytes = await fs.readFile(entry.absolute);
    assert.equal(bytes.includes(retiredMime), false, `retired MIME remains in ${entry.relative}`);
    assert.equal(bytes.includes(retiredJobNamespace), false, `retired job namespace remains in ${entry.relative}`);
    assert.equal(bytes.includes(oldWorkspacePath), false, `old workspace path remains in ${entry.relative}`);
    assert.equal(bytes.includes(oldGithubPath), false, `old GitHub path remains in ${entry.relative}`);
    assert.equal(bytes.includes(retiredManagerPath), false, `retired Manager path remains in ${entry.relative}`);
    assert.equal(bytes.includes(retiredAdapterAlias), false, `retired Adapter alias remains in ${entry.relative}`);
  }

  const unexpectedArchive = path.join(temporary, "unexpected-wrapper.zip");
  await fs.copyFile(archive, unexpectedArchive);
  await fs.writeFile(path.join(packageRoot, "unexpected.foo"), "not allowed\n");
  await execFile("/usr/bin/zip", ["-q", unexpectedArchive, "CC Theme - mac-claude/unexpected.foo"], { cwd: extracted });
  await assert.rejects(
    execFile(process.execPath, [resourceValidator, "--release-archive", unexpectedArchive]),
    (error) => /outside the closed release layout/i.test(error.stderr || error.message),
  );

  const emptyForbiddenDirectoryArchive = path.join(temporary, "empty-forbidden-directory.zip");
  await fs.copyFile(archive, emptyForbiddenDirectoryArchive);
  const emptyForbiddenDirectory = path.join(packageRoot, ".mac-claude", "assets", "themes");
  await fs.mkdir(emptyForbiddenDirectory, { recursive: true });
  await execFile(
    "/usr/bin/zip",
    ["-q", emptyForbiddenDirectoryArchive, "CC Theme - mac-claude/.mac-claude/assets/themes/"],
    { cwd: extracted },
  );
  await assert.rejects(
    execFile(process.execPath, [resourceValidator, "--release-archive", emptyForbiddenDirectoryArchive]),
    (error) => /forbidden archive directory/i.test(error.stderr || error.message),
  );

  console.log("PASS: the CC Theme client release uses the versioned asset name and excludes retired filenames, scripts, and MIME.");
  }
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
