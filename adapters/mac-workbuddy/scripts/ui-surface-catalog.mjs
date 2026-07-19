import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_VERSION = "5.2.6";
export const UI_SURFACE_SCHEMA_VERSION = 2;
export const UI_SURFACE_CATALOG_VERSION = 2;
export const UI_INTERPRETER_VERSION = 2;

export const catalogPathFor = (version = DEFAULT_VERSION) => path.join(
  ROOT,
  "compatibility",
  "workbuddy-macos",
  version,
  "ui-surface-catalog.json",
);

export const catalogDocumentPath = path.join(ROOT, "docs", "UI-SURFACE-CATALOG.md");

export async function loadUiSurfaceCatalog(version = DEFAULT_VERSION) {
  return JSON.parse(await fs.readFile(catalogPathFor(version), "utf8"));
}

const duplicateValues = (values) => values.filter((value, index) => values.indexOf(value) !== index);

const generatedClassPattern = /(?:^|[.\s])_[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9]+_[0-9]+/;

export function validateUiSurfaceCatalog(catalog) {
  const errors = [];
  const add = (condition, message) => {
    if (!condition) errors.push(message);
  };

  add(catalog.schemaVersion === UI_SURFACE_SCHEMA_VERSION,
    `schemaVersion must be ${UI_SURFACE_SCHEMA_VERSION}`);
  add(catalog.catalogVersion === UI_SURFACE_CATALOG_VERSION,
    `catalogVersion must be ${UI_SURFACE_CATALOG_VERSION}`);
  add(catalog.adapter === "mac-workbuddy", "adapter must be mac-workbuddy");
  add(catalog.adapterVersion === DEFAULT_VERSION,
    `adapterVersion must match the supported WorkBuddy ShortVersion ${DEFAULT_VERSION}`);
  add(catalog.adapterReleaseRevision === 1,
    "adapterReleaseRevision must be the current positive Adapter release revision");
  add(Boolean(catalog.target?.version), "target.version is required");
  add(catalog.capture?.visualStates >= 1, "capture.visualStates must be positive");
  add(catalog.capture?.computedStyleSnapshots >= 1, "capture.computedStyleSnapshots must be positive");
  add(catalog.capture?.rawScreenshotsCommitted === false, "raw screenshots must not be committed");

  const surfaceGroups = new Set(Object.keys(catalog.surfaces ?? {}));
  const hierarchyIds = (catalog.domHierarchy ?? []).map((node) => node.id);
  const runtimeRoleIds = (catalog.runtimeRoles ?? []).map((rule) => rule.role);
  const componentEvidenceIds = (catalog.componentStyleEvidence ?? []).map((evidence) => evidence.id);
  const pageIds = (catalog.pageFamilies ?? []).map((page) => page.id);
  const overlayIds = (catalog.overlayFamilies ?? []).map((overlay) => overlay.id);
  add(duplicateValues(hierarchyIds).length === 0, `duplicate DOM hierarchy ids: ${duplicateValues(hierarchyIds).join(", ")}`);
  add(duplicateValues(runtimeRoleIds).length === 0, `duplicate runtime roles: ${duplicateValues(runtimeRoleIds).join(", ")}`);
  add(duplicateValues(componentEvidenceIds).length === 0, `duplicate component evidence ids: ${duplicateValues(componentEvidenceIds).join(", ")}`);
  add(duplicateValues(pageIds).length === 0, `duplicate page ids: ${duplicateValues(pageIds).join(", ")}`);
  add(duplicateValues(overlayIds).length === 0, `duplicate overlay ids: ${duplicateValues(overlayIds).join(", ")}`);

  const hierarchyIdSet = new Set(hierarchyIds);
  for (const node of catalog.domHierarchy ?? []) {
    add(node.parent === null || hierarchyIdSet.has(node.parent), `DOM node ${node.id} references unknown parent ${node.parent}`);
    add(["one", "zero-or-one", "many"].includes(node.cardinality), `DOM node ${node.id} has invalid cardinality ${node.cardinality}`);
    add(["host", "skin-owned"].includes(node.ownership), `DOM node ${node.id} has invalid ownership ${node.ownership}`);
  }
  for (const rule of catalog.runtimeRoles ?? []) {
    add(Array.isArray(rule.selectors) && rule.selectors.length > 0, `runtime role ${rule.role} needs selectors`);
    add(["one", "zero-or-one", "many"].includes(rule.cardinality), `runtime role ${rule.role} has invalid cardinality ${rule.cardinality}`);
  }
  const interpreter = catalog.runtimeInterpreter ?? {};
  add(interpreter.kind === "skin.ui-interpreter-config", "runtimeInterpreter.kind is invalid");
  add(interpreter.version === UI_INTERPRETER_VERSION,
    `runtimeInterpreter.version must be ${UI_INTERPRETER_VERSION}`);
  add(interpreter.styleCatalogId === "mac-workbuddy-theme", "runtimeInterpreter.styleCatalogId is invalid");
  add(interpreter.roleAttribute === "data-workbuddy-skin-role", "runtimeInterpreter.roleAttribute is invalid");
  const localeAuthority = interpreter.localeAuthority ?? {};
  add(localeAuthority.id === "workbuddy-effective-locale", "runtimeInterpreter localeAuthority id is invalid");
  add(localeAuthority.storageKey === "CODEBUDDY_IDE_STORAGE_LANG",
    "runtimeInterpreter localeAuthority storage key is invalid");
  add(localeAuthority.bodyAttribute === "lang", "runtimeInterpreter localeAuthority body attribute is invalid");
  add(localeAuthority.defaultLocale === "zh-CN", "runtimeInterpreter localeAuthority default is invalid");
  add(localeAuthority.switchBehavior === "immediate", "runtimeInterpreter localeAuthority switch behavior is invalid");
  add(Array.isArray(localeAuthority.supportedLocales) &&
      localeAuthority.supportedLocales.join(",") === "zh-CN,en-US",
    "runtimeInterpreter localeAuthority must match WorkBuddy selectable locales");
  add(localeAuthority.evidence?.selectableApi === "getSupportedLocales" &&
      Array.isArray(localeAuthority.evidence?.storageValues) &&
      localeAuthority.evidence.storageValues.join(",") === localeAuthority.supportedLocales.join(","),
    "runtimeInterpreter localeAuthority evidence does not match its selectable locale declaration");
  add(Boolean(interpreter.identity?.bodyDataset?.applicationName), "runtimeInterpreter identity is required");
  add(interpreter.identity?.rendererPathSuffix === catalog.target?.rendererUrlContains,
    "runtimeInterpreter bootstrap renderer path must match the versioned target evidence");
  add(Array.isArray(interpreter.identity?.requiredSelectors) && interpreter.identity.requiredSelectors.length > 0,
    "runtimeInterpreter identity requires selectors");
  for (const [name, anchor] of Object.entries(interpreter.anchors ?? {})) {
    add(Array.isArray(anchor.selectors) && anchor.selectors.length > 0, `runtimeInterpreter anchor ${name} needs selectors`);
    add(["first", "last"].includes(anchor.selection), `runtimeInterpreter anchor ${name} has invalid selection`);
  }
  for (const [name, target] of Object.entries(interpreter.targets ?? {})) {
    add(Array.isArray(target.selectors) && target.selectors.length > 0, `runtimeInterpreter target ${name} needs selectors`);
    add(["one", "zero-or-one", "many"].includes(target.cardinality),
      `runtimeInterpreter target ${name} has invalid cardinality`);
  }
  for (const [name, mount] of Object.entries(interpreter.mounts ?? {})) {
    const knownNodes = new Set(["document"]);
    add(Array.isArray(mount.nodes) && mount.nodes.length > 0, `runtimeInterpreter mount ${name} needs nodes`);
    for (const node of mount.nodes ?? []) {
      add(typeof node.id === "string" && !knownNodes.has(node.id), `runtimeInterpreter mount ${name} has an invalid node id`);
      add(knownNodes.has(node.within), `runtimeInterpreter mount ${name}.${node.id} has an unknown parent`);
      add(Array.isArray(node.selectors) && node.selectors.length > 0, `runtimeInterpreter mount ${name}.${node.id} needs selectors`);
      add(["one", "zero-or-one", "many"].includes(node.cardinality),
        `runtimeInterpreter mount ${name}.${node.id} has invalid cardinality`);
      knownNodes.add(node.id);
    }
    for (const [slot, insertion] of Object.entries(mount.insertions ?? {})) {
      add(knownNodes.has(insertion.parent), `runtimeInterpreter mount ${name}.${slot} has an unknown insertion parent`);
      add(["append", "prepend", "before-last"].includes(insertion.mode),
        `runtimeInterpreter mount ${name}.${slot} has an invalid insertion mode`);
    }
    const nativeReference = mount.nativeReference;
    if (nativeReference !== undefined) {
      add(Boolean(mount.insertions?.[nativeReference.slot]),
        `runtimeInterpreter mount ${name} nativeReference has an unknown slot`);
      add(["before", "after"].includes(nativeReference.relative),
        `runtimeInterpreter mount ${name} nativeReference has an invalid relative position`);
      add(nativeReference.copyClass === true,
        `runtimeInterpreter mount ${name} nativeReference must copy the native class contract`);
      add(Array.isArray(nativeReference.copyAttributes) && nativeReference.copyAttributes.every((attribute) =>
        ["role", "tabindex"].includes(attribute)),
      `runtimeInterpreter mount ${name} nativeReference has unsafe attributes`);
    }
    for (const [property, classNames] of Object.entries(mount.presentation ?? {})) {
      add(typeof classNames === "string" && classNames.length <= 160 &&
        classNames.split(/\s+/).every((className) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(className)),
      `runtimeInterpreter mount ${name}.${property} has invalid class names`);
    }
  }
  for (const evidence of catalog.componentStyleEvidence ?? []) {
    add(Array.isArray(evidence.selectors) && evidence.selectors.length > 0, `component evidence ${evidence.id} needs selectors`);
    add(Boolean(evidence.adapterMismatch), `component evidence ${evidence.id} needs an adapterMismatch`);
    add(Array.isArray(evidence.resolutionRoles) && evidence.resolutionRoles.length > 0, `component evidence ${evidence.id} needs resolutionRoles`);
    for (const role of evidence.resolutionRoles ?? []) {
      add(runtimeRoleIds.includes(role), `component evidence ${evidence.id} references unknown role ${role}`);
    }
  }

  for (const page of catalog.pageFamilies ?? []) {
    add(surfaceGroups.has(page.family), `page ${page.id} references unknown surface family ${page.family}`);
    add(Array.isArray(page.rootSelectors) && page.rootSelectors.length > 0, `page ${page.id} needs rootSelectors`);
    add(Array.isArray(page.states) && page.states.length > 0, `page ${page.id} needs states`);
  }

  const radii = catalog.nativeVisualTokens?.radius ?? {};
  const shadows = catalog.nativeVisualTokens?.shadow ?? {};
  const scrims = catalog.nativeVisualTokens?.scrim ?? {};
  const blurs = catalog.nativeVisualTokens?.blur ?? {};
  for (const overlay of catalog.overlayFamilies ?? []) {
    add(Array.isArray(overlay.selectors) && overlay.selectors.length > 0, `overlay ${overlay.id} needs selectors`);
    add(Boolean(radii[overlay.radius]) || /px/.test(overlay.radius), `overlay ${overlay.id} has unknown radius ${overlay.radius}`);
    add(Boolean(shadows[overlay.shadow]), `overlay ${overlay.id} has unknown shadow ${overlay.shadow}`);
    if (overlay.scrim) add(Boolean(scrims[overlay.scrim]), `overlay ${overlay.id} has unknown scrim ${overlay.scrim}`);
    if (overlay.backdropFilter) {
      add(Boolean(blurs[overlay.backdropFilter]), `overlay ${overlay.id} has unknown blur ${overlay.backdropFilter}`);
    }
  }

  const selectorGroups = [
    ...(catalog.identitySelectors ?? []),
    ...(catalog.domHierarchy ?? []).map((node) => node.selector),
    ...(catalog.runtimeRoles ?? []).flatMap((rule) => rule.selectors ?? []),
    ...(catalog.runtimeInterpreter?.identity?.requiredSelectors ?? []),
    ...Object.values(catalog.runtimeInterpreter?.anchors ?? {}).flatMap((anchor) => [
      ...(anchor.withinSelectors ?? []),
      ...(anchor.selectors ?? []),
    ]),
    ...Object.values(catalog.runtimeInterpreter?.targets ?? {}).flatMap((target) => target.selectors ?? []),
    ...Object.values(catalog.runtimeInterpreter?.mounts ?? {}).flatMap((mount) =>
      (mount.nodes ?? []).flatMap((node) => node.selectors ?? [])),
    ...(catalog.componentStyleEvidence ?? []).flatMap((evidence) => evidence.selectors ?? []),
    ...Object.values(catalog.surfaces ?? {}).flat(),
    ...(catalog.pageFamilies ?? []).flatMap((page) => page.rootSelectors ?? []),
    ...(catalog.overlayFamilies ?? []).flatMap((overlay) => [
      ...(overlay.selectors ?? []),
      ...(overlay.anchorSelectors ?? []),
    ]),
  ];
  for (const selector of selectorGroups) {
    add(!generatedClassPattern.test(selector), `generated class is forbidden: ${selector}`);
  }

  return errors;
}

const escapeCell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");

const table = (headers, rows) => [
  `| ${headers.map(escapeCell).join(" | ")} |`,
  `| ${headers.map(() => "---").join(" | ")} |`,
  ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
].join("\n");

const tokenTable = (tokens) => table(
  ["Token", "Native value"],
  Object.entries(tokens).map(([name, value]) => [`\`${name}\``, `\`${value}\``]),
);

export function renderUiSurfaceCatalog(catalog) {
  const pages = table(
    ["Page id", "页面", "Family", "稳定根", "已采集状态"],
    catalog.pageFamilies.map((page) => [
      `\`${page.id}\``,
      page.title,
      `\`${page.family}\``,
      page.rootSelectors.map((selector) => `\`${selector}\``).join("<br>"),
      page.states.map((state) => `\`${state}\``).join(", "),
    ]),
  );

  const hierarchy = table(
    ["Node id", "Selector", "Parent", "Lifecycle", "Cardinality", "Ownership"],
    catalog.domHierarchy.map((node) => [
      `\`${node.id}\``,
      `\`${node.selector}\``,
      node.parent ? `\`${node.parent}\`` : "—",
      `\`${node.lifecycle}\``,
      `\`${node.cardinality}\``,
      `\`${node.ownership}\``,
    ]),
  );

  const runtimeRoles = table(
    ["Skin Surface Role", "Native selectors", "Cardinality"],
    catalog.runtimeRoles.map((rule) => [
      `\`${rule.role}\``,
      rule.selectors.map((selector) => `\`${selector}\``).join("<br>"),
      `\`${rule.cardinality}\``,
    ]),
  );

  const interpreterAnchors = table(
    ["Anchor", "Scope selectors", "Target selectors", "Selection"],
    Object.entries(catalog.runtimeInterpreter?.anchors ?? {}).map(([name, anchor]) => [
      `\`${name}\``,
      (anchor.withinSelectors ?? []).map((selector) => `\`${selector}\``).join("<br>") || "document",
      anchor.selectors.map((selector) => `\`${selector}\``).join("<br>"),
      `\`${anchor.selection}\``,
    ]),
  );

  const interpreterTargets = table(
    ["Target", "Selectors", "Cardinality"],
    Object.entries(catalog.runtimeInterpreter?.targets ?? {}).map(([name, target]) => [
      `\`${name}\``,
      target.selectors.map((selector) => `\`${selector}\``).join("<br>"),
      `\`${target.cardinality}\``,
    ]),
  );

  const interpreterMounts = table(
    ["Mount", "Node", "Within", "Selectors", "Cardinality"],
    Object.entries(catalog.runtimeInterpreter?.mounts ?? {}).flatMap(([mountName, mount]) =>
      mount.nodes.map((node) => [
        `\`${mountName}\``,
        `\`${node.id}\``,
        `\`${node.within}\``,
        node.selectors.map((selector) => `\`${selector}\``).join("<br>"),
        `\`${node.cardinality}\``,
      ])),
  );

  const interpreterNativeReferences = table(
    ["Mount", "Insertion slot", "Relative native item", "Class contract", "Copied attributes"],
    Object.entries(catalog.runtimeInterpreter?.mounts ?? {})
      .filter(([, mount]) => mount.nativeReference)
      .map(([mountName, mount]) => [
        `\`${mountName}\``,
        `\`${mount.nativeReference.slot}\``,
        `\`${mount.nativeReference.relative}\``,
        mount.nativeReference.copyClass ? "copy adjacent native class list" : "—",
        mount.nativeReference.copyAttributes.map((attribute) => `\`${attribute}\``).join("<br>") || "—",
      ]),
  );

  const componentEvidence = table(
    ["Evidence id", "Family", "稳定节点", "修复前计算样式", "适配偏差", "Resolution roles"],
    (catalog.componentStyleEvidence ?? []).map((evidence) => [
      `\`${evidence.id}\``,
      `\`${evidence.family}\``,
      evidence.selectors.map((selector) => `\`${selector}\``).join("<br>"),
      Object.entries(evidence.nativeComputed ?? {}).map(([name, value]) => `\`${name}: ${value}\``).join("<br>"),
      evidence.adapterMismatch,
      evidence.resolutionRoles.map((role) => `\`${role}\``).join("<br>"),
    ]),
  );

  const overlays = table(
    ["Overlay id", "类型", "稳定节点", "圆角", "阴影", "遮罩/模糊"],
    catalog.overlayFamilies.map((overlay) => [
      `\`${overlay.id}\``,
      overlay.kind,
      overlay.selectors.map((selector) => `\`${selector}\``).join("<br>"),
      `\`${overlay.radius}\``,
      `\`${overlay.shadow}\``,
      [overlay.scrim && `scrim: \`${overlay.scrim}\``, overlay.backdropFilter && `blur: \`${overlay.backdropFilter}\``]
        .filter(Boolean)
        .join("<br>") || "—",
    ]),
  );

  const surfaces = Object.entries(catalog.surfaces).map(([family, selectors]) => [
    `### ${family}`,
    "",
    ...selectors.map((selector) => `- \`${selector}\``),
  ].join("\n")).join("\n\n");

  return `# WorkBuddy UI Surface Catalog

> 此文件由 \`scripts/ui-surface-catalog.mjs\` 从版本化 JSON 生成。不要直接编辑。

## 采集基线

- WorkBuddy \`${catalog.target.version}\` / Electron \`${catalog.target.electron}\`
- Adapter: \`${catalog.adapter}\` \`${catalog.adapterVersion}\` release \`r${catalog.adapterReleaseRevision}\`
- 原生主题：\`${catalog.capture.theme}\`
- 可视状态：\`${catalog.capture.visualStates}\`
- 计算样式快照：\`${catalog.capture.computedStyleSnapshots}\`
- 原始截图不进入仓库；仅保存去隐私化的 DOM、token 和计算样式证据。

JSON 单一数据源：\`compatibility/workbuddy-macos/${catalog.target.version}/ui-surface-catalog.json\`。

## System 配色边界

- 作用范围：${catalog.systemPalettePolicy.scope}
- 弹窗外观保持原生：\`${catalog.systemPalettePolicy.nativeOverlayAppearance}\`
- 受保护属性：${catalog.systemPalettePolicy.protectedOverlayProperties.map((property) => `\`${property}\``).join("、")}
- 允许接管弹窗外观的策略：${catalog.systemPalettePolicy.themedOverlayStrategies.map((strategy) => `\`${strategy}\``).join("、")}

## DOM 层级

${hierarchy}

## 页面与状态

${pages}

## 运行时 Skin Surface Roles

${runtimeRoles}

## UI Interpreter 配置

- Kind: \`${catalog.runtimeInterpreter.kind}\` / version \`${catalog.runtimeInterpreter.version}\`
- Style Catalog: \`${catalog.runtimeInterpreter.styleCatalogId}\`
- Role attribute: \`${catalog.runtimeInterpreter.roleAttribute}\`

### Host Locale Authority

- Authority: \`${catalog.runtimeInterpreter.localeAuthority.id}\`
- Selectable locales: ${catalog.runtimeInterpreter.localeAuthority.supportedLocales.map((locale) => `\`${locale}\``).join(" / ")}
- Effective storage: \`${catalog.runtimeInterpreter.localeAuthority.storageKey}\`
- Immediate signal: \`body[${catalog.runtimeInterpreter.localeAuthority.bodyAttribute}]\`
- Fallback: \`${catalog.runtimeInterpreter.localeAuthority.defaultLocale}\`
- Evidence: \`${catalog.runtimeInterpreter.localeAuthority.evidence.module}\` → \`${catalog.runtimeInterpreter.localeAuthority.evidence.selectableApi}\`
- Privacy: ${catalog.runtimeInterpreter.localeAuthority.evidence.privacy}

### 锚点

${interpreterAnchors}

### 动态目标

${interpreterTargets}

### 挂载节点

${interpreterMounts}

### 相邻原生条目同构契约

${interpreterNativeReferences}

## 组件级样式证据

${componentEvidence}

## 弹层分类

${overlays}

## 原生背景 token

${tokenTable(catalog.nativeVisualTokens.background)}

## 原生边框 token

${tokenTable(catalog.nativeVisualTokens.border)}

## 原生圆角 token

${tokenTable(catalog.nativeVisualTokens.radius)}

## 原生阴影 token

${tokenTable(catalog.nativeVisualTokens.shadow)}

## DOM Surface 分组

${surfaces}

## 结构匹配角色

${Object.entries(catalog.structuralRoles).map(([role, rule]) => `- \`${role}\`：${rule.match}。原因：${rule.reason}。`).join("\n")}

## 选择器规则

优先：

${catalog.selectorPolicy.preferred.map((rule) => `- ${rule}`).join("\n")}

禁止：

${catalog.selectorPolicy.forbidden.map((rule) => `- ${rule}`).join("\n")}

## 预设约束

${catalog.presetRules.map((rule) => `- ${rule}`).join("\n")}
`;
}

export async function checkCatalogDocument(catalog) {
  const expected = renderUiSurfaceCatalog(catalog);
  const actual = await fs.readFile(catalogDocumentPath, "utf8");
  assert.equal(actual, expected, "UI-SURFACE-CATALOG.md is out of date; run the catalog writer");
}

async function main() {
  const command = process.argv[2] ?? "--check";
  const catalog = await loadUiSurfaceCatalog(process.argv[3] ?? DEFAULT_VERSION);
  const errors = validateUiSurfaceCatalog(catalog);
  if (errors.length) throw new Error(`Invalid UI Surface Catalog:\n- ${errors.join("\n- ")}`);
  if (command === "--write") {
    await fs.writeFile(catalogDocumentPath, renderUiSurfaceCatalog(catalog));
    process.stdout.write(`${catalogDocumentPath}\n`);
    return;
  }
  if (command !== "--check") throw new Error(`Unknown command: ${command}`);
  await checkCatalogDocument(catalog);
  process.stdout.write("ui-surface-catalog: ok\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
