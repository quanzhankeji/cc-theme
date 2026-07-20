import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const themeConfig = path.join(root, "scripts", "theme-config.mjs");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-restore-idempotency-"));

try {
  const config = path.join(temporary, "config.toml");
  const missingBackup = path.join(temporary, "missing-theme-backup.json");
  const original = Buffer.from([
    'model = "gpt-5"',
    "",
    "[desktop]",
    'appearanceTheme = "system"',
    'appearanceDarkCodeThemeId = "vscode-dark"',
    "keepMe = true",
    "",
  ].join("\n"));
  await fs.writeFile(config, original, { mode: 0o640 });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { stdout } = await execFile(process.execPath, [themeConfig, "restore", config, missingBackup]);
    assert.match(stdout, /No selective pre-install theme backup.*nothing was restored/i);
    assert.deepEqual(await fs.readFile(config), original);
    assert.equal((await fs.stat(config)).mode & 0o777, 0o640);
  }

  const assertRestoreFailsClosed = async (backup, pattern) => {
    await assert.rejects(
      execFile(process.execPath, [themeConfig, "restore", config, backup]),
      pattern,
    );
    assert.deepEqual(await fs.readFile(config), original);
    assert.equal((await fs.stat(config)).mode & 0o777, 0o640);
    assert.equal((await fs.lstat(backup)).isFile(), true);
  };

  const corruptBackup = path.join(temporary, "corrupt-theme-backup.json");
  await fs.writeFile(corruptBackup, "{not-json}\n");
  await assertRestoreFailsClosed(corruptBackup, /Could not read the theme backup/);

  const mismatchedBackup = path.join(temporary, "mismatched-theme-backup.json");
  await fs.writeFile(mismatchedBackup, `${JSON.stringify({
    schemaVersion: 1,
    platform: "darwin",
    configPath: path.join(temporary, "different-config.toml"),
    values: {
      appearanceTheme: 'appearanceTheme = "dark"',
      appearanceDarkCodeThemeId: null,
    },
  })}\n`);
  await assertRestoreFailsClosed(mismatchedBackup, /identity or schema does not match/);

  const realBackup = path.join(temporary, "real-theme-backup.json");
  await fs.writeFile(realBackup, `${JSON.stringify({
    schemaVersion: 1,
    platform: "darwin",
    configPath: config,
    values: {
      appearanceTheme: 'appearanceTheme = "dark"',
      appearanceDarkCodeThemeId: null,
    },
  })}\n`);
  const symlinkBackup = path.join(temporary, "symlink-theme-backup.json");
  await fs.symlink(realBackup, symlinkBackup);
  await assert.rejects(
    execFile(process.execPath, [themeConfig, "restore", config, symlinkBackup]),
    /regular file, not a symbolic link/,
  );
  assert.deepEqual(await fs.readFile(config), original);
  assert.equal((await fs.lstat(symlinkBackup)).isSymbolicLink(), true);
  assert.equal((await fs.lstat(realBackup)).isFile(), true);

  const danglingBackup = path.join(temporary, "dangling-theme-backup.json");
  await fs.symlink(path.join(temporary, "absent-target.json"), danglingBackup);
  await assert.rejects(
    execFile(process.execPath, [themeConfig, "restore", config, danglingBackup]),
    /regular file, not a symbolic link/,
  );
  assert.deepEqual(await fs.readFile(config), original);
  assert.equal((await fs.lstat(danglingBackup)).isSymbolicLink(), true);

  const [restoreSource, commonSource] = await Promise.all([
    fs.readFile(path.join(root, "scripts", "restore-skin-macos.sh"), "utf8"),
    fs.readFile(path.join(root, "scripts", "common-macos.sh"), "utf8"),
  ]);
  assert.match(
    restoreSource,
    /^stop_recorded_injector$/m,
    "Restore must enter owned watcher cleanup whether state.json exists or not.",
  );
  assert.doesNotMatch(restoreSource, /\[ -f "\$STATE_PATH" \] && stop_recorded_injector/);
  const stopInjector = commonSource.slice(
    commonSource.indexOf("stop_recorded_injector()"),
    commonSource.indexOf("launch_injector_daemon()"),
  );
  assert.match(
    stopInjector,
    /remove_injector_launch_agent[\s\S]*\[ -f "\$STATE_PATH" \] \|\| return 0/,
    "Owned launchd cleanup must precede the no-state early return.",
  );

  console.log("PASS: restore is idempotent, fails closed on unsafe backups, and always cleans owned watchers.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
