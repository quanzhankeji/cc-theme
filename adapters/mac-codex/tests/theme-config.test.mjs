import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "../scripts/theme-config.mjs");
const tempRoot = await fs.mkdtemp(path.join("/tmp", "cc-theme-config-"));

function run(mode, config, backup) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, mode, config, backup], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `theme-config exited with ${code}`)));
  });
}

try {
  const valid = path.join(tempRoot, "valid.toml");
  const validBackup = path.join(tempRoot, "valid-backup.json");
  const original = 'model = "gpt-5"\r\n\r\n[desktop] # keep comment\r\nappearanceTheme = "system"\r\nappearanceDarkCodeThemeId = "vscode-dark"\r\nkeepMe = "中文"\r\n';
  await fs.writeFile(valid, original);
  await run("install", valid, validBackup);
  assert.equal(await fs.readFile(valid, "utf8"), original);
  await run("restore", valid, validBackup);
  assert.equal(await fs.readFile(valid, "utf8"), original);

  const rejectUnchanged = async (name, bytes, pattern) => {
    const config = path.join(tempRoot, `${name}.toml`);
    const backup = path.join(tempRoot, `${name}.json`);
    await fs.writeFile(config, bytes);
    const before = await fs.readFile(config);
    await assert.rejects(run("install", config, backup), pattern);
    assert.deepEqual(await fs.readFile(config), before);
  };
  await rejectUnchanged("duplicate-table", "[desktop]\nkeepMe=true\n[desktop]\nkeepMe=false\n", /multiple \[desktop\]/);
  await rejectUnchanged("duplicate-key", "[desktop]\nappearanceTheme=\"dark\"\nappearanceTheme=\"light\"\n", /duplicate appearanceTheme/);
  await rejectUnchanged("multiline-string", '[desktop]\nkeepMe = """unsafe"""\n', /multiline strings/);
  await rejectUnchanged("multiline-array", "[desktop]\nkeepMe = [\n  1,\n  2\n]\n", /multiline arrays/);
  await rejectUnchanged("invalid-utf8", Buffer.from([0x5b, 0x64, 0x65, 0x73, 0x6b, 0x74, 0x6f, 0x70, 0x5d, 0x0a, 0xff]), /not valid UTF-8/);

  const unsafeLockConfig = path.join(tempRoot, "unsafe-lock.toml");
  const unsafeLockBackup = path.join(tempRoot, "unsafe-lock.json");
  await fs.writeFile(unsafeLockConfig, "[desktop]\nkeepMe=true\n");
  await fs.symlink(tempRoot, `${unsafeLockConfig}.skin.lock`);
  await assert.rejects(run("install", unsafeLockConfig, unsafeLockBackup), /configuration lock location is unsafe/);

  const symlinkTarget = path.join(tempRoot, "target.toml");
  const symlinkConfig = path.join(tempRoot, "symlink.toml");
  await fs.writeFile(symlinkTarget, "[desktop]\nkeepMe=true\n");
  await fs.symlink(symlinkTarget, symlinkConfig);
  await assert.rejects(run("install", symlinkConfig, path.join(tempRoot, "symlink-backup.json")), /regular file/);

  console.log("PASS: config transactions preserve UTF-8/TOML and reject duplicate, multiline, symlink, and unsafe-lock input.");
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
