import * as maplibre from 'maplibre-gl';
import css from 'maplibre-gl/dist/maplibre-gl.css?inline';
import workerSource from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw';

/** The attribute on a map's host element. MapLibre's rules apply only below it. */
export const MAPLIBRE_SCOPE = 'data-blok-maplibre';

const STYLE_ID = 'blok-maplibre-styles';
const SOURCE_MAP = /\s*\/\/# sourceMappingURL=\S*\s*$/;

const scriptUrl = (code: string): string =>
  URL.createObjectURL(new Blob([code.replace(SOURCE_MAP, '')], { type: 'text/javascript' }));

/** Splits a selector list on its top-level commas only: `:not(.a, .b)` stays whole. */
const splitSelectors = (list: string): string[] => {
  const parts: string[] = [];
  const state = { depth: 0, start: 0 };

  [...list].forEach((char, index) => {
    if (char === '(') state.depth += 1;
    if (char === ')') state.depth -= 1;
    if (char === ',' && state.depth === 0) {
      parts.push(list.slice(state.start, index));
      state.start = index + 1;
    }
  });
  parts.push(list.slice(state.start));

  return parts.map((part) => part.trim());
};

/** Puts every style rule below `[data-blok-maplibre]`. Keyframes stay global. */
export const scopeRules = (rules: CSSRuleList): void => {
  for (const rule of [...rules]) {
    if (rule instanceof CSSStyleRule) {
      rule.selectorText = splitSelectors(rule.selectorText).map((selector) => `[${MAPLIBRE_SCOPE}] ${selector}`).join(', ');
    } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
      scopeRules(rule.cssRules);
    }
  }
};

const addStyles = (): void => {
  if (document.getElementById(STYLE_ID) !== null) return;
  const tag = document.createElement('style');
  const own = document.getElementById('blok-styles');
  const nonce = own instanceof HTMLElement ? own.nonce : undefined;

  tag.id = STYLE_ID;
  if (nonce !== undefined && nonce !== '') tag.nonce = nonce;
  tag.textContent = css;
  document.head.appendChild(tag);
  if (tag.sheet !== null) scopeRules(tag.sheet.cssRules);
};

const state = { workerSet: false };

/**
 * MapLibre finds its worker file next to its own module. Bundled into Blok there
 * is no such file, so the worker runs from a blob. This needs maplibre-gl >= 6.13,
 * whose worker no longer imports maplibre-gl-shared.mjs.
 */
export const boot = (): typeof maplibre => {
  if (!state.workerSet) {
    maplibre.setWorkerUrl(scriptUrl(workerSource));
    state.workerSet = true;
  }
  addStyles();

  return maplibre;
};
