import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADAPTER_PACKAGE_KIND,
  ADAPTER_PACKAGE_SCHEMA_VERSION,
  buildAdapterPackage,
  verifyAdapterPackage,
} from "../scripts/adapter-package.mjs";

const managerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(managerRoot, "..");
const adapters = [
  {
    adapterId: "mac-codex",
    adapterVersion: "26.715.31925",
    adapterReleaseRevision: 1,
    assetIdentity: "mac-codex-26.715.31925-r1-macos-arm64",
    capabilityVersion: "2.0.0",
  },
  {
    adapterId: "mac-workbuddy",
    adapterVersion: "5.2.6",
    adapterReleaseRevision: 1,
    assetIdentity: "mac-workbuddy-5.2.6-r1-macos-arm64",
    capabilityVersion: "1.0.0",
  },
];

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

async function temporaryDirectory(t, label) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `ccadapter-${label}-`));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function centralEntries(archive) {
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50);
  const count = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  const result = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    result.push({
      centralOffset: cursor,
      localOffset,
      dataOffset: localOffset + 30 + localNameLength + localExtraLength,
      bytes: archive.readUInt32LE(cursor + 24),
      name: archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"),
      nameLength,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

function renameEntry(archive, entry, replacement) {
  const name = Buffer.from(replacement, "utf8");
  assert.equal(name.length, entry.nameLength);
  name.copy(archive, entry.centralOffset + 46);
  name.copy(archive, entry.localOffset + 30);
}

function rewriteEntryData(archive, entryName, transform) {
  const entry = centralEntries(archive).find(({ name }) => name === entryName);
  assert.ok(entry, entryName);
  const original = archive.subarray(entry.dataOffset, entry.dataOffset + entry.bytes);
  const replacement = Buffer.from(transform(Buffer.from(original)));
  assert.equal(replacement.length, original.length, "malicious rewrite must retain ZIP bounds");
  replacement.copy(archive, entry.dataOffset);
  const checksum = crc32(replacement);
  archive.writeUInt32LE(checksum, entry.localOffset + 14);
  archive.writeUInt32LE(checksum, entry.centralOffset + 16);
}

async function writeArchive(directory, name, bytes) {
  const file = path.join(directory, name);
  await fs.writeFile(file, bytes);
  return file;
}

async function buildWorkBuddy(t, label = "valid") {
  const outputDirectory = await temporaryDirectory(t, label);
  return buildAdapterPackage({
    sourceRoot: path.join(workspaceRoot, "adapters", "mac-workbuddy"),
    outputDirectory,
    adapterId: "mac-workbuddy",
    architecture: "arm64",
    minimumManagerVersion: "0.1.0",
    unifiedThemeSchemaVersion: 1,
  });
}

async function syntheticWorkBuddySource(t, entries = []) {
  const root = await temporaryDirectory(t, "source");
  await fs.mkdir(path.join(root, "contracts"), { recursive: true });
  const required = ["VERSION", "contracts/adapter-capability.json", "contracts/adapter-release-manifest.json"];
  await fs.writeFile(path.join(root, "VERSION"), "0.1.0\n");
  await fs.writeFile(path.join(root, "contracts", "adapter-capability.json"), `${JSON.stringify({ adapterId: "mac-workbuddy", capabilityVersion: 1 })}\n`);
  await fs.writeFile(path.join(root, "contracts", "adapter-release-manifest.json"), `${JSON.stringify({
    kind: "workbuddy-adapter.release-manifest",
    revision: 1,
    adapterId: "mac-workbuddy",
    adapterVersion: "0.1.0",
    adapterReleaseRevision: 1,
    platform: "macos",
    architecture: "arm64",
    assetIdentity: "mac-workbuddy-0.1.0-r1-macos-arm64",
    entries: [...required, ...entries],
  }, null, 2)}\n`);
  return root;
}

test("the public schema is closed and extensible while current build admission stays Mac-only", async () => {
  const schema = JSON.parse(await fs.readFile(path.join(managerRoot, "contracts", "ccadapter-package.schema.json"), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.kind.const, ADAPTER_PACKAGE_KIND);
  assert.equal(schema.properties.schemaVersion.const, ADAPTER_PACKAGE_SCHEMA_VERSION);
  const adapterId = new RegExp(schema.$defs.adapterId.pattern);
  assert.equal(adapterId.test("mac-codex"), true);
  assert.equal(adapterId.test("mac-future-client"), true);
  assert.equal(adapterId.test("mac-workbuddy-skin"), false);
  assert.deepEqual(schema.properties.platform.enum, ["macos", "windows"]);
  assert.deepEqual(schema.required.slice(2, 6), [
    "adapterId", "adapterVersion", "adapterReleaseRevision", "assetIdentity",
  ]);
  assert.equal(schema.$defs.contracts.additionalProperties, false);
  assert.deepEqual(schema.$defs.contracts.required.sort(), [
    "adapterPackageSchemaVersion", "capabilityVersion", "minimumManagerVersion", "unifiedThemeSchemaVersion",
  ]);
  assert.equal(schema.$defs.file.additionalProperties, false);
  assert.deepEqual(schema.$defs.file.properties.mode.enum, [420, 493]);
});

test("both active Mac Adapters preserve their host-version and release-revision identity in the verified package", async (t) => {
  const outputDirectory = await temporaryDirectory(t, "two-mac");
  for (const { adapterId, adapterVersion, adapterReleaseRevision, assetIdentity, capabilityVersion } of adapters) {
    const built = await buildAdapterPackage({
      sourceRoot: path.join(workspaceRoot, "adapters", adapterId),
      outputDirectory,
      adapterId,
      architecture: "arm64",
      minimumManagerVersion: "0.1.0",
      unifiedThemeSchemaVersion: 1,
    });
    assert.equal(built.assetName, `${assetIdentity}.ccadapter`);
    const verified = await verifyAdapterPackage(built.archivePath, {
      expectedArchiveSha256: built.sha256,
      expected: {
        adapterId,
        architecture: "arm64",
        capabilityVersion,
        managerVersion: "0.1.0",
        platform: "macos",
        unifiedThemeSchemaVersion: 1,
      },
    });
    assert.equal(verified.ok, true);
    assert.equal(verified.manifest.adapterVersion, adapterVersion);
    assert.equal(verified.manifest.adapterReleaseRevision, adapterReleaseRevision);
    assert.equal(verified.manifest.assetIdentity, assetIdentity);
    assert.equal(verified.manifest.contracts.capabilityVersion, capabilityVersion);
    assert.equal(verified.manifest.files.every(({ path: file }) => file.startsWith("payload/")), true);
    assert.equal(verified.manifest.files.some(({ path: file }) => /(?:^|\/)(?:tests?|fixtures?|staging|themes?|presets?)(?:\/|$)/i.test(file)), false);
    assert.equal(verified.manifest.files.some(({ path: file }) => /\.(?:cctheme|gif|jpe?g|mov|mp4|png|webm|webp|zip)$/i.test(file)), false);
    const sidecar = JSON.parse(await fs.readFile(built.sidecarPath, "utf8"));
    assert.equal(sidecar.sha256, built.sha256);
    assert.equal(sidecar.bytes, built.bytes);
    assert.deepEqual(sidecar.package, built.manifest);
  }
});

test("packing identical input is byte-for-byte deterministic", async (t) => {
  const leftDirectory = await temporaryDirectory(t, "deterministic-left");
  const rightDirectory = await temporaryDirectory(t, "deterministic-right");
  const input = {
    sourceRoot: path.join(workspaceRoot, "adapters", "mac-codex"),
    adapterId: "mac-codex",
    architecture: "arm64",
    minimumManagerVersion: "0.1.0",
    unifiedThemeSchemaVersion: 1,
  };
  const left = await buildAdapterPackage({ ...input, outputDirectory: leftDirectory });
  const right = await buildAdapterPackage({ ...input, outputDirectory: rightDirectory });
  assert.equal(left.sha256, right.sha256);
  assert.deepEqual(await fs.readFile(left.archivePath), await fs.readFile(right.archivePath));
  assert.deepEqual(await fs.readFile(left.sidecarPath), await fs.readFile(right.sidecarPath));
});

test("offline verification enforces archive identity, target, and compatibility", async (t) => {
  const built = await buildWorkBuddy(t, "compatibility");
  const base = {
    expectedArchiveSha256: built.sha256,
    expected: {
      adapterId: "mac-workbuddy",
      architecture: "arm64",
      capabilityVersion: "1.0.0",
      managerVersion: "0.1.0",
      platform: "macos",
      unifiedThemeSchemaVersion: 1,
    },
  };
  await assert.doesNotReject(() => verifyAdapterPackage(built.archivePath, base));
  await assert.rejects(() => verifyAdapterPackage(built.archivePath, { ...base, expectedArchiveSha256: "0".repeat(64) }), /archive SHA-256 mismatch/);
  for (const [field, value, message] of [
    ["adapterId", "mac-codex", /adapterId/],
    ["architecture", "x86_64", /architecture/],
    ["platform", "windows", /platform/],
    ["managerVersion", "0.0.9", /Manager version/],
    ["capabilityVersion", "2.0.0", /capability contract/],
    ["unifiedThemeSchemaVersion", 2, /Unified Theme schema/],
  ]) {
    await assert.rejects(() => verifyAdapterPackage(built.archivePath, {
      ...base,
      expected: { ...base.expected, [field]: value },
    }), message);
  }

  const prereleaseDirectory = await temporaryDirectory(t, "prerelease-compatibility");
  const prerelease = await buildAdapterPackage({
    sourceRoot: path.join(workspaceRoot, "adapters", "mac-workbuddy"),
    outputDirectory: prereleaseDirectory,
    adapterId: "mac-workbuddy",
    architecture: "arm64",
    minimumManagerVersion: "0.1.0-beta.11",
    unifiedThemeSchemaVersion: 1,
  });
  await assert.rejects(() => verifyAdapterPackage(prerelease.archivePath, {
    expected: { ...base.expected, managerVersion: "0.1.0-beta.2" },
  }), /Manager version is below/);
  await assert.doesNotReject(() => verifyAdapterPackage(prerelease.archivePath, {
    expected: { ...base.expected, managerVersion: "0.1.0-beta.12" },
  }));
});

test("source admission rejects case collisions, symlinks, forbidden trees/media, unknown fields, and retired public IDs", async (t) => {
  const outputDirectory = await temporaryDirectory(t, "source-rejections-out");
  const collision = await syntheticWorkBuddySource(t, ["NOTICE.md", "notice.md"]);
  await assert.rejects(() => buildAdapterPackage({ sourceRoot: collision, outputDirectory, adapterId: "mac-workbuddy", architecture: "arm64" }), /duplicate entries/);

  for (const forbidden of ["tests/example.mjs", "fixtures/example.json", "staging/example.json", "themes/production.png"] ) {
    const root = await syntheticWorkBuddySource(t, [forbidden]);
    await assert.rejects(() => buildAdapterPackage({ sourceRoot: root, outputDirectory, adapterId: "mac-workbuddy", architecture: "arm64" }), /forbidden directory|production theme/);
  }

  const symlink = await syntheticWorkBuddySource(t);
  await fs.unlink(path.join(symlink, "VERSION"));
  await fs.symlink(path.join(workspaceRoot, "adapters", "mac-workbuddy", "VERSION"), path.join(symlink, "VERSION"));
  await assert.rejects(() => buildAdapterPackage({ sourceRoot: symlink, outputDirectory, adapterId: "mac-workbuddy", architecture: "arm64" }), /resolves outside|non-symlink/);

  const unknown = await syntheticWorkBuddySource(t);
  const manifestPath = path.join(unknown, "contracts", "adapter-release-manifest.json");
  const release = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  release.unexpected = true;
  await fs.writeFile(manifestPath, `${JSON.stringify(release, null, 2)}\n`);
  await assert.rejects(() => buildAdapterPackage({ sourceRoot: unknown, outputDirectory, adapterId: "mac-workbuddy", architecture: "arm64" }), /unknown fields/);

  const retired = await syntheticWorkBuddySource(t, ["NOTICE.md"]);
  await fs.writeFile(path.join(retired, "NOTICE.md"), ["mac", "workbuddy", "skin"].join("-"));
  await assert.rejects(() => buildAdapterPackage({ sourceRoot: retired, outputDirectory, adapterId: "mac-workbuddy", architecture: "arm64" }), /retired public Adapter ID/);

  const disguisedMedia = await syntheticWorkBuddySource(t, ["assets/background.dat"]);
  await fs.mkdir(path.join(disguisedMedia, "assets"), { recursive: true });
  await fs.writeFile(path.join(disguisedMedia, "assets", "background.dat"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));
  await assert.rejects(
    () => buildAdapterPackage({ sourceRoot: disguisedMedia, outputDirectory, adapterId: "mac-workbuddy", architecture: "arm64" }),
    /media or archive content disguised/,
  );
});

test("offline verification rejects duplicate and case-colliding ZIP entries", async (t) => {
  const built = await buildWorkBuddy(t, "duplicate-source");
  const original = await fs.readFile(built.archivePath);
  const entries = centralEntries(original);
  let pair;
  for (let left = 1; left < entries.length && !pair; left += 1) {
    const right = entries.findIndex((entry, index) => index > left && entry.nameLength === entries[left].nameLength);
    if (right > left) pair = [entries[left], entries[right]];
  }
  assert.ok(pair, "fixture package must contain two equal-length paths");

  const duplicate = Buffer.from(original);
  renameEntry(duplicate, pair[1], pair[0].name);
  const duplicatePath = await writeArchive(await temporaryDirectory(t, "duplicate"), "duplicate.ccadapter", duplicate);
  await assert.rejects(() => verifyAdapterPackage(duplicatePath), /duplicate entries/);

  const collision = Buffer.from(original);
  renameEntry(collision, pair[1], pair[0].name.toUpperCase());
  const collisionPath = await writeArchive(await temporaryDirectory(t, "case-collision"), "collision.ccadapter", collision);
  await assert.rejects(() => verifyAdapterPackage(collisionPath), /duplicate entries/);
});

test("offline verification rejects path traversal, symlink and mode metadata", async (t) => {
  const built = await buildWorkBuddy(t, "metadata-source");
  const original = await fs.readFile(built.archivePath);

  const traversal = Buffer.from(original);
  const traversalEntry = centralEntries(traversal)[1];
  renameEntry(traversal, traversalEntry, `payload/../${"x".repeat(traversalEntry.nameLength - "payload/../".length)}`);
  const traversalPath = await writeArchive(await temporaryDirectory(t, "traversal"), "traversal.ccadapter", traversal);
  await assert.rejects(() => verifyAdapterPackage(traversalPath), /entries do not exactly match|path traversal/);

  for (const [label, unixMode, message] of [
    ["symlink", 0o120777, /symlink or non-regular/],
    ["mode", 0o100600, /file mode/],
  ]) {
    const malicious = Buffer.from(original);
    const entry = centralEntries(malicious)[1];
    malicious.writeUInt32LE((unixMode << 16) >>> 0, entry.centralOffset + 38);
    const maliciousPath = await writeArchive(await temporaryDirectory(t, label), `${label}.ccadapter`, malicious);
    await assert.rejects(() => verifyAdapterPackage(maliciousPath), message);
  }
});

test("offline verification rejects unknown manifest fields and digest/byte tampering", async (t) => {
  const built = await buildWorkBuddy(t, "manifest-source");
  const original = await fs.readFile(built.archivePath);
  const mutations = [
    ["unknown", (text) => text.replace('"adapterVersion"', '"adapterMystery"'), /unknown fields/],
    ["digest", (text) => text.replace(/("sha256": ")([0-9a-f])/, (_match, prefix, digit) => `${prefix}${digit === "0" ? "1" : "0"}`), /SHA-256.*mismatch/],
    ["bytes", (text) => text.replace(/("bytes": )(\d+)/, (_match, prefix, value) => `${prefix}${Number(value) + 1}`), /bytes, SHA-256, or mode mismatch/],
  ];
  for (const [label, mutate, message] of mutations) {
    const malicious = Buffer.from(original);
    rewriteEntryData(malicious, "adapter.json", (bytes) => Buffer.from(mutate(bytes.toString("utf8")), "utf8"));
    const maliciousPath = await writeArchive(await temporaryDirectory(t, label), `${label}.ccadapter`, malicious);
    await assert.rejects(() => verifyAdapterPackage(maliciousPath), message);
  }
});

test("offline verification rejects media magic even when payload path and manifest digest are disguised", async (t) => {
  const built = await buildWorkBuddy(t, "disguised-media-archive-source");
  const malicious = Buffer.from(await fs.readFile(built.archivePath));
  const manifestEntry = centralEntries(malicious).find(({ name }) => name === "adapter.json");
  assert.ok(manifestEntry);
  const manifest = JSON.parse(malicious.subarray(manifestEntry.dataOffset, manifestEntry.dataOffset + manifestEntry.bytes).toString("utf8"));
  const target = manifest.files.find(({ path: file, bytes }) => file.endsWith("adapter-capability.json") && bytes >= 9);
  assert.ok(target);
  let replacement;
  rewriteEntryData(malicious, target.path, (bytes) => {
    replacement = Buffer.from(bytes);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).copy(replacement);
    return replacement;
  });
  const replacementSha256 = createHash("sha256").update(replacement).digest("hex");
  rewriteEntryData(malicious, "adapter.json", (bytes) => {
    const source = bytes.toString("utf8");
    const updated = source.replace(target.sha256, replacementSha256);
    assert.notEqual(updated, source);
    return Buffer.from(updated, "utf8");
  });
  const maliciousPath = await writeArchive(
    await temporaryDirectory(t, "disguised-media-archive"),
    "disguised-media.ccadapter",
    malicious,
  );
  await assert.rejects(() => verifyAdapterPackage(maliciousPath), /media or archive content disguised/);
});

test("a failed publish does not overwrite an existing archive or leave a new archive", async (t) => {
  const outputDirectory = await temporaryDirectory(t, "publish");
  const first = await buildAdapterPackage({
    sourceRoot: path.join(workspaceRoot, "adapters", "mac-workbuddy"),
    outputDirectory,
    adapterId: "mac-workbuddy",
    architecture: "arm64",
  });
  const original = await fs.readFile(first.archivePath);
  await assert.rejects(() => buildAdapterPackage({
    sourceRoot: path.join(workspaceRoot, "adapters", "mac-workbuddy"),
    outputDirectory,
    adapterId: "mac-workbuddy",
    architecture: "arm64",
  }), /EEXIST/);
  assert.deepEqual(await fs.readFile(first.archivePath), original);
  assert.equal(createHash("sha256").update(original).digest("hex"), first.sha256);
  assert.deepEqual((await fs.readdir(outputDirectory)).sort(), [first.assetName, `${first.assetName}.manifest.json`].sort());
});
