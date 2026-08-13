/**
 * Architectural enforcement: the Accessibility Law.
 *
 * Blok builds nearly all of its chrome from bare `<div>`s and hand-stamped
 * `role`/`aria-*` attributes, so ARIA correctness lives entirely in imperative
 * `setAttribute` calls scattered across `src/`. Nothing in the type system ties
 * a role to the attributes that role makes legal, or to the accessible name it
 * requires — a screen reader just silently announces "button", or drops an
 * `aria-disabled` that has no role to attach to. Every defect this law pins was
 * found that way: written, shipped, and invisible to every other gate.
 *
 * Six invariants, each scanned statically over `src/**\/*.ts`:
 *
 * 1. NAME — an element given a role from NAME_REQUIRED_ROLES must also get an
 *    accessible name (aria-label / aria-labelledby / text content) on the SAME
 *    variable in the SAME file. Names produced indirectly (by a factory or a
 *    later helper) cannot be proven statically and need an INDIRECTLY_NAMED
 *    entry naming the mechanism.
 * 2. STATE — `aria-disabled`/`expanded`/`checked`/`selected`/`pressed` are
 *    `aria-allowed-attr`-gated: they are only legal on an element that HAS a
 *    role. Setting one on a role-less `<div>` is a violation the browser and
 *    axe both report, and it is currently shipped (see EXEMPT_STATE_WITHOUT_ROLE).
 * 3. SEPARATOR — a `role="separator"` that is focusable is a WIDGET, not a
 *    decoration: ARIA then requires aria-orientation plus the full
 *    valuenow/valuemin/valuemax triplet. The spacer grip and the column
 *    resizer are both focusable drag handles built this way.
 * 4. ICONS — every SVG in `src/components/icons/index.ts` is decorative: it
 *    always sits inside a labelled control. Without `aria-hidden="true"` it is
 *    announced as an extra unnamed graphic, and without `focusable="false"` it
 *    becomes a tab stop in IE-legacy/Edge trident modes and in some AT virtual
 *    cursors. There are no exemptions — this one is green and stays green.
 * 5. DIALOG — `role="dialog"` without `aria-modal` tells AT the background is
 *    still reachable. That is sometimes TRUE (an anchored, non-modal popover),
 *    which is exactly why the exemption must be stated rather than assumed.
 * 6. LEDGER — every `a11y.*` i18n key referenced in `src/` must exist in
 *    en.json, and every `a11y.*` key in en.json must be referenced in `src/`.
 *    Half-wired keys are this repo's classic i18n failure: the announcement
 *    falls back to the raw key string, which is what a screen reader then says
 *    out loud.
 *
 * The scans are deliberately narrow: they only reason about a variable whose
 * provenance is visible in the same file. A law that cries wolf gets disabled,
 * so every heuristic here errs toward silence. Everything it DOES flag is
 * either a real defect or needs one line of explanation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import * as icons from '../../../src/components/icons';

const REPO_ROOT = resolve(__dirname, '../../..');
const SRC_DIR = join(REPO_ROOT, 'src');
const ICONS_FILE = join(SRC_DIR, 'components', 'icons', 'index.ts');
const EN_LOCALE_FILE = join(SRC_DIR, 'components', 'i18n', 'locales', 'en.json');

/**
 * Roles whose accessible name must come from the author: none of them derive a
 * name from anything but a label attribute or their own text, so a nameless one
 * is announced as a bare role word.
 */
const NAME_REQUIRED_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
  'switch',
  'checkbox',
  'radio',
  'separator',
]);

/** ARIA state attributes that `aria-allowed-attr` only permits on a roled element. */
const ROLE_GATED_STATE_ATTRS = [
  'aria-disabled',
  'aria-expanded',
  'aria-checked',
  'aria-selected',
  'aria-pressed',
];

/** Tags that carry an implicit role, so an ARIA state attribute is already legal on them. */
const NATIVELY_ROLED_TAGS = new Set([
  'a', 'article', 'aside', 'button', 'details', 'dialog', 'fieldset', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'img', 'input',
  'li', 'main', 'menu', 'meter', 'nav', 'ol', 'option', 'output', 'progress',
  'section', 'select', 'summary', 'table', 'td', 'textarea', 'th', 'tr', 'ul',
]);

/** A focusable separator is a widget and owes ARIA the full slider contract. */
const FOCUSABLE_SEPARATOR_ATTRS = [
  'aria-orientation',
  'aria-valuenow',
  'aria-valuemin',
  'aria-valuemax',
];

/**
 * Roles whose accessible name is produced somewhere the static scan cannot
 * follow (a factory that builds the element, or a helper called with it later).
 * Key: `<file> » <variable> » <role>`. Every entry MUST name the mechanism that
 * supplies the name, so a reviewer can re-verify it without re-deriving it.
 */
const INDIRECTLY_NAMED: Record<string, string> = {
  'components/modules/toolbar/plus-button.ts » plusButton » button':
    'DELIBERATE — named by PlusButton.refreshI18n(plusButton), which sets aria-label to ' +
    'a11y.insertBlock on creation and again on every runtime locale change; the scan ' +
    'cannot follow the element through the helper parameter',
  'tools/video/controls.ts » ctxLoop » menuitemcheckbox':
    'DELIBERATE — built by the local ctxItem() factory, which sets item.textContent to the ' +
    'translated label before returning; the role is only upgraded to menuitemcheckbox afterwards',
};

/**
 * Elements that take a role-gated ARIA state attribute while carrying no role.
 * Key: `<file> » <variable> » <attribute>`.
 */
const EXEMPT_STATE_WITHOUT_ROLE: Record<string, string> = {};

/**
 * `role="dialog"` elements that are deliberately non-modal. The reason must
 * quote the source's own justification — "we forgot" is not one.
 */
const EXEMPT_NON_MODAL_DIALOGS: Record<string, string> = {
  'tools/audio/cover-picker.ts » dialog':
    'DELIBERATE — "The picker is an anchored, non-modal dialog, so it advertises its open ' +
    'state on the trigger button (mirrors the alt-text popover) rather than inert-ing" the ' +
    'background; declaring aria-modal would lie about a background that stays reachable',
};

interface ScannedFile {
  rel: string;
  source: string;
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      return walk(full);
    }

    return full.endsWith('.ts') && !full.endsWith('.d.ts') ? [full] : [];
  });

/** Comments are stripped so a key or a role mentioned in prose is never mistaken for code. */
const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

const SOURCES: ScannedFile[] = walk(SRC_DIR).map((file) => ({
  rel: relative(SRC_DIR, file).split(/[\\/]/).join('/'),
  source: stripComments(readFileSync(file, 'utf-8')),
}));

const lineOf = (source: string, index: number): number =>
  source.slice(0, index).split('\n').length;

/** `x.setAttribute('role', 'button')` — literal role only. */
const ROLE_LITERAL = /([A-Za-z_$][\w$]*)\??\.setAttribute\(\s*'role'\s*,\s*'([a-z]+)'/g;
/** `x.setAttribute('role', <anything>)` — used where the value is computed. */
const ROLE_ANY = /([A-Za-z_$][\w$]*)\??\.setAttribute\(\s*'role'\s*,\s*([^)]*)\)/g;
/** `x.role = …` — the IDL alternative to setAttribute. */
const ROLE_PROPERTY = /([A-Za-z_$][\w$]*)\??\.role\s*=[^=]/g;
/**
 * Element creation whose tag is a compile-time literal. Restricted to the three
 * factories whose first argument is unambiguously a tag name — `this.make(…)`
 * and other `x.make(…)` callers are excluded rather than guessed at.
 */
const ELEMENT_CREATION =
  /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:document\.createElement(?:<[^>]*>)?|\$\.make|Dom\.make)\(\s*'([a-zA-Z0-9-]+)'/g;

const matchAll = (source: string, pattern: RegExp): RegExpMatchArray[] =>
  Array.from(source.matchAll(new RegExp(pattern.source, pattern.flags)));

/** Variables that receive a role anywhere in the file, by any mechanism. */
const rolledVariables = (source: string): Set<string> =>
  new Set([
    ...matchAll(source, ROLE_ANY).map((match) => match[1]),
    ...matchAll(source, ROLE_PROPERTY).map((match) => match[1]),
  ]);

/** Variables created from a literal tag, keyed to that tag — ambiguous names are dropped. */
const createdElementTags = (source: string): Map<string, string> => {
  const tags = new Map<string, Set<string>>();

  for (const match of matchAll(source, ELEMENT_CREATION)) {
    const existing = tags.get(match[1]) ?? new Set<string>();

    existing.add(match[2]);
    tags.set(match[1], existing);
  }

  return new Map(
    Array.from(tags)
      .filter(([, candidates]) => candidates.size === 1)
      .map(([name, candidates]) => [name, Array.from(candidates)[0]])
  );
};

const setsOnVariable = (source: string, name: string, attribute: string): boolean =>
  new RegExp(`${name}\\??\\.setAttribute\\(\\s*'${attribute}'`).test(source);

/**
 * Evidence that `name` ends up with an accessible name: an explicit label, its
 * own text, or appended children (an icon+label row names its own control).
 */
const hasAccessibleName = (source: string, name: string): boolean =>
  new RegExp(
    `${name}\\??\\.(?:setAttribute\\(\\s*'aria-label(?:ledby)?'|ariaLabel\\s*=[^=]|textContent\\s*=[^=]` +
      `|innerText\\s*=[^=]|innerHTML\\s*=[^=]|title\\s*=[^=]|append\\(|appendChild\\(` +
      `|replaceChildren\\(|insertAdjacentHTML\\()`
  ).test(source);

/** Focusability of a separator: a real tab stop or its own keyboard handling. */
const isFocusable = (source: string, name: string): boolean =>
  new RegExp(`${name}\\??\\.setAttribute\\(\\s*'tabindex'\\s*,\\s*'(?!-)`).test(source) ||
  new RegExp(`${name}\\??\\.tabIndex\\s*=\\s*(?!-)`).test(source) ||
  new RegExp(`${name}\\??\\.addEventListener\\(\\s*'keydown'`).test(source);

interface Finding {
  key: string;
  detail: string;
}

const collectNamelessRoles = (): Finding[] =>
  SOURCES.flatMap(({ rel, source }) => {
    const seen = new Set<string>();

    return matchAll(source, ROLE_LITERAL).flatMap((match) => {
      const [, name, role] = match;
      const key = `${rel} » ${name} » ${role}`;

      if (!NAME_REQUIRED_ROLES.has(role) || seen.has(key) || hasAccessibleName(source, name)) {
        return [];
      }

      seen.add(key);

      return [{
        key,
        detail:
          `${rel}:${lineOf(source, match.index ?? 0)} gives "${name}" role="${role}" but nothing in ` +
          'this file gives it an accessible name — set aria-label/aria-labelledby or text content on ' +
          'it, or add an INDIRECTLY_NAMED entry naming the helper that does',
      }];
    });
  });

const collectStateWithoutRole = (): Finding[] =>
  SOURCES.flatMap(({ rel, source }) => {
    const tags = createdElementTags(source);
    const roled = rolledVariables(source);
    const seen = new Set<string>();

    return ROLE_GATED_STATE_ATTRS.flatMap((attribute) =>
      matchAll(source, new RegExp(`([A-Za-z_$][\\w$]*)\\??\\.setAttribute\\(\\s*'${attribute}'`, 'g')).flatMap(
        (match) => {
          const name = match[1];
          const tag = tags.get(name);
          const key = `${rel} » ${name} » ${attribute}`;

          if (tag === undefined || NATIVELY_ROLED_TAGS.has(tag) || roled.has(name) || seen.has(key)) {
            return [];
          }

          seen.add(key);

          return [{
            key,
            detail:
              `${rel}:${lineOf(source, match.index ?? 0)} sets ${attribute} on "${name}", a <${tag}> ` +
              'that never receives a role — ARIA only allows that attribute on a roled element ' +
              '(axe: aria-allowed-attr). Give the element the role its behaviour implies, or drop ' +
              'the state attribute',
          }];
        }
      )
    );
  });

const collectUnderspecifiedSeparators = (): Finding[] =>
  SOURCES.flatMap(({ rel, source }) => {
    const seen = new Set<string>();

    return matchAll(source, ROLE_LITERAL).flatMap((match) => {
      const [, name, role] = match;
      const key = `${rel} » ${name}`;

      if (role !== 'separator' || seen.has(key) || !isFocusable(source, name)) {
        return [];
      }

      seen.add(key);

      // File scope, not variable scope: the column resizer's aria-valuenow is
      // written by updateResizerAria(resizer), a helper in the same file.
      const missing = FOCUSABLE_SEPARATOR_ATTRS.filter(
        (attribute) => !new RegExp(`setAttribute\\(\\s*'${attribute}'`).test(source)
      );

      if (missing.length === 0) {
        return [];
      }

      return [{
        key,
        detail:
          `${rel}:${lineOf(source, match.index ?? 0)} makes "${name}" a FOCUSABLE role="separator" ` +
          `but the file never sets ${missing.join(', ')} — a focusable separator is a widget and ` +
          'must expose its orientation and value range (see src/tools/spacer/index.ts)',
      }];
    });
  });

const collectNonModalDialogs = (): Finding[] =>
  SOURCES.flatMap(({ rel, source }) => {
    const seen = new Set<string>();

    return matchAll(source, ROLE_ANY).flatMap((match) => {
      const [, name, value] = match;
      const key = `${rel} » ${name}`;

      if (!/'(?:alert)?dialog'/.test(value) || seen.has(key) || setsOnVariable(source, name, 'aria-modal')) {
        return [];
      }

      seen.add(key);

      return [{
        key,
        detail:
          `${rel}:${lineOf(source, match.index ?? 0)} gives "${name}" a dialog role without ` +
          'aria-modal — set aria-modal="true" (and trap focus), or add an ' +
          'EXEMPT_NON_MODAL_DIALOGS entry quoting why the background stays reachable',
      }];
    });
  });

const iconMarkup = (): Array<[string, string]> =>
  Object.entries(icons).filter(
    (entry): entry is [string, string] => entry[0].startsWith('Icon') && typeof entry[1] === 'string'
  );

const svgOpenTags = (markup: string): string[] => Array.from(markup.match(/<svg\b[^>]*>/g) ?? []);

const decorativeGaps = (openTag: string): string[] =>
  [
    /aria-hidden\s*=\s*"true"/.test(openTag) ? '' : 'aria-hidden="true"',
    /focusable\s*=\s*"false"/.test(openTag) ? '' : 'focusable="false"',
  ].filter((gap) => gap !== '');

const parseLocale = (file: string): Record<string, string> => {
  const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;

  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
};

const A11Y_KEY_LITERAL = /['"`](a11y\.[A-Za-z0-9_.]+)['"`]/g;

const referencedA11yKeys = (): Map<string, string> => {
  const references = new Map<string, string>();
  const sightings = SOURCES.flatMap(({ rel, source }) =>
    matchAll(source, A11Y_KEY_LITERAL).map(
      (match): [string, string] => [match[1], `${rel}:${lineOf(source, match.index ?? 0)}`]
    )
  );

  for (const [key, where] of sightings) {
    if (!references.has(key)) {
      references.set(key, where);
    }
  }

  return references;
};

const reportOf = (findings: Finding[]): string =>
  findings.map((finding) => `- ${finding.detail}`).join('\n');

describe('Accessibility Law', () => {
  it('walks a real source tree (a broken walk must not silently pass every scan)', () => {
    expect(SOURCES.length).toBeGreaterThan(200);
    expect(SOURCES.some(({ rel }) => rel === 'tools/spacer/index.ts')).toBe(true);
  });

  describe('roles that require an author-supplied accessible name', () => {
    const findings = collectNamelessRoles();

    it('finds the roles it is supposed to police (regex self-check)', () => {
      const roleAssignments = SOURCES.flatMap(({ source }) =>
        matchAll(source, ROLE_LITERAL).filter((match) => NAME_REQUIRED_ROLES.has(match[2]))
      );

      expect(roleAssignments.length).toBeGreaterThanOrEqual(10);
    });

    it('every interactive role is named, or its indirect naming is recorded', () => {
      const unexplained = findings.filter((finding) => !(finding.key in INDIRECTLY_NAMED));

      expect(unexplained, `\n${reportOf(unexplained)}\n`).toEqual([]);
    });

    it('carries no stale INDIRECTLY_NAMED entries', () => {
      const detected = new Set(findings.map((finding) => finding.key));
      const stale = Object.keys(INDIRECTLY_NAMED).filter((key) => !detected.has(key));

      expect(stale, 'these elements are now named where the scan can see it — drop the entry').toEqual([]);
    });
  });

  describe('role-gated ARIA state attributes', () => {
    const findings = collectStateWithoutRole();

    it('no ARIA state attribute lands on a role-less element', () => {
      const unexplained = findings.filter((finding) => !(finding.key in EXEMPT_STATE_WITHOUT_ROLE));

      expect(unexplained, `\n${reportOf(unexplained)}\n`).toEqual([]);
    });

    it('carries no stale EXEMPT_STATE_WITHOUT_ROLE entries', () => {
      const detected = new Set(findings.map((finding) => finding.key));
      const stale = Object.keys(EXEMPT_STATE_WITHOUT_ROLE).filter((key) => !detected.has(key));

      expect(stale, 'the element now has a role (or the attribute is gone) — drop the entry').toEqual([]);
    });
  });

  describe('focusable separators', () => {
    it('expose orientation and the full value triplet', () => {
      const findings = collectUnderspecifiedSeparators();

      expect(findings, `\n${reportOf(findings)}\n`).toEqual([]);
    });

    it('finds the focusable separators it is supposed to police (regex self-check)', () => {
      const focusable = SOURCES.flatMap(({ rel, source }) =>
        matchAll(source, ROLE_LITERAL)
          .filter((match) => match[2] === 'separator' && isFocusable(source, match[1]))
          .map(() => rel)
      );

      // The spacer grip and the column resizer — both drag handles with keyboard nudging.
      expect(new Set(focusable)).toEqual(new Set(['tools/spacer/index.ts', 'tools/columns-shared.ts']));
    });
  });

  describe('decorative icons', () => {
    const entries = iconMarkup();

    it('finds the icon surface to scan (guards against a broken import)', () => {
      expect(entries.length).toBeGreaterThan(100);
    });

    it.each(entries)('%s is hidden from assistive tech and not focusable', (name, markup) => {
      const tags = svgOpenTags(markup);

      expect(tags.length, `${name} exports no <svg> root`).toBeGreaterThan(0);

      const gaps = tags.flatMap(decorativeGaps);

      expect(
        gaps,
        `${name} is missing ${gaps.join(' and ')} on its <svg> root. Blok icons are decorative — ` +
          'they always sit inside a labelled control, so an exposed icon is announced as a stray ' +
          'unnamed graphic (and, without focusable="false", can become a tab stop).'
      ).toEqual([]);
    });

    it('covers SVG built at runtime too, not just the exported constants', () => {
      // buildIconColumnsCount() assembles its markup per call, so it is invisible
      // to the exported-constant scan above.
      const gaps = svgOpenTags(readFileSync(ICONS_FILE, 'utf-8')).flatMap(decorativeGaps);

      expect(gaps, 'every <svg> literal in the icons module must be aria-hidden and non-focusable').toEqual([]);
    });
  });

  describe('dialog roles', () => {
    const findings = collectNonModalDialogs();

    it('declare aria-modal, or record why they are non-modal', () => {
      const unexplained = findings.filter((finding) => !(finding.key in EXEMPT_NON_MODAL_DIALOGS));

      expect(unexplained, `\n${reportOf(unexplained)}\n`).toEqual([]);
    });

    it('carries no stale EXEMPT_NON_MODAL_DIALOGS entries', () => {
      const detected = new Set(findings.map((finding) => finding.key));
      const stale = Object.keys(EXEMPT_NON_MODAL_DIALOGS).filter((key) => !detected.has(key));

      expect(stale, 'the dialog now declares aria-modal — drop the entry').toEqual([]);
    });
  });

  describe('a11y i18n ledger', () => {
    const declared = new Set(Object.keys(parseLocale(EN_LOCALE_FILE)).filter((key) => key.startsWith('a11y.')));
    const referenced = referencedA11yKeys();

    it('has both sides of the ledger to compare (self-check)', () => {
      expect(declared.size).toBeGreaterThan(20);
      expect(referenced.size).toBeGreaterThan(20);
    });

    it('every a11y.* key used in src/ exists in en.json', () => {
      const missing = Array.from(referenced)
        .filter(([key]) => !declared.has(key))
        .map(([key, where]) => `${where} announces "${key}", which en.json does not define — ` +
          'a missing key is read out to the user verbatim');

      expect(missing).toEqual([]);
    });

    it('every a11y.* key in en.json is used in src/', () => {
      const orphans = Array.from(declared)
        .filter((key) => !referenced.has(key))
        .map((key) => `en.json defines "${key}", which nothing in src/ references — ` +
          'either wire it up or delete it (an orphan key ships to all 70 locales)');

      expect(orphans).toEqual([]);
    });
  });
});
