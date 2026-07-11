/**
 * Architectural enforcement: the Link URL Sink Law.
 *
 * Link/embed/bookmark/mention block data is attacker-controllable in host
 * apps: documents are loaded from storage, and nothing upstream guarantees a
 * stored `data.embed` / `data.url` / `data.source` is still the URL the tool
 * once resolved. A `javascript:` URL reaching an iframe `src` executes in the
 * HOST page's origin (sandboxed frames with `allow-scripts allow-same-origin`
 * inherit the embedder origin for javascript: URLs) — that exact stored-XSS
 * shipped in 0.24.x via `iframe.src = this.data.embed ?? ''`.
 *
 * The law: inside src/tools/link/**, no value may be assigned to a `src` or
 * `href` sink unless it goes through one of the sanctioned safe helpers:
 *
 * - `toSafeEmbedSrc(...)` (embed/index.ts) — https-only, for iframe src and
 *   embed-widget hrefs;
 * - `setSafeLinkHref(el, url)` (registry.ts) — http/https-only, skips the
 *   attribute entirely for unsafe values, for navigable anchors;
 * - a `*_WIDGET_SRC` module constant (compile-time provider script URL);
 * - an entry in EXEMPT_SINKS with a reason explaining why the sink cannot
 *   execute script.
 *
 * The scan is a directory walk, so new files/sinks cannot dodge it. If this
 * test fails on your change: route the value through toSafeEmbedSrc /
 * setSafeLinkHref, or add an EXEMPT_SINKS entry with a real reason.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LINK_TOOLS_DIR = resolve(__dirname, '../../../src/tools/link');

/** Compile-time provider widget script URLs — literal constants, not data. */
const WIDGET_SRC_CONSTANTS = new Set([
  'TELEGRAM_WIDGET_SRC',
  'TWITTER_WIDGET_SRC',
  'THREADS_WIDGET_SRC',
]);

/**
 * Sinks allowed to bypass the safe helpers. Keyed by `file » rhs`.
 * Every entry MUST carry a reason.
 */
const EXEMPT_SINKS: Record<string, string> = {
  'registry.ts » url': 'definition site of setSafeLinkHref — the assignment is behind its isHttpUrl guard',
  'mention/mention.ts » input.favicon':
    'HTMLImageElement src — <img> is not a script-execution sink (javascript: URLs do not run in img)',
  'bookmark/index.ts » this.data.favicon':
    'HTMLImageElement src — <img> is not a script-execution sink (javascript: URLs do not run in img)',
  'bookmark/index.ts » this.data.image':
    'HTMLImageElement src — <img> is not a script-execution sink (javascript: URLs do not run in img)',
};

interface Sink {
  file: string;
  line: number;
  attribute: string;
  rhs: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      return walk(full);
    }

    return full.endsWith('.ts') && !full.endsWith('.d.ts') ? [full] : [];
  });
}

const ASSIGNMENT_SINK = /\.(src|href)\s*=\s*(.+?);\s*$/;
const SET_ATTRIBUTE_SINK = /\.setAttribute\(\s*'(src|href)'\s*,\s*([^)]+)\)/;

function collectSinks(): Sink[] {
  const sinks: Sink[] = [];

  for (const file of walk(LINK_TOOLS_DIR)) {
    const rel = relative(LINK_TOOLS_DIR, file);
    const lines = readFileSync(file, 'utf8').split('\n');

    lines.forEach((text, index) => {
      const match = ASSIGNMENT_SINK.exec(text) ?? SET_ATTRIBUTE_SINK.exec(text);

      if (match) {
        sinks.push({ file: rel, line: index + 1, attribute: match[1], rhs: match[2].trim() });
      }
    });
  }

  return sinks;
}

function isSanctioned(sink: Sink): boolean {
  if (sink.rhs.startsWith('toSafeEmbedSrc(')) {
    return true;
  }

  if (WIDGET_SRC_CONSTANTS.has(sink.rhs)) {
    return true;
  }

  return `${sink.file} » ${sink.rhs}` in EXEMPT_SINKS;
}

describe('Link URL Sink Law', () => {
  const sinks = collectSinks();

  it('finds the known sinks (scan self-check: a regex break must not silently pass)', () => {
    // iframe.src, twitter anchor, threads anchor, 3 widget scripts, registry
    // helper, 3 img sinks — the law is meaningless if the walk finds nothing.
    expect(sinks.length).toBeGreaterThanOrEqual(9);
    expect(sinks.some((s) => s.rhs.startsWith('toSafeEmbedSrc('))).toBe(true);
  });

  it('routes every src/href sink in src/tools/link through a safe helper or a reasoned exemption', () => {
    const violations = sinks
      .filter((sink) => !isSanctioned(sink))
      .map(
        (sink) =>
          `${sink.file}:${sink.line} assigns .${sink.attribute} = ${sink.rhs} — wrap it in ` +
          'toSafeEmbedSrc(...) / setSafeLinkHref(...), or add an EXEMPT_SINKS entry with a reason'
      );

    expect(violations).toEqual([]);
  });

  it('keeps every exemption alive (a stale entry means the sink moved — re-verify it)', () => {
    const present = new Set(sinks.map((sink) => `${sink.file} » ${sink.rhs}`));
    const stale = Object.keys(EXEMPT_SINKS).filter((key) => !present.has(key));

    expect(stale).toEqual([]);
  });
});
