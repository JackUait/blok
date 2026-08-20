/**
 * SECURITY LAW (design doc, "Security model"): this seam may read ONLY an
 * in-realm JS global — never localStorage, a <meta> tag, a URL parameter, or a
 * DOM attribute. Each of those is writable WITHOUT script execution in the
 * origin, and this branch must never turn a write-only primitive into code
 * execution. The Node/HTMLCollection rejections close DOM clobbering
 * (`<img name="__BLOK_DEV_OVERRIDE__">`, nested-form fake sub-properties).
 * A cross-origin WindowProxy (`<iframe name="__BLOK_DEV_OVERRIDE__">` pointing
 * off-origin) passes the plainish checks but THROWS on any property access —
 * the try/catch below is what keeps the worst case at "broken editor" instead
 * of a crashed consumer chunk at module evaluation.
 *
 * This file is copied verbatim into dist/override-runtime.mjs (and
 * text-transformed into dist/override-runtime.cjs) by
 * scripts/override/generate-override-entries.mjs — keep it dependency-free
 * and side-effect-free.
 */
export const PROTOCOL = 1;

let warned = false;

const warnOnce = (reason) => {
  if (warned) {
    return;
  }
  warned = true;
  console.warn(`[blok] __BLOK_DEV_OVERRIDE__ present but rejected: ${reason}`);
};

const isPlainish = (x) => {
  if (typeof x !== 'object' || x === null) {
    return false;
  }
  if (typeof Node !== 'undefined' && x instanceof Node) {
    return false;
  }
  if (typeof HTMLCollection !== 'undefined' && x instanceof HTMLCollection) {
    return false;
  }
  return true;
};

export function resolveOverrideEntry(name, exportNames) {
  try {
    const registry = globalThis.__BLOK_DEV_OVERRIDE__;
    if (registry === undefined || registry === null) {
      return null;
    }
    if (!isPlainish(registry)) {
      warnOnce('registry is not a plain object');
      return null;
    }
    if (registry.protocol !== PROTOCOL) {
      warnOnce(`protocol ${String(registry.protocol)} does not match ${PROTOCOL}`);
      return null;
    }
    if (!isPlainish(registry.entries)) {
      warnOnce('entries is not a plain object');
      return null;
    }
    const entry = registry.entries[name];
    if (entry === undefined) {
      return null;
    }
    if (!isPlainish(entry)) {
      warnOnce(`entry "${name}" is not a plain object`);
      return null;
    }
    for (const exportName of exportNames) {
      if (entry[exportName] === undefined) {
        warnOnce(`entry "${name}" is missing export "${exportName}"`);
        return null;
      }
    }
    return entry;
  } catch (error) {
    warnOnce(`registry access threw: ${error && error.message ? error.message : String(error)}`);
    return null;
  }
}
