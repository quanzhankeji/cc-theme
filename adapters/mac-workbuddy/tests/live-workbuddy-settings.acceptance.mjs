import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

if (process.env.WORKBUDDY_LIVE_ACCEPTANCE !== "1") {
  console.log("SKIP: set WORKBUDDY_LIVE_ACCEPTANCE=1 for the local WorkBuddy WYSIWYG acceptance.");
  process.exit(0);
}

const execFile = promisify(execFileCallback);
const port = Number(process.env.WORKBUDDY_REMOTE_DEBUGGING_PORT || 9342);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP WebSocket failed")), { once: true });
    });
    return new Cdp(socket);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "Runtime evaluation failed");
    return result.result.value;
  }

  close() { this.socket.close(); }
}

async function openSettings() {
  await execFile("/usr/bin/osascript", [
    "-e", "tell application \"WorkBuddy\" to activate",
    "-e", "delay 0.2",
    "-e", "tell application \"System Events\" to keystroke \",\" using command down",
  ]);
}

async function waitFor(client, expression, message, attempts = 80) {
  for (let index = 0; index < attempts; index += 1) {
    const value = await client.evaluate(expression).catch(() => null);
    if (value) return value;
    await delay(100);
  }
  assert.fail(message);
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = targets.find((item) => {
  if (item.type !== "page" || !item.webSocketDebuggerUrl) return false;
  try {
    return decodeURIComponent(new URL(item.url).pathname).endsWith("/Contents/Resources/app.asar/renderer/index.html");
  } catch {
    return false;
  }
});
assert(target, "verified WorkBuddy renderer target was not found");
const client = await Cdp.connect(target.webSocketDebuggerUrl);

try {
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await client.send("Emulation.setEmulatedMedia", { features: [] });
  if (!await client.evaluate("Boolean(document.querySelector('.settings-modal'))")) await openSettings();
  await waitFor(client, "Boolean(document.getElementById('workbuddy-cc-theme-settings-nav'))",
    "CC-Theme Settings navigation did not mount");
  await client.evaluate("document.getElementById('workbuddy-cc-theme-settings-nav').click(); true");
  await waitFor(client, "Boolean(document.getElementById('workbuddy-cc-theme-settings-panel')?.hidden === false)",
    "CC-Theme Settings panel did not become active");

  const original = await client.evaluate(`(() => {
    const state = window.__WORKBUDDY_SKIN_STATE__;
    const nav = document.getElementById('workbuddy-cc-theme-settings-nav');
    const native = nav?.previousElementSibling;
    const rect = (node) => { const value = node.getBoundingClientRect(); return { width: value.width, height: value.height }; };
    const style = (node) => { const value = getComputedStyle(node); return {
      fontFamily: value.fontFamily, fontSize: value.fontSize, lineHeight: value.lineHeight,
      paddingInlineStart: value.paddingInlineStart, paddingInlineEnd: value.paddingInlineEnd,
      borderRadius: value.borderRadius,
    }; };
    return {
      settings: state.inspect().themeSettings,
      bodyDark: document.body.classList.contains('dark'),
      navOwned: nav?.dataset.workbuddySkinOwned === 'true',
      nativeExists: Boolean(native),
      commonClass: [...nav.classList].some((name) => native.classList.contains(name)),
      nativeRole: native?.getAttribute('role'), navRole: nav?.getAttribute('role'),
      nativeTabIndex: native?.getAttribute('tabindex'), navTabIndex: nav?.getAttribute('tabindex'),
      navRect: rect(nav), nativeRect: rect(native), navStyle: style(nav), nativeStyle: style(native),
      active: nav.classList.contains('settings-navigation__item--active'),
    };
  })()`);
  assert(original.navOwned && original.nativeExists && original.commonClass && original.active);
  assert(Math.abs(original.navRect.height - original.nativeRect.height) < 1);
  assert(Math.abs(original.navRect.width - original.nativeRect.width) < 1);
  assert.equal(original.navStyle.fontFamily, original.nativeStyle.fontFamily);
  assert.equal(original.navStyle.fontSize, original.nativeStyle.fontSize);
  assert.equal(original.navStyle.lineHeight, original.nativeStyle.lineHeight);
  assert.equal(original.navStyle.paddingInlineStart, original.nativeStyle.paddingInlineStart);
  assert.equal(original.navStyle.paddingInlineEnd, original.nativeStyle.paddingInlineEnd);
  assert.equal(original.navRole, original.nativeRole);
  assert.equal(original.navTabIndex, original.nativeTabIndex);

  const interactionPoints = await client.evaluate(`(() => {
    const nav = document.getElementById('workbuddy-cc-theme-settings-nav');
    nav.previousElementSibling.click();
    const sample = [...nav.parentElement.children].find((node) => node !== nav &&
      node.matches('button') && !node.classList.contains('settings-navigation__item--active'));
    sample.dataset.workbuddyAcceptanceSample = 'true';
    const center = (node) => { const rect = node.getBoundingClientRect(); return {
      x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
    }; };
    const previousZoom = document.body.style.zoom;
    document.body.style.zoom = '1.25';
    const zoomDelta = Math.abs(nav.getBoundingClientRect().height - sample.getBoundingClientRect().height);
    document.body.style.zoom = previousZoom;
    return { nav: center(nav), sample: center(sample), zoomDelta };
  })()`);
  assert(interactionPoints.zoomDelta < 1, "CC-Theme diverged from a native entry under 125% zoom");
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...interactionPoints.sample });
  assert.equal(await client.evaluate("document.querySelector('[data-workbuddy-acceptance-sample]')?.matches(':hover')"), true);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...interactionPoints.sample });
  assert.equal(await client.evaluate("document.querySelector('[data-workbuddy-acceptance-sample]')?.matches(':active')"), true);
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...interactionPoints.sample });
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...interactionPoints.nav });
  assert.equal(await client.evaluate("document.getElementById('workbuddy-cc-theme-settings-nav')?.matches(':hover')"), true);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...interactionPoints.nav });
  assert.equal(await client.evaluate("document.getElementById('workbuddy-cc-theme-settings-nav')?.matches(':active')"), true);
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...interactionPoints.nav });
  const focusAndSelected = await client.evaluate(`(() => {
    const nav = document.getElementById('workbuddy-cc-theme-settings-nav');
    nav.focus();
    const result = { focus: document.activeElement === nav,
      selected: nav.classList.contains('settings-navigation__item--active') };
    document.querySelector('[data-workbuddy-acceptance-sample]')?.removeAttribute('data-workbuddy-acceptance-sample');
    return result;
  })()`);
  assert.deepEqual(focusAndSelected, { focus: true, selected: true });

  const palettePreview = await client.evaluate(`(() => {
    const select = document.querySelector('[data-cc-theme-palette-strategy]');
    select.value = 'custom';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const inspected = window.__WORKBUDDY_SKIN_STATE__.inspect();
    return { palette: document.documentElement.dataset.workbuddySkinPalette,
      draft: inspected.themeSettings.draft.paletteStrategy };
  })()`);
  assert.deepEqual(palettePreview, { palette: "custom", draft: "custom" });
  await waitFor(client, `window.__WORKBUDDY_SKIN_STATE__?.inspect?.().themeSettings?.committed?.paletteStrategy === 'custom'`,
    "palette strategy was not persisted");

  const colorPreview = await client.evaluate(`(() => {
    const input = document.querySelector('[data-cc-theme-control="interaction.accent"]');
    input.value = '#2468ac';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const inspected = window.__WORKBUDDY_SKIN_STATE__.inspect();
    return { draft: inspected.themeSettings.draft.values['interaction.accent'],
      css: getComputedStyle(document.documentElement).getPropertyValue('--wbs-accent').trim() };
  })()`);
  assert.equal(colorPreview.draft, "#2468ac");
  assert.equal(colorPreview.css.toLowerCase(), "#2468ac");

  const textColorPair = await client.evaluate(`(() => {
    const input = document.querySelector('[data-cc-theme-control="text.primary"]');
    const picker = document.querySelector('[data-cc-theme-color-picker="text.primary"]');
    picker.value = '#13579b';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    const afterPicker = {
      input: input.value,
      picker: picker.value,
      draft: window.__WORKBUDDY_SKIN_STATE__.inspect().themeSettings.draft.values['text.primary'],
      css: getComputedStyle(document.documentElement).getPropertyValue('--wbs-text').trim(),
    };
    input.value = 'rgb(12, 34, 56)';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const afterText = {
      input: input.value,
      picker: picker.value,
      draft: window.__WORKBUDDY_SKIN_STATE__.inspect().themeSettings.draft.values['text.primary'],
      css: getComputedStyle(document.documentElement).getPropertyValue('--wbs-text').trim(),
    };
    input.value = '#12';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const invalid = {
      draft: window.__WORKBUDDY_SKIN_STATE__.inspect().themeSettings.draft.values['text.primary'],
      ariaInvalid: input.getAttribute('aria-invalid'),
      errorHidden: input.parentElement.querySelector('[data-cc-theme-field-error]').hidden,
    };
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return {
      afterPicker, afterText, invalid,
      restored: { input: input.value, picker: picker.value, ariaInvalid: input.hasAttribute('aria-invalid') },
    };
  })()`);
  assert.deepEqual(textColorPair.afterPicker,
    { input: "#13579b", picker: "#13579b", draft: "#13579b", css: "#13579b" });
  assert.deepEqual(textColorPair.afterText,
    { input: "rgb(12, 34, 56)", picker: "#0c2238", draft: "rgb(12, 34, 56)", css: "rgb(12, 34, 56)" });
  assert.deepEqual(textColorPair.invalid,
    { draft: "rgb(12, 34, 56)", ariaInvalid: "true", errorHidden: false });
  assert.deepEqual(textColorPair.restored,
    { input: "rgb(12, 34, 56)", picker: "#0c2238", ariaInvalid: false });

  const backgroundPosition = await client.evaluate(`(() => {
    const group = document.querySelector('[data-cc-theme-position-control="media.backgroundPosition"]');
    const x = group.querySelector('[data-cc-theme-position-axis="xPercent"]');
    const y = group.querySelector('[data-cc-theme-position-axis="yPercent"]');
    x.value = '23'; x.dispatchEvent(new Event('input', { bubbles: true }));
    y.value = '67'; y.dispatchEvent(new Event('input', { bubbles: true }));
    const values = window.__WORKBUDDY_SKIN_STATE__.inspect().themeSettings.draft.values;
    return {
      value: values['media.backgroundPosition'],
      types: [x.type, y.type],
      outputs: [...group.querySelectorAll('[data-cc-theme-position-output]')].map((node) => node.textContent),
      x: getComputedStyle(document.documentElement).getPropertyValue('--wbs-background-x').trim(),
      y: getComputedStyle(document.documentElement).getPropertyValue('--wbs-background-y').trim(),
      art: getComputedStyle(document.getElementById('workbuddy-skin-background-art')).objectPosition,
      video: getComputedStyle(document.getElementById('workbuddy-skin-background-video')).objectPosition,
      obsolete: ['media.radiusScale', 'media.artX', 'media.artY', 'media.videoX', 'media.videoY']
        .some((id) => document.querySelector('[data-cc-theme-control="' + id + '"]')),
    };
  })()`);
  assert.deepEqual(backgroundPosition.value, { xPercent: 23, yPercent: 67 });
  assert.deepEqual(backgroundPosition.types, ["range", "range"]);
  assert.deepEqual(backgroundPosition.outputs, ["23%", "67%"]);
  assert.equal(backgroundPosition.x, "23%");
  assert.equal(backgroundPosition.y, "67%");
  assert.equal(backgroundPosition.art, backgroundPosition.video);
  assert.equal(backgroundPosition.obsolete, false);

  const rapid = await client.evaluate(`(() => {
    const blur = document.querySelector('[data-cc-theme-control="media.blur"]');
    for (const value of ['5', '9', '13']) { blur.value = value; blur.dispatchEvent(new Event('input', { bubbles: true })); }
    const font = document.querySelector('[data-cc-theme-control="typography.ui"]');
    font.value = 'Arial, sans-serif';
    font.dispatchEvent(new Event('input', { bubbles: true }));
    const inspected = window.__WORKBUDDY_SKIN_STATE__.inspect();
    return { blur: inspected.themeSettings.draft.values['media.blur'],
      font: inspected.themeSettings.draft.values['typography.ui'],
      cssBlur: getComputedStyle(document.documentElement).getPropertyValue('--wbs-blur').trim() };
  })()`);
  assert.equal(rapid.blur, 13);
  assert.deepEqual(rapid.font, ["Arial", "sans-serif"]);
  assert.equal(rapid.cssBlur, "13px");
  await waitFor(client, `(() => { const value = window.__WORKBUDDY_SKIN_STATE__?.inspect?.().themeSettings?.committed;
    return value?.values?.['interaction.accent'] === '#2468ac' && value?.values?.['media.blur'] === 13 &&
      value?.values?.['typography.ui']?.[0] === 'Arial' &&
      value?.values?.['text.primary'] === 'rgb(12, 34, 56)' &&
      value?.values?.['media.backgroundPosition']?.xPercent === 23 &&
      value?.values?.['media.backgroundPosition']?.yPercent === 67; })()`, "rapid cross-control state was not persisted");

  const localeAuthority = await client.evaluate(`(() => ({
    storage: localStorage.getItem('CODEBUDDY_IDE_STORAGE_LANG'),
    body: document.body.getAttribute('lang'),
  }))()`);
  for (const [locale, expectedLabel] of [['en-US', 'Background position'], ['zh-CN', '背景位置']]) {
    await client.evaluate(`(() => {
      localStorage.setItem('CODEBUDDY_IDE_STORAGE_LANG', ${JSON.stringify(locale)});
      document.body.setAttribute('lang', ${JSON.stringify(locale)});
      return true;
    })()`);
    await waitFor(client, `document.getElementById('workbuddy-cc-theme-settings-panel')?.lang === ${JSON.stringify(locale)}`,
      `CC Theme did not follow WorkBuddy locale ${locale}`);
    const localized = await client.evaluate(`(() => {
      const group = document.querySelector('[data-cc-theme-position-control="media.backgroundPosition"]');
      const panel = document.getElementById('workbuddy-cc-theme-settings-panel');
      return {
        label: group?.parentElement?.firstElementChild?.textContent,
        navCount: document.querySelectorAll('#workbuddy-cc-theme-settings-nav').length,
        panelCount: document.querySelectorAll('#workbuddy-cc-theme-settings-panel').length,
        draftText: window.__WORKBUDDY_SKIN_STATE__.inspect().themeSettings.draft.values['text.primary'],
        draftPosition: window.__WORKBUDDY_SKIN_STATE__.inspect().themeSettings.draft.values['media.backgroundPosition'],
      };
    })()`);
    assert.equal(localized.label, expectedLabel);
    assert.deepEqual({ navCount: localized.navCount, panelCount: localized.panelCount }, { navCount: 1, panelCount: 1 });
    assert.equal(localized.draftText, "rgb(12, 34, 56)");
    assert.deepEqual(localized.draftPosition, { xPercent: 23, yPercent: 67 });
  }
  await waitFor(client, `window.__WORKBUDDY_SKIN_STATE__?.inspect?.().themeSettings?.pending === false`,
    "settings write did not settle after live locale switching");
  await client.evaluate(`(() => {
    const previousStorage = ${JSON.stringify(localeAuthority.storage)};
    if (previousStorage === null) localStorage.removeItem('CODEBUDDY_IDE_STORAGE_LANG');
    else localStorage.setItem('CODEBUDDY_IDE_STORAGE_LANG', previousStorage);
    const previousBody = ${JSON.stringify(localeAuthority.body)};
    if (previousBody === null) document.body.removeAttribute('lang');
    else document.body.setAttribute('lang', previousBody);
    return true;
  })()`);
  await waitFor(client, `document.getElementById('workbuddy-cc-theme-settings-panel')?.lang ===
    ${JSON.stringify(localeAuthority.storage || localeAuthority.body || "zh-CN")}`, "original WorkBuddy locale was not restored");

  const navigation = await client.evaluate(`(() => {
    const nav = document.getElementById('workbuddy-cc-theme-settings-nav');
    nav.previousElementSibling.click();
    const left = { panelHidden: document.getElementById('workbuddy-cc-theme-settings-panel').hidden };
    nav.click();
    const input = document.querySelector('[data-cc-theme-control="media.blur"]');
    return { ...left, returned: !document.getElementById('workbuddy-cc-theme-settings-panel').hidden,
      value: input.value };
  })()`);
  assert.equal(navigation.panelHidden, true);
  assert.equal(navigation.returned, true);
  assert.equal(navigation.value, "13");

  const invalid = await client.evaluate(`(() => {
    const input = document.querySelector('[data-cc-theme-control="typography.ui"]');
    const before = input.value;
    input.value = '😀';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const inspected = window.__WORKBUDDY_SKIN_STATE__.inspect();
    return { before, after: input.value, committed: inspected.themeSettings.committed.values['typography.ui'],
      lastError: Boolean(inspected.themeSettings.lastError),
      status: document.querySelector('[data-cc-theme-status]')?.dataset.state };
  })()`);
  assert.equal(invalid.after, invalid.before);
  assert.deepEqual(invalid.committed, ["Arial", "sans-serif"]);
  assert.equal(invalid.lastError, true);
  assert.equal(invalid.status, "error");

  if (!original.bodyDark) {
    await client.evaluate(`(() => { const select = document.querySelector('[data-cc-theme-palette-strategy]');
      select.value = 'system'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitFor(client, `window.__WORKBUDDY_SKIN_STATE__?.inspect?.().themeSettings?.committed?.paletteStrategy === 'system'`,
      "system palette was not persisted before appearance testing");
    await client.evaluate("document.body.classList.add('dark'); true");
    await waitFor(client, `window.__WORKBUDDY_SKIN_STATE__?.inspect?.().nativeShellMode === 'dark'`, "dark mode did not reconcile");
    const dark = await client.evaluate(`(() => { const nav = document.getElementById('workbuddy-cc-theme-settings-nav');
      const native = nav.previousElementSibling; const a = getComputedStyle(nav); const b = getComputedStyle(native);
      return { color: getComputedStyle(document.documentElement).getPropertyValue('--wbs-text').trim(),
        height: nav.getBoundingClientRect().height - native.getBoundingClientRect().height,
        font: a.fontFamily === b.fontFamily && a.fontSize === b.fontSize && a.lineHeight === b.lineHeight }; })()`);
    assert.equal(typeof dark.color, "string");
    assert(Math.abs(dark.height) < 1);
    assert.equal(dark.font, true);
    await client.evaluate("document.body.classList.remove('dark'); true");
    await waitFor(client, `window.__WORKBUDDY_SKIN_STATE__?.inspect?.().nativeShellMode === 'light'`, "light mode was not restored");
    await client.evaluate(`(() => { const select = document.querySelector('[data-cc-theme-palette-strategy]');
      select.value = 'custom'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitFor(client, `window.__WORKBUDDY_SKIN_STATE__?.inspect?.().themeSettings?.committed?.paletteStrategy === 'custom'`,
      "custom palette was not restored after appearance testing");
  }

  await client.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await waitFor(client, `matchMedia('(prefers-reduced-motion: reduce)').matches === true`, "Reduce Motion emulation failed");
  await waitFor(client, `document.getElementById('workbuddy-skin-background-video')?.dataset.playbackState === 'reduced-motion'`,
    "video runtime did not reconcile Reduce Motion");
  const reducedRevision = await client.evaluate("window.__WORKBUDDY_SKIN_STATE__?.inspect?.().revision");
  assert.match(reducedRevision, /^[a-f0-9]{20}$/, "renderer revision marker is missing");
  if (process.env.WORKBUDDY_EXPECTED_RENDERER_REVISION) {
    assert.equal(reducedRevision, process.env.WORKBUDDY_EXPECTED_RENDERER_REVISION,
      "renderer did not refresh to the expected playback-state-machine revision");
  }
  await delay(500);
  const reduced = await client.evaluate(`(() => { const video = document.getElementById('workbuddy-skin-background-video');
    return { state: video?.dataset.playbackState, rootState: document.documentElement.dataset.workbuddySkinVideoState,
      paused: video?.paused, display: video ? getComputedStyle(video).display : null }; })()`);
  assert.equal(reduced.state, "reduced-motion");
  assert.equal(reduced.rootState, "reduced-motion");
  assert.equal(reduced.paused, true);
  assert.equal(reduced.display, "none");
  await client.send("Emulation.setEmulatedMedia", { features: [] });

  await client.send("Page.reload", { ignoreCache: true });
  await delay(800);
  await waitFor(client, `window.__WORKBUDDY_SKIN_STATE__?.inspect?.().themeSettings?.committed?.values?.['media.blur'] === 13`,
    "renderer reload did not recover persisted WYSIWYG state", 120);
  const reloaded = await client.evaluate(`(() => { const value = window.__WORKBUDDY_SKIN_STATE__.inspect(); return {
    palette: value.themeSettings.committed.paletteStrategy,
    accent: value.themeSettings.committed.values['interaction.accent'],
    text: value.themeSettings.committed.values['text.primary'],
    position: value.themeSettings.committed.values['media.backgroundPosition'],
    blur: value.themeSettings.committed.values['media.blur'],
    font: value.themeSettings.committed.values['typography.ui'] } })()`);
  assert.deepEqual(reloaded, {
    palette: "custom", accent: "#2468ac", text: "rgb(12, 34, 56)",
    position: { xPercent: 23, yPercent: 67 }, blur: 13, font: ["Arial", "sans-serif"],
  });

  if (!await client.evaluate("Boolean(document.querySelector('.settings-modal'))")) await openSettings();
  await waitFor(client, "Boolean(document.getElementById('workbuddy-cc-theme-settings-nav'))", "Settings did not remount after reload");
  await client.evaluate(`(() => {
    document.getElementById('workbuddy-cc-theme-settings-nav').click();
    for (const id of ['interaction.accent', 'text.primary', 'media.blur', 'typography.ui']) {
      document.querySelector('[data-cc-theme-control="' + id + '"]')?.parentElement?.querySelector('button')?.click();
    }
    document.querySelector('[data-cc-theme-position-control="media.backgroundPosition"]')
      ?.querySelector('button')?.click();
    const palette = document.querySelector('[data-cc-theme-palette-strategy]');
    palette.value = 'system';
    palette.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, `(() => { const value = window.__WORKBUDDY_SKIN_STATE__?.inspect?.().themeSettings?.committed;
    return value?.paletteStrategy === 'system' && !('interaction.accent' in value.values) &&
      !('text.primary' in value.values) && !('media.backgroundPosition' in value.values) &&
      !('media.blur' in value.values) && !('typography.ui' in value.values); })()`, "original runtime settings were not restored");

  const stableReconcile = await client.evaluate(`(async () => {
    const before = window.__WORKBUDDY_SKIN_STATE__.inspect();
    for (let index = 0; index < 10; index += 1) {
      const nav = document.getElementById('workbuddy-cc-theme-settings-nav');
      nav.previousElementSibling.click();
      nav.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const after = window.__WORKBUDDY_SKIN_STATE__.inspect();
    const ids = [...document.querySelectorAll('[data-cc-theme-control]')].map((node) => node.dataset.ccThemeControl);
    return {
      nav: document.querySelectorAll('#workbuddy-cc-theme-settings-nav').length,
      panel: document.querySelectorAll('#workbuddy-cc-theme-settings-panel').length,
      positionGroups: document.querySelectorAll('[data-cc-theme-position-control="media.backgroundPosition"]').length,
      positionRanges: document.querySelectorAll('[data-cc-theme-position-control="media.backgroundPosition"] input[type="range"]').length,
      duplicateControlIds: ids.length - new Set(ids).size,
      roleCountBefore: before.uiInterpreter.markedRoles,
      roleCountAfter: after.uiInterpreter.markedRoles,
      installCountBefore: before.generationInstallCount,
      installCountAfter: after.generationInstallCount,
    };
  })()`);
  assert.deepEqual(stableReconcile, {
    nav: 1, panel: 1, positionGroups: 1, positionRanges: 2, duplicateControlIds: 0,
    roleCountBefore: stableReconcile.roleCountBefore,
    roleCountAfter: stableReconcile.roleCountBefore,
    installCountBefore: stableReconcile.installCountBefore,
    installCountAfter: stableReconcile.installCountBefore,
  });

  console.log("PASS: real WorkBuddy Settings are native-aligned, immediate, LWW-persistent, rollback-safe, reload-safe, and Reduced-Motion aware.");
} finally {
  await client.send("Emulation.setEmulatedMedia", { features: [] }).catch(() => {});
  client.close();
}
