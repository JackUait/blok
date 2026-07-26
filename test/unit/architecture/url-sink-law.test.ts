/**
 * Architectural enforcement: the URL Sink Law (everything outside src/tools/link).
 *
 * Stored block data is attacker-controllable in host apps: documents come back
 * from storage and nothing guarantees a persisted `data.url` is still the URL a
 * tool once resolved. A `javascript:` URL placed on an anchor href executes in
 * the host page's origin when the anchor is clicked — that exact stored-XSS
 * shipped in the audio and video tools' "Download" action (`a.href =
 * this.data.url`, no scheme gate). The render-time pass cannot save us: it only
 * hardens URLs inside HTML-markup strings, so a bare URL field is never
 * scheme-checked anywhere but at the sink.
 *
 * The law: no value may be assigned to a `src` or `href` sink in the scanned
 * roots unless it is
 *
 * - a call to one of the sanctioned scheme gates (see SAFE_HELPERS);
 * - an identifier whose declaration in the same file comes from such a gate;
 * - a compile-time string literal;
 * - an entry in EXEMPT_SINKS with a reason explaining why it cannot execute
 *   script (inert `<img>`/`<video>`/`<audio>` sources, guards proven upstream).
 *
 * src/tools/link has its own, stricter law — see link-url-sink-law.test.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(__dirname, '../../../src');

const SCAN_ROOTS = ['tools', 'components'];

/** Covered by the stricter link-url-sink-law test. */
const SKIPPED_DIRS = new Set([join(SRC_DIR, 'tools', 'link')]);

/** Scheme gates a sink may be fed from. */
const SAFE_HELPERS = [
  'safeDownloadHref(',
  'safeHref(',
  'safeImageSrc(',
  'safeHttpHref(',
  'safePreviewSrc(',
  'toSafeEmbedSrc(',
];

/**
 * Sinks allowed to bypass the gates. Keyed by `file » rhs`.
 * Every entry MUST carry a reason.
 */
const EXEMPT_SINKS: Record<string, string> = {
  'tools/image/index.ts » src':
    'HTMLImageElement src — <img> is not a script-execution sink (javascript: URLs do not run in img)',
  'tools/image/ui.ts » data.url':
    'HTMLImageElement src — <img> is not a script-execution sink',
  'tools/image/ui.ts » item.url':
    'HTMLImageElement src (lightbox display) — <img> is not a script-execution sink',
  'tools/image/crop-editor.ts » opts.url':
    'HTMLImageElement src (crop source) — <img> is not a script-execution sink',
  'tools/image/probe-dimensions.ts » url':
    'HTMLImageElement src (off-DOM dimension probe) — <img> is not a script-execution sink',
  'tools/audio/ui.ts » data.coverUrl':
    'HTMLImageElement src (cover art) — <img> is not a script-execution sink',
  'tools/audio/ui.ts » data.url':
    'HTMLAudioElement src — media elements do not execute javascript: URLs',
  'tools/video/ui.ts » data.url':
    'HTMLVideoElement src — media elements do not execute javascript: URLs',
  'tools/video/controls.ts » src':
    'HTMLVideoElement src (seek-preview clone, copied from the rendered video) — media elements do not execute javascript: URLs',
  'components/modules/paste/handlers/pattern-handler.ts » url':
    'anchor href, but the URL reached this handler through the isHttpUrl() guard in onPaste',
  'components/modules/blockEvents/composers/markdownShortcuts.ts » url':
    'anchor href, but the markdown-link composer returns early on hasUnsafeScheme(url)',
  'components/utils/resolve-link-attributes.ts » resolved.href':
    'host-supplied transformHref result applied to an already-gated anchor href (config is trusted, not stored data)',
};

interface Sink {
  file: string;
  line: number;
  attribute: string;
  rhs: string;
}

function walk(dir: string): string[] {
  if (SKIPPED_DIRS.has(dir)) {
    return [];
  }

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
const STRING_LITERAL = /^(['"`])[\s\S]*\1$/;

const isSafeCall = (expression: string): boolean =>
  SAFE_HELPERS.some((helper) => expression.includes(helper));

/**
 * Identifiers declared in this file from a scheme gate, e.g.
 * `const href = safeHttpHref(data.url)` — the sink `a.href = href` is then gated.
 */
function safeIdentifiers(source: string): Set<string> {
  const declarations = source.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g);

  return new Set(
    Array.from(declarations)
      .filter(([, , initializer]) => isSafeCall(initializer))
      .map(([, name]) => name)
  );
}

function collectSinks(): Sink[] {
  const sinks: Sink[] = [];

  for (const root of SCAN_ROOTS) {
    for (const file of walk(join(SRC_DIR, root))) {
      const rel = relative(SRC_DIR, file).split(/[\\/]/).join('/');
      const source = readFileSync(file, 'utf8');
      const safeNames = safeIdentifiers(source);

      source.split('\n').forEach((text, index) => {
        const match = ASSIGNMENT_SINK.exec(text) ?? SET_ATTRIBUTE_SINK.exec(text);

        if (match === null) {
          return;
        }

        const rhs = match[2].trim();

        if (isSafeCall(rhs) || STRING_LITERAL.test(rhs) || safeNames.has(rhs)) {
          return;
        }

        sinks.push({ file: rel,
          line: index + 1,
          attribute: match[1],
          rhs });
      });
    }
  }

  return sinks;
}

describe('URL Sink Law', () => {
  const sinks = collectSinks();

  it('finds the known ungated sinks (scan self-check: a regex break must not silently pass)', () => {
    // The inert <img>/<video>/<audio> sources alone account for most of these —
    // the law is meaningless if the walk finds nothing.
    expect(sinks.length).toBeGreaterThanOrEqual(8);
  });

  it('routes every src/href sink through a scheme gate or a reasoned exemption', () => {
    const violations = sinks
      .filter((sink) => !(`${sink.file} » ${sink.rhs}` in EXEMPT_SINKS))
      .map(
        (sink) =>
          `${sink.file}:${sink.line} assigns .${sink.attribute} = ${sink.rhs} — route it through ` +
          'safeDownloadHref(...) / safeHttpHref(...) / safePreviewSrc(...), or add an ' +
          'EXEMPT_SINKS entry with a reason'
      );

    expect(violations).toEqual([]);
  });

  it('keeps every exemption alive (a stale entry means the sink moved — re-verify it)', () => {
    const present = new Set(sinks.map((sink) => `${sink.file} » ${sink.rhs}`));
    const stale = Object.keys(EXEMPT_SINKS).filter((key) => !present.has(key));

    expect(stale).toEqual([]);
  });
});
