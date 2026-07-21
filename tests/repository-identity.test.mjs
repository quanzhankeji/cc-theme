import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = ".cctheme";
const mimeType = "application/vnd.cc-theme.theme+zip";
const officialWebsite = "https://cc-theme.app";
const allowedReadmeHosts = new Set(["cc-theme.app", "docs.github.com", "github.com"]);

async function json(relative) {
  return JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
}

async function exists(relative) {
  try {
    await fs.access(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    if (["node_modules", "dist", ".next", ".vinext", ".wrangler", "release"].includes(entry.name)) continue;
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result;
}

test("all package contracts use the exclusive CC Theme transport identity", async () => {
  const contracts = [
    ["adapters/mac-codex/contracts/cc-theme-package.json", "mac-codex"],
    ["adapters/mac-workbuddy/contracts/cc-theme-package.json", "mac-workbuddy"],
  ];
  for (const [relative, adapterId] of contracts) {
    const contract = await json(relative);
    assert.equal(contract.extension, extension, relative);
    assert.equal(contract.mimeType, mimeType, relative);
    assert.equal(contract.container, "zip", relative);
    assert.equal(contract.manifestKind, "skin.package", relative);
    assert.equal(contract.documentKind, "skin.document", relative);
    assert.equal(contract.themeKind, "skin.theme", relative);
    if (adapterId) assert.equal(contract.target.adapterId, adapterId, relative);
  }
  const managerConfig = await json("app/src-tauri/tauri.conf.json");
  const association = managerConfig.bundle.fileAssociations.find(({ ext }) => ext.includes("cctheme"));
  assert.equal(association.mimeType, mimeType);
  assert.equal(association.exportedType.identifier, "com.quanzhankeji.cc-theme-package");
  assert.ok(association.exportedType.conformsTo.includes("public.zip-archive"));
});

test("public repository Interfaces contain only canonical Adapter IDs", async () => {
  const retired = ["codex", "claude", "workbuddy"].map((client) => ["mac", client, "skin"].join("-"));
  const directories = ["app/packages", "app/registry", "tests", "docs", ".github"];
  for (const localThemeDirectory of ["themes/example", "themes/xtxg", "themes/wolp", "themes/tests", "themes/tools"]) {
    if (await exists(localThemeDirectory)) directories.push(localThemeDirectory);
  }
  const rootFiles = (await fs.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(?:json|md|mjs|toml|ya?ml)$/i.test(entry.name))
    .map((entry) => entry.name);
  const files = [...rootFiles, ...(await Promise.all(directories.map((directory) => walk(directory)))).flat()];
  for (const relative of files) {
    if (/\.(?:cctheme|gif|jpe?g|mov|mp4|png|webm|webp|zip)$/i.test(relative)) continue;
    const bytes = await fs.readFile(path.join(root, relative));
    if (bytes.includes(0)) continue;
    const content = bytes.toString("utf8");
    for (const adapterId of retired) assert.equal(content.includes(adapterId), false, `${relative}: ${adapterId}`);
  }
});

test("retired contract and importer filenames are absent", async () => {
  const retired = [
    "adapters/mac-codex/contracts/codexskin-package.json",
    "adapters/mac-workbuddy/contracts/codexskin-package.json",
    "adapters/mac-codex/scripts/apply-codexskin-macos.sh",
    "adapters/mac-codex/scripts/import-codexskin.mjs",
    "adapters/mac-workbuddy/scripts/apply-codexskin-macos.sh",
    "adapters/mac-workbuddy/scripts/import-codexskin.mjs",
  ];
  for (const relative of retired) assert.equal(await exists(relative), false, relative);

  const active = [
    "adapters/mac-codex/scripts/apply-cc-theme-macos.sh",
    "adapters/mac-codex/scripts/import-cc-theme.mjs",
    "adapters/mac-workbuddy/scripts/apply-cc-theme-macos.sh",
    "adapters/mac-workbuddy/scripts/import-cc-theme.mjs",
  ];
  for (const relative of active) assert.equal(await exists(relative), true, relative);
});

test("active source contains no retired brand, MIME, domain, repository, or constant prefix", async () => {
  const files = [
    ...await walk("adapters/mac-codex"),
    ...await walk("adapters/mac-workbuddy"),
    ...await walk("app/packages/contracts"),
  ];
  const forbidden = [
    "application/vnd.codexskin.theme+zip",
    "CODEXSKIN_",
    "https://codexskin.pro",
    "github.com/quanzhankeji/codex-skin",
    "codexskin.media-limits",
    "codexskin.background-",
  ];
  for (const relative of files) {
    if (/\.(?:zip|mp4|png|jpe?g|webp|woff2?)$/i.test(relative)) continue;
    const bytes = await fs.readFile(path.join(root, relative));
    if (bytes.includes(0)) continue;
    const content = bytes.toString("utf8");
    for (const token of forbidden) {
      if (token === "application/vnd.codexskin.theme+zip" && relative.includes("/tests/")) continue;
      assert.equal(content.includes(token), false, `${relative}: ${token}`);
    }
  }
});

test("repository metadata points to the new repository and controlled official website", async () => {
  for (const relative of ["adapters/mac-codex/package.json", "adapters/mac-doubao/package.json", "adapters/mac-workbuddy/package.json"]) {
    const metadata = await json(relative);
    assert.equal(metadata.homepage, "https://github.com/quanzhankeji/cc-theme", relative);
    assert.equal(metadata.repository.url, "git+https://github.com/quanzhankeji/cc-theme.git", relative);
    assert.equal(metadata.bugs.url, "https://github.com/quanzhankeji/cc-theme/issues", relative);
  }
  const readmes = [
    ["README.md", `Official website: [cc-theme.app](${officialWebsite})`],
    ["README.zh-CN.md", `官方网站：[cc-theme.app](${officialWebsite})`],
  ];
  for (const [relative, expectedWebsiteLine] of readmes) {
    const readme = await fs.readFile(path.join(root, relative), "utf8");
    assert.match(readme, /github\.com\/quanzhankeji\/cc-theme/);
    assert.match(readme, /`\.cctheme`/);
    const websiteClaims = readme.split(/\r?\n/).filter((line) => /\bwebsite\b|官方网站|官网/i.test(line));
    assert.deepEqual(websiteClaims, [expectedWebsiteLine], `${relative}: official website claim`);
    assert.equal(readme.split(expectedWebsiteLine).length - 1, 1, `${relative}: official website count`);
    assert.doesNotMatch(readme.replace(expectedWebsiteLine, ""), /cc-theme\.app/i, `${relative}: unbound official domain`);

    const absoluteUrls = [...readme.matchAll(/https?:\/\/[^\s<>()\]]+/g)].map(([url]) => url);
    const officialUrls = [];
    for (const value of absoluteUrls) {
      const url = new URL(value);
      assert.equal(url.protocol, "https:", `${relative}: insecure URL ${value}`);
      assert.equal(allowedReadmeHosts.has(url.hostname), true, `${relative}: unapproved external host ${url.hostname}`);
      if (url.hostname === "cc-theme.app") {
        officialUrls.push(value);
        assert.equal(url.origin, officialWebsite, `${relative}: official website origin`);
        assert.equal(url.pathname, "/", `${relative}: official website path`);
        assert.equal(url.username, "", `${relative}: official website username`);
        assert.equal(url.password, "", `${relative}: official website password`);
        assert.equal(url.port, "", `${relative}: official website port`);
        assert.equal(url.search, "", `${relative}: official website query`);
        assert.equal(url.hash, "", `${relative}: official website fragment`);
      }
    }
    assert.deepEqual(officialUrls, [officialWebsite], `${relative}: canonical HTTPS website URL`);
    assert.doesNotMatch(readme, /Web Studio|online editor|在线编辑器/i);
  }
});
