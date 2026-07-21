import fs from "node:fs/promises";
import path from "node:path";

export const LIVE_SURFACE_EVIDENCE_KIND = "cc-theme.live-surface-evidence";
export const LIVE_SURFACE_EVIDENCE_REVISION = 1;
export const MAX_EVIDENCE_NODES = 512;

const SIMPLE_TOKEN = /^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/;
const ENUM_STATE = new Set(["true", "false", "mixed", "open", "closed", "active", "inactive", "on", "off", "checked", "unchecked"]);
const FORBIDDEN_KEYS = /(?:text|value|label|name|title|url|href|src|query|hash|action|content|placeholder|media)/i;

export function sanitizeStableToken(value) {
  if (typeof value !== "string" || !SIMPLE_TOKEN.test(value)) return null;
  if (/[0-9a-f]{12,}/i.test(value) || /\d{8,}/.test(value) || /[0-9a-f]{8}-[0-9a-f-]{20,}/i.test(value)) return null;
  return value;
}

export function sanitizeClassTokens(value) {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(/\s+/).map(sanitizeStableToken).filter(Boolean))].slice(0, 24);
}

function finiteNumber(value, minimum = -100000, maximum = 100000) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? Math.round(number * 100) / 100 : 0;
}

function safeStyle(value) {
  return typeof value === "string" && value.length <= 96 && !/url\s*\(|data:|blob:|https?:/i.test(value) ? value : "";
}

export function normalizeSurfaceEvidence(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const rawNodes = Array.isArray(source.nodes) ? source.nodes.slice(0, MAX_EVIDENCE_NODES) : [];
  const nodes = rawNodes.map((node, index) => {
    const state = {};
    for (const key of ["expanded", "selected", "pressed", "checked", "disabled", "open"]) {
      const value = node?.state?.[key];
      if (typeof value === "boolean" || ENUM_STATE.has(value)) state[key] = value;
    }
    const computed = {};
    for (const key of ["display", "visibility", "position", "opacity", "backgroundColor", "color", "borderColor", "borderRadius", "boxShadow"]) {
      const value = safeStyle(node?.computed?.[key]);
      if (value) computed[key] = value;
    }
    const stable = {};
    for (const key of ["role", "skinRole", "testId", "dataState"]) {
      const value = key === "dataState" && ENUM_STATE.has(node?.stable?.[key])
        ? node.stable[key] : sanitizeStableToken(node?.stable?.[key]);
      if (value) stable[key] = value;
    }
    return {
      index,
      tag: sanitizeStableToken(String(node?.tag ?? "").toLowerCase()) ?? "unknown",
      classes: sanitizeClassTokens(Array.isArray(node?.classes) ? node.classes.join(" ") : node?.classes),
      stable,
      state,
      parentIndex: Number.isInteger(node?.parentIndex) && node.parentIndex >= 0 && node.parentIndex < rawNodes.length ? node.parentIndex : null,
      elementChildCount: Math.max(0, Math.min(4096, Number.isInteger(node?.elementChildCount) ? node.elementChildCount : 0)),
      rect: {
        x: finiteNumber(node?.rect?.x),
        y: finiteNumber(node?.rect?.y),
        width: finiteNumber(node?.rect?.width, 0),
        height: finiteNumber(node?.rect?.height, 0),
      },
      visible: Boolean(node?.visible),
      computed,
    };
  });
  const landmarkSource = source.landmarks && typeof source.landmarks === "object" ? source.landmarks : {};
  const landmarks = {};
  for (const key of ["shell", "sidebar", "main", "composer", "settings", "overlay", "themeOwnedRoot"]) landmarks[key] = Boolean(landmarkSource[key]);
  return {
    kind: LIVE_SURFACE_EVIDENCE_KIND,
    revision: LIVE_SURFACE_EVIDENCE_REVISION,
    privacyPolicy: "structural-only-v1",
    viewport: {
      width: finiteNumber(source.viewport?.width, 0, 32768),
      height: finiteNumber(source.viewport?.height, 0, 32768),
      deviceScaleFactor: finiteNumber(source.viewport?.deviceScaleFactor, 0.1, 16),
      hidden: Boolean(source.viewport?.hidden),
      reducedMotion: Boolean(source.viewport?.reducedMotion),
    },
    landmarks,
    counts: {
      considered: Math.max(nodes.length, Math.min(100000, Number.isInteger(source.counts?.considered) ? source.counts.considered : nodes.length)),
      captured: nodes.length,
      truncated: Boolean(source.counts?.truncated || rawNodes.length >= MAX_EVIDENCE_NODES),
    },
    nodes,
  };
}

export function assertSurfaceEvidencePrivacy(evidence) {
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.test(key) && key !== "privacyPolicy") throw new Error(`Live Surface Evidence contains forbidden field: ${key}`);
      if (typeof item === "string" && /(?:https?:\/\/|app:\/\/|file:\/\/|data:|blob:)/i.test(item)) {
        throw new Error("Live Surface Evidence contains a URL or media source");
      }
      walk(item);
    }
  };
  walk(evidence);
  return evidence;
}

export function buildSurfaceEvidenceExpression() {
  return `(() => {
    const maximum = ${MAX_EVIDENCE_NODES};
    const simple = ${SIMPLE_TOKEN.toString()};
    const dynamic = /[0-9a-f]{12,}|\\d{8,}|[0-9a-f]{8}-[0-9a-f-]{20,}/i;
    const stableToken = (value) => typeof value === 'string' && simple.test(value) && !dynamic.test(value) ? value : null;
    const classes = (node) => [...new Set([...node.classList].map(stableToken).filter(Boolean))].slice(0, 24);
    const priorityCandidates = [...document.querySelectorAll(
      'dialog,[role="dialog"],[role="menu"],[role="menuitem"],[role="listbox"],[role="tooltip"],' +
      '[data-radix-popper-content-wrapper],[data-settings-panel-slug],[data-skin-role]'
    )];
    const candidates = [...new Set([
      ...priorityCandidates,
      ...document.querySelectorAll('main,aside,header,nav,footer,dialog,button,input,textarea,select,[role],[data-testid],[data-skin-role]'),
    ])];
    const selected = candidates.slice(0, maximum);
    const index = new Map(selected.map((node, position) => [node, position]));
    const stateValue = (node, attribute) => {
      const value = node.getAttribute(attribute);
      return ['true','false','mixed','open','closed','active','inactive','on','off','checked','unchecked'].includes(value) ? value : null;
    };
    const nodes = selected.map((node, position) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const parent = node.parentElement;
      const computed = {
        display: style.display, visibility: style.visibility, position: style.position,
        opacity: style.opacity, backgroundColor: style.backgroundColor, color: style.color,
        borderColor: style.borderColor, borderRadius: style.borderRadius, boxShadow: style.boxShadow,
      };
      return {
        index: position,
        tag: node.tagName.toLowerCase(),
        classes: classes(node),
        stable: {
          role: stableToken(node.getAttribute('role')),
          skinRole: stableToken(node.getAttribute('data-skin-role')),
          testId: stableToken(node.getAttribute('data-testid')),
          dataState: stateValue(node, 'data-state'),
        },
        state: {
          expanded: stateValue(node, 'aria-expanded'), selected: stateValue(node, 'aria-selected'),
          pressed: stateValue(node, 'aria-pressed'), checked: stateValue(node, 'aria-checked'),
          disabled: Boolean(node.disabled || node.hasAttribute('disabled')),
          open: Boolean(node.open || node.hasAttribute('open')),
        },
        parentIndex: index.has(parent) ? index.get(parent) : null,
        elementChildCount: node.childElementCount,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
        computed,
      };
    });
    return {
      viewport: {
        width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio,
        hidden: document.hidden, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      },
      landmarks: {
        shell: Boolean(document.querySelector('main.main-surface')),
        sidebar: Boolean(document.querySelector('aside.app-shell-left-panel')),
        main: Boolean(document.querySelector('[role="main"]')),
        composer: Boolean(document.querySelector('.composer-surface-chrome')),
        settings: Boolean(document.querySelector('[data-settings-panel-slug],[data-skin-role="settings-shell"]')),
        overlay: Boolean(document.querySelector('dialog,[role="dialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]')),
        themeOwnedRoot: Boolean(document.documentElement.classList.contains('cc-theme')),
      },
      counts: { considered: candidates.length, captured: nodes.length, truncated: candidates.length > maximum },
      nodes,
    };
  })()`;
}

export async function writeSurfaceEvidence(file, evidence) {
  const checked = assertSurfaceEvidencePrivacy(evidence);
  const target = path.resolve(file);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    const current = await fs.lstat(target);
    if (current.isSymbolicLink() || !current.isFile()) throw new Error("Evidence output must be a regular file");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(checked, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, target);
    await fs.chmod(target, 0o600);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
  return target;
}
