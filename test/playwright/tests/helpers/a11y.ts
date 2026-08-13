import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * axe-core is only a TRANSITIVE dependency (`@axe-core/playwright` owns it), and
 * `import/no-extraneous-dependencies` is an error in this repo — so its result
 * types cannot be imported by name. Derive them from the builder's own signature.
 */
type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;
type AxeViolation = AxeResults['violations'][number];

export type A11yImpact = NonNullable<AxeViolation['impact']>;

/**
 * The impacts that fail a scan by default. `moderate`/`minor` are reported in
 * the failure message when something else already failed, but do not gate on
 * their own — that threshold is what the pre-existing table scans used and
 * widening it would turn every new scan red on day one.
 */
export const HIGH_IMPACT: readonly A11yImpact[] = ['critical', 'serious'];

export interface A11yScanOptions {
  /** Restrict the scan to these selectors. Omit to scan the whole document. */
  include?: string | string[];
  exclude?: string | string[];
  /** Impacts that fail the assertion. Defaults to {@link HIGH_IMPACT}. */
  failOn?: readonly A11yImpact[];
  /**
   * axe rule ids to switch off, each mapped to WHY. A reason is mandatory so a
   * disabled rule can never be read as "this surface is clean".
   */
  disableRules?: Record<string, string>;
  /** Restrict to specific axe tag sets, e.g. ['wcag2a', 'wcag2aa']. */
  withTags?: string[];
}

const toArray = (value: string | string[] | undefined): string[] => {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

/**
 * Render violations so a red build is actionable without re-running locally:
 * rule id, impact, the axe help URL, and every offending node's target + markup.
 */
export const formatViolations = (violations: AxeViolation[]): string => {
  if (violations.length === 0) {
    return 'no violations';
  }

  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `      at ${node.target.join(' ')}\n        ${node.html.slice(0, 240)}`)
        .join('\n');

      return `  [${violation.impact ?? 'unknown'}] ${violation.id} — ${violation.help}\n    ${violation.helpUrl}\n${nodes}`;
    })
    .join('\n\n');
};

/**
 * Run axe against the page (or a subtree of it) and return every violation it
 * found, unfiltered. Use {@link expectNoA11yViolations} unless a spec needs to
 * assert something more specific than "clean".
 */
export const runA11yScan = async (page: Page, options: A11yScanOptions = {}): Promise<AxeViolation[]> => {
  let builder = new AxeBuilder({ page });

  for (const selector of toArray(options.include)) {
    builder = builder.include(selector);
  }

  for (const selector of toArray(options.exclude)) {
    builder = builder.exclude(selector);
  }

  if (options.withTags !== undefined && options.withTags.length > 0) {
    builder = builder.withTags(options.withTags);
  }

  const disabled = Object.keys(options.disableRules ?? {});

  if (disabled.length > 0) {
    builder = builder.disableRules(disabled);
  }

  const { violations } = await builder.analyze();

  return violations;
};

/**
 * Assert a surface has no accessibility violations at or above the failing
 * impact threshold.
 */
export const expectNoA11yViolations = async (
  page: Page,
  options: A11yScanOptions & { label?: string } = {}
): Promise<void> => {
  const failOn = options.failOn ?? HIGH_IMPACT;
  const violations = await runA11yScan(page, options);
  // axe types `impact` as nullable — a violation with no impact is never a
  // threshold match, so drop it rather than widening A11yImpact to include null.
  const failing = violations.filter(
    ({ impact }) => impact !== null && impact !== undefined && failOn.includes(impact)
  );

  const scope = options.label ?? toArray(options.include).join(', ') ?? 'document';
  const waived = Object.entries(options.disableRules ?? {})
    .map(([rule, reason]) => `  waived: ${rule} — ${reason}`)
    .join('\n');

  const message = [
    `${failing.length} ${failOn.join('/')} accessibility violation(s) in ${scope}:`,
    formatViolations(failing),
    waived,
  ]
    .filter(Boolean)
    .join('\n');

  expect(failing.map(({ id }) => id), message).toStrictEqual([]);
};

/**
 * Roles whose whole purpose is to be activated. An unnamed one is unusable by
 * anyone navigating by voice or by a screen reader's control list.
 *
 * `textbox`/`searchbox` are deliberately absent: Blok's editable blocks are
 * contenteditable hosts named by surrounding context, and axe's own form-label
 * rules already cover real inputs.
 */
export const NAMEABLE_CONTROL_ROLES = [
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
] as const;

/**
 * Every control a user can reach must expose a non-empty accessible name.
 *
 * Reads Playwright's own ARIA snapshot rather than poking at attributes, so the
 * name is computed the way a browser's accessibility layer computes it —
 * `aria-label`, `aria-labelledby`, wrapped text, nested `img[alt]`, and
 * `title` fallback all resolve for free. In that format a named control prints
 * as `- button "Move up"` and an unnamed one as bare `- button`.
 *
 * Reports every offender at once instead of failing on the first.
 */
export const expectEveryControlIsNamed = async (
  scope: Locator,
  roles: readonly string[] = NAMEABLE_CONTROL_ROLES
): Promise<void> => {
  const snapshot = await scope.ariaSnapshot();

  const unnamed = snapshot
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      const match = /^- ([a-z]+)(.*)$/.exec(line);

      if (match === null) {
        return false;
      }

      const [, role, rest] = match;

      if (!roles.includes(role)) {
        return false;
      }

      // `- button "Save"` is named; `- button`, `- button:` and
      // `- button [disabled]` are not.
      return !rest.trimStart().startsWith('"');
    });

  expect(
    unnamed,
    `Controls with no accessible name:\n${unnamed.join('\n')}\n\nFull ARIA snapshot:\n${snapshot}`
  ).toStrictEqual([]);
};

/**
 * Assert the page exposes exactly one element with a given role, and return it.
 * Guards the duplicate-live-region class of bug, where a leaked or second editor
 * instance makes announcements ambiguous.
 */
export const expectSingleByRole = async (
  page: Page,
  role: Parameters<Page['getByRole']>[0]
): Promise<Locator> => {
  const matches = page.getByRole(role);

  await expect(matches, `expected exactly one "${role}" on the page`).toHaveCount(1);

  return matches.first();
};
