import fallback from '../../styles/highlight-fallback.css?inline';

const PROBE_TAG = 'blok-highlight-probe';
const PROBE_COLOR = 'rgb(1, 2, 3)';

/**
 * Whether a descendant takes its ancestor's ::highlight() style (highlight
 * inheritance). Chromium and WebKit do; Firefox does not. Reads the engine's
 * answer instead of guessing it from the user agent.
 */
const inheritsHighlights = (nonce: string | undefined): boolean => {
  const style = document.createElement('style');
  const probe = document.createElement(PROBE_TAG);
  const child = document.createElement('span');

  if (nonce !== undefined && nonce !== '') {
    style.setAttribute('nonce', nonce);
  }
  style.textContent = `${PROBE_TAG}::highlight(${PROBE_TAG}){background-color:${PROBE_COLOR}}`;
  probe.append(child);
  document.head.append(style);
  document.documentElement.append(probe);

  try {
    return window.getComputedStyle(child, `::highlight(${PROBE_TAG})`).backgroundColor === PROBE_COLOR;
  } finally {
    probe.remove();
    style.remove();
  }
};

/**
 * Blok's ::highlight() rules sit on a root only, so the browser does not
 * resolve each highlight per element on every style recalc. Engines without
 * highlight inheritance get the per-element (descendant) form appended.
 */
export const withHighlightFallback = (css: string, nonce: string | undefined): string =>
  inheritsHighlights(nonce) ? css : `${css}\n${fallback}`;
