/**
 * Stylesheets that leave the main bundle and load on first use.
 *
 * All of Blok's CSS still ends up in the one `<style id="blok-styles">`. main.css
 * marks where each lazy sheet's `@import` was with a rule no element matches:
 * `[data-blok-sheet='<name>'] { --blok-sheet: <name>; }`. When a sheet loads,
 * its CSS replaces that rule, so its rules keep their place in the cascade.
 * A comment would not do as a marker: lightningcss hoists `/*!` comments to
 * the top.
 */

/** Each entry imports a file from src/styles/lazy, which Tailwind compiles like main.css. */
const LOADERS = {
  fonts: () => import('../../styles/lazy/fonts.css?inline'),
  database: () => import('../../styles/lazy/database.css?inline'),
  'block-preview': () => import('../../styles/lazy/block-preview.css?inline'),
  presence: () => import('../../styles/lazy/presence.css?inline'),
};

export type LazySheet = keyof typeof LOADERS;

/**
 * A tool class lists the sheets its blocks need under this key, as a static
 * getter. Subclasses inherit it. Core loads them before the first render.
 * Not versioned: a tool class built against one Blok copy must still be read
 * by another (tools.mjs and blok.mjs, or the CJS and ESM builds).
 */
export const TOOL_SHEETS = Symbol.for('blok.toolSheets');

/**
 * How long boot waits for its sheets before it renders anyway. A stalled chunk
 * must not hold the editor forever; 3s matches the browser's own font-display
 * block period, after which text paints in a fallback face regardless.
 */
export const BOOT_SHEET_WAIT_MS = 3000;

const EAGER_ID = 'blok-styles';

interface Registry {
  css: Map<string, string>;
  loads: Map<string, Promise<void>>;
  /** Sheets already written into a given #blok-styles. */
  written: WeakMap<Element, Set<string>>;
}

declare const VERSION: string | undefined;

/**
 * Page-wide, so the ESM and CJS copies of one Blok version share it. Keyed by
 * version: two Blok versions on one page must not swap sheets.
 */
export const REGISTRY = Symbol.for(`blok.lazySheets@${typeof VERSION === 'undefined' ? 'dev' : VERSION}`);

const registry = (): Registry => {
  const scope = globalThis as unknown as Record<symbol, Registry | undefined>;
  const existing = scope[REGISTRY];

  if (existing !== undefined) {
    return existing;
  }

  const created: Registry = { css: new Map(), loads: new Map(), written: new WeakMap() };

  scope[REGISTRY] = created;

  return created;
};

/** Matches the marker rule both minified and as authored. */
const markerOf = (name: string): RegExp =>
  new RegExp(`\\[data-blok-sheet=["']?${name}["']?\\]\\s*\\{\\s*--blok-sheet:\\s*${name}\\s*;?\\s*\\}`);

const write = (name: string): void => {
  const { css, written } = registry();
  const sheet = css.get(name);
  const tag = typeof document === 'undefined' ? null : document.getElementById(EAGER_ID);

  if (sheet === undefined || tag === null) {
    return;
  }

  const done = written.get(tag) ?? new Set<string>();

  if (done.has(name)) {
    return;
  }

  const text = tag.textContent ?? '';
  const marker = markerOf(name);

  tag.textContent = marker.test(text) ? text.replace(marker, () => sheet) : `${text}\n${sheet}`;
  done.add(name);
  written.set(tag, done);
};

/**
 * Puts `<style id="blok-styles">` first in <head>, once per page, with every
 * lazy sheet that has already loaded.
 */
export const mountStyles = (css: string, nonce: string | undefined): void => {
  if (document.getElementById(EAGER_ID) === null) {
    const tag = document.createElement('style');

    tag.id = EAGER_ID;
    if (nonce !== undefined && nonce !== '') {
      tag.setAttribute('nonce', nonce);
    }
    tag.textContent = css;
    document.head.prepend(tag);
  }

  [...registry().css.keys()].forEach(write);
};

/**
 * Loads a lazy sheet once per page. Never rejects: a failed load leaves the
 * marker in place. It is not retried, because browsers keep a failed import's
 * result.
 */
export const loadSheet = (name: LazySheet): Promise<void> => {
  const { css, loads } = registry();
  const known = loads.get(name);

  if (known !== undefined) {
    return known;
  }

  const load = LOADERS[name]()
    .then((module) => {
      css.set(name, module.default);
      write(name);
    })
    .catch(() => undefined);

  loads.set(name, load);

  return load;
};

export const isSheetLoaded = (name: LazySheet): boolean => registry().css.has(name);

const isSheet = (name: unknown): name is LazySheet => typeof name === 'string' && name in LOADERS;

/** The sheets a tool class declares under {@link TOOL_SHEETS}. */
export const toolSheets = (toolClass: unknown): LazySheet[] => {
  if (typeof toolClass !== 'function') {
    return [];
  }

  const declared: unknown = (toolClass as unknown as Record<symbol, unknown>)[TOOL_SHEETS];

  return Array.isArray(declared) ? declared.filter(isSheet) : [];
};

/**
 * Every sheet the tools in a `tools` config declare, including tools they
 * bring along through `provides` or `companionTools`.
 */
export const sheetsOfTools = (tools: unknown): LazySheet[] => {
  const found = new Set<LazySheet>();
  const seen = new Set<unknown>();

  const visit = (entry: unknown): void => {
    const toolClass: unknown = typeof entry === 'object' && entry !== null ? (entry as { class?: unknown }).class : entry;

    if (typeof toolClass !== 'function' || seen.has(toolClass)) {
      return;
    }
    seen.add(toolClass);
    toolSheets(toolClass).forEach((name) => found.add(name));

    const linked = toolClass as { provides?: unknown; companionTools?: unknown };

    [linked.provides, linked.companionTools].forEach((map) => {
      if (typeof map === 'object' && map !== null) {
        Object.values(map).forEach(visit);
      }
    });
  };

  if (typeof tools === 'object' && tools !== null) {
    Object.values(tools).forEach(visit);
  }

  return [...found];
};

/** Runs `task` when the page is idle; no-op without a window. */
export const whenIdle = (task: () => void): void => {
  if (typeof window === 'undefined') {
    return;
  }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(task);

    return;
  }
  setTimeout(task, 1);
};

/** Resolves when `promise` does, or after `ms`, whichever comes first. */
export const waitAtMost = async (promise: Promise<unknown>, ms: number): Promise<void> => {
  const timer: { id?: ReturnType<typeof setTimeout> } = {};

  await Promise.race([promise, new Promise((resolve) => {
    timer.id = setTimeout(resolve, ms);
  })]);
  clearTimeout(timer.id);
};
