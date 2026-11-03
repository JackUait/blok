/**
 * Iframe sandbox law.
 *
 * Every iframe Blok makes in src/ must get its `sandbox` from a constant in
 * src/shared/embed-frame.ts and must set a `referrerpolicy`. A frame with no
 * sandbox runs whatever the URL serves, can navigate the host tab, and on the
 * host's origin (a blob: or own-site URL) runs as the host. An exemption needs
 * a written reason.
 *
 * The scan finds `createElement('iframe')` and `<iframe` in strings and
 * templates. For a createElement site, the rules apply to the code from the
 * site to the end of the function that holds it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GENERIC_IFRAME_SANDBOX, IFRAME_SANDBOX, PLAYER_IFRAME_SANDBOX, registryIframeSandbox } from '../../../src/shared/embed-frame';
import { EMBED_SERVICES } from '../../../src/shared/embed-registry';

const SRC_DIR = resolve(__dirname, '../../../src');

const APPROVED_SANDBOXES = ['IFRAME_SANDBOX', 'PLAYER_IFRAME_SANDBOX', 'GENERIC_IFRAME_SANDBOX', 'registryIframeSandbox'];

/** A sandbox value is a profile constant, or the registry chooser called on an entry. */
const isApprovedSandbox = (value: string): boolean =>
  APPROVED_SANDBOXES.includes(value) || /^registryIframeSandbox\(.+\)$/.test(value);

/** Keyed by `file » rule`. Every entry MUST carry a reason. */
const EXEMPTIONS: Record<string, string> = {
  'tools/file/preview-modal.ts » sandbox':
    'PDF blob preview. Chrome blocks its PDF viewer in every sandboxed frame, so the frame has none. ' +
    'The bytes are re-typed application/pdf first, which runs no script in Chrome, Firefox or WebKit.',
};

/** Tokens that would let a generic page out of its box. A prefix match also catches the -by-user-activation forms. */
const GENERIC_FORBIDDEN_PREFIXES = [
  'allow-same-origin',
  'allow-top-navigation',
  'allow-downloads',
  'allow-modals',
  'allow-popups-to-escape-sandbox',
];

interface Site {
  file: string;
  line: number;
  kind: 'element' | 'template';
  /** The code the rules check. */
  scope: string;
  /** The iframe variable for an element site. */
  variable: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      return walk(full);
    }

    const isSource = full.endsWith('.ts') && !full.endsWith('.d.ts')
      && !full.endsWith('.test.ts') && !full.endsWith('.stories.ts');

    return isSource ? [full] : [];
  });
}

const CREATE_IFRAME = /(?:const|let)\s+(\w+)\s*=\s*document\.createElement\(\s*['"`]iframe['"`]\s*\)/;
const ANY_CREATE_IFRAME = /createElement\(\s*['"`]iframe['"`]\s*\)/;
const TEMPLATE_IFRAME = /<iframe\b/i;
/** A line that starts a new function or method: the end of an element site's scope. */
const FUNCTION_START = /^\s{0,2}(?:export\s+)?(?:async\s+)?(?:function\s|private\s|public\s|protected\s|static\s|const\s+\w+\s*=\s*(?:async\s*)?\()/;

function isCommentLine(text: string): boolean {
  const trimmed = text.trim();

  return trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*');
}

function collectSites(): { sites: Site[]; unparsed: string[] } {
  const sites: Site[] = [];
  const unparsed: string[] = [];

  for (const path of walk(SRC_DIR)) {
    const file = relative(SRC_DIR, path);
    const lines = readFileSync(path, 'utf8').split('\n');

    lines.forEach((text, index) => {
      if (isCommentLine(text)) {
        return;
      }

      if (ANY_CREATE_IFRAME.test(text)) {
        const match = CREATE_IFRAME.exec(text);

        if (match === null) {
          unparsed.push(`${file}:${index + 1}`);

          return;
        }

        const rest = lines.slice(index + 1);
        const end = rest.findIndex((line) => FUNCTION_START.test(line));

        sites.push({
          file,
          line: index + 1,
          kind: 'element',
          variable: match[1],
          scope: [text, ...(end === -1 ? rest : rest.slice(0, end))].join('\n'),
        });

        return;
      }

      if (TEMPLATE_IFRAME.test(text)) {
        sites.push({ file, line: index + 1, kind: 'template', variable: '', scope: text });
      }
    });
  }

  return { sites, unparsed };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sandboxProblem(site: Site): string | null {
  if (site.kind === 'template') {
    const values = [...site.scope.matchAll(/\bsandbox="([^"]*)"/g)].map((m) => m[1]);

    if (values.length === 0) {
      return 'has no sandbox attribute';
    }

    const approved = values.every((value) => /^\$\{.+\}$/.test(value) && isApprovedSandbox(value.slice(2, -1)));

    return approved ? null : `sets sandbox="${values.join(' | ')}", not a constant from shared/embed-frame.ts`;
  }

  const v = escapeRegExp(site.variable);

  if (new RegExp(`\\b${v}\\.sandbox\\b`).test(site.scope)) {
    return `writes ${site.variable}.sandbox directly; use setAttribute('sandbox', <constant>)`;
  }

  const values = [...site.scope.matchAll(new RegExp(`\\b${v}\\.setAttribute\\(\\s*['"]sandbox['"]\\s*,\\s*([^)]+?\\)?)\\s*\\)`, 'g'))]
    .map((m) => m[1]);

  if (values.length === 0) {
    return 'has no sandbox attribute';
  }

  const bad = values.filter((value) => !isApprovedSandbox(value));

  return bad.length === 0 ? null : `sets sandbox to ${bad.join(', ')}, not a constant from shared/embed-frame.ts`;
}

function referrerProblem(site: Site): string | null {
  if (site.kind === 'template') {
    return /\breferrerpolicy="[a-z-]+"/.test(site.scope) ? null : 'has no referrerpolicy attribute';
  }

  const v = escapeRegExp(site.variable);
  const viaAttribute = new RegExp(`\\b${v}\\.setAttribute\\(\\s*['"]referrerpolicy['"]\\s*,\\s*['"][a-z-]+['"]\\s*\\)`);
  const viaProperty = new RegExp(`\\b${v}\\.referrerPolicy\\s*=\\s*['"][a-z-]+['"]`);

  return viaAttribute.test(site.scope) || viaProperty.test(site.scope) ? null : 'has no referrerpolicy';
}

function importsConstant(file: string, name: string): boolean {
  const text = readFileSync(join(SRC_DIR, file), 'utf8');

  return new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'[./]*(?:shared/)?embed-frame'`).test(text);
}

describe('Iframe sandbox law', () => {
  const { sites, unparsed } = collectSites();

  it('finds the known iframe sites (a regex break must not pass silently)', () => {
    // embed tool, view emitter, PDF blob preview.
    expect(sites.length).toBeGreaterThanOrEqual(3);
    expect(sites.some((s) => s.kind === 'element')).toBe(true);
    expect(sites.some((s) => s.kind === 'template')).toBe(true);
  });

  it('can read every createElement(\'iframe\') site', () => {
    // Assign the frame to a const/let so the law can follow it.
    expect(unparsed).toEqual([]);
  });

  it('gives every iframe a sandbox from shared/embed-frame.ts, or a reasoned exemption', () => {
    const violations = sites.flatMap((site) => {
      const problem = sandboxProblem(site);

      return problem === null || `${site.file} » sandbox` in EXEMPTIONS ? [] : [`${site.file}:${site.line} ${problem}`];
    });

    expect(violations).toEqual([]);
  });

  it('takes the sandbox constants from shared/embed-frame.ts, not a local copy', () => {
    const missing = sites.flatMap((site) => {
      const used = APPROVED_SANDBOXES.filter((name) => new RegExp(`\\b${name}\\b`).test(site.scope));

      return used.filter((name) => !importsConstant(site.file, name)).map((name) => `${site.file}:${site.line} ${name}`);
    });

    expect(missing).toEqual([]);
  });

  it('gives every iframe a referrerpolicy', () => {
    const violations = sites.flatMap((site) => {
      const problem = referrerProblem(site);

      return problem === null || `${site.file} » referrerpolicy` in EXEMPTIONS ? [] : [`${site.file}:${site.line} ${problem}`];
    });

    expect(violations).toEqual([]);
  });

  it('keeps every exemption alive (a stale entry means the site moved)', () => {
    const live = new Set(sites.flatMap((site) => [`${site.file} » sandbox`, `${site.file} » referrerpolicy`]));

    expect(Object.keys(EXEMPTIONS).filter((key) => !live.has(key))).toEqual([]);
  });

  it('pins every sandbox profile exactly', () => {
    expect(IFRAME_SANDBOX).toBe('allow-scripts allow-same-origin allow-popups allow-presentation');
    expect(PLAYER_IFRAME_SANDBOX).toBe('allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation');
    expect(GENERIC_IFRAME_SANDBOX).toBe('allow-scripts allow-forms allow-popups');
  });

  /*
   * In Firefox a popup that escaped the sandbox can set `opener.top.location`
   * and move the host tab, even under COOP same-origin-allow-popups. A
   * provider that serves code or pages its users wrote would hand that to
   * any author, so only a media player on the provider's own fixed host may
   * opt in.
   */
  it('lets only media players on a fixed provider host escape the sandbox for popups', () => {
    const optedIn = Object.entries(EMBED_SERVICES).filter(([, service]) => service.popupsEscapeSandbox === true);
    const bad = optedIn
      .filter(([, service]) => !['video', 'audio'].includes(service.type) || /^https:\/\/[^/]*<%/.test(service.embedUrl))
      .map(([name]) => name);

    expect(optedIn.length).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it.each(['codepen', 'jsfiddle', 'codesandbox', 'stackblitz', 'observable', 'plunker', 'p5js', 'scratch', 'chromatic', 'peertube', 'mastodon', 'substack', 'typeform'])(
    'keeps %s popups inside the sandbox',
    (name) => {
      expect(registryIframeSandbox(EMBED_SERVICES[name])).toBe(IFRAME_SANDBOX);
    }
  );

  it.each(['youtube', 'vimeo', 'spotify', 'soundcloud'])('lets %s popups open the real provider page', (name) => {
    expect(registryIframeSandbox(EMBED_SERVICES[name])).toBe(PLAYER_IFRAME_SANDBOX);
  });

  it('never lets a generic embed out of its sandbox', () => {
    const tokens = GENERIC_IFRAME_SANDBOX.split(/\s+/);
    const leaks = tokens.filter((token) => GENERIC_FORBIDDEN_PREFIXES.some((prefix) => token.startsWith(prefix)));

    expect(leaks).toEqual([]);
  });
});
