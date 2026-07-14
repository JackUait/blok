/**
 * Architectural enforcement: the Body-Mount Scope Law.
 *
 * The build scopes every compiled Tailwind utility AND the preflight reset to
 * `:where([data-blok-interface], [data-blok-interface] *, [data-blok-popover],
 * [data-blok-popover] *)` (scripts/scope-utilities/scope-tailwind-utilities.mjs,
 * src/styles/preflight.css). Consequence: an element appended to
 * `document.body` styled with utility classes renders UNSTYLED in a consumer
 * app unless its root carries a bare `data-blok-popover` or
 * `data-blok-interface` attribute. Note that `data-blok-popover-opened` and
 * `data-blok-top-layer` do NOT satisfy the utilities/preflight scope — the
 * latter only resolves the colors.css tokens.
 *
 * The trap: this bug is INVISIBLE in the dev playground and in e2e, because
 * `src/playground/playground.css` compiles its own UNSCOPED Tailwind whose
 * identical class names (`.text-sm`, `.rounded-lg`, …) match body-mounted
 * elements by coincidence. It only breaks on the user's side. It shipped four
 * times: the ARIA announcer, the callout emoji picker, the link hover card,
 * and the notifier toasts (plus drag previews / table drag ghosts that clone
 * utility-classed editor content to body).
 *
 * This test mechanically enforces the law:
 *
 * 1. Every .ts file under src/ (excluding the playground and stories) is
 *    scanned for `document.body.appendChild/append/prepend/insertBefore`.
 * 2. Each such file must either
 *    - itself set a scope attribute (`setAttribute('data-blok-popover'|
 *      'data-blok-interface', …)` or via `DATA_ATTR.popover|interface`), or
 *    - be exempt with `{ scopedBy }` pointing at the module that builds the
 *      mounted element AND sets the scope attribute (verified here too), or
 *    - be exempt with `{ reason }` explaining why the mounted element needs
 *      no scope (inline styles only, authored unscoped `blok-*` CSS,
 *      transient styleless node, …).
 *
 * If this test fails on your change: set a bare scope attribute on the root
 * you append to document.body (pick `data-blok-popover` for floating chrome,
 * `data-blok-interface` for everything else — clones of editor content need
 * it for their typography utilities to survive), or add an exemption with an
 * honest reason. Do NOT exempt an element styled with Tailwind utilities.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(__dirname, '../../../src');

/**
 * Matches any call that physically mounts a node onto document.body.
 */
const BODY_MOUNT_RE = /document\.body\.(?:appendChild|append|prepend|insertBefore)\s*\(/;

/**
 * Matches setting a bare scope attribute. The closing quote / comma right
 * after the attribute name is load-bearing: it rejects lookalikes such as
 * `data-blok-popover-opened` and `DATA_ATTR.popoverOpened`, which do NOT
 * satisfy the CSS scope.
 */
const SCOPE_ATTR_SET_RE =
  /setAttribute\(\s*(?:['"]data-blok-(?:popover|interface)['"]|DATA_ATTR\.(?:popover|interface)\s*,)/;

type Exemption = { reason: string } | { scopedBy: string };

/**
 * Files allowed to mount to document.body without setting a scope attribute
 * themselves. Keys are paths relative to src/. Every entry must keep an
 * honest justification — "it looks fine in the playground" is NOT one (the
 * playground's own Tailwind masks the bug).
 */
const EXEMPTIONS: Record<string, Exemption> = {
  // Mounted element is built (and scope-attributed) in another module.
  'components/utils/notifier/index.ts': { scopedBy: 'components/utils/notifier/draw.ts' },
  'components/modules/drag/DragController.ts': { scopedBy: 'components/modules/drag/preview/DragPreview.ts' },
  'tools/callout/index.ts': { scopedBy: 'tools/callout/emoji-picker/index.ts' },
  'components/utils/popover/popover-desktop.ts': { scopedBy: 'components/utils/popover/popover-abstract.ts' },

  // Genuinely scope-free mounts.
  'components/utils/announcer.ts': {
    reason: 'ARIA live region, visually hidden via inline SR_ONLY_STYLE — no class-based styling at all',
  },
  'components/utils/caret/boundaries.ts': {
    reason: 'hidden measurement div styled inline, appended and removed synchronously',
  },
  'tools/spacer/alignment-guide.ts': {
    reason: 'guide line styled 100% inline (accent color resolved to a literal beforehand)',
  },
  'tools/database/database-card-drag.ts': {
    reason: 'ghost styled inline; cloned card content styled by unscoped attribute CSS (database.css), not utilities',
  },
  'tools/database/database-list-row-drag.ts': {
    reason: 'ghost styled inline; cloned row content styled by unscoped attribute CSS (database.css), not utilities',
  },
  'tools/database/database-column-drag.ts': {
    reason: 'ghost styled inline; cloned column content styled by unscoped attribute CSS (database.css), not utilities',
  },
  'tools/image/ui.ts': {
    reason: 'lightbox styled by authored blok-image-lightbox BEM classes (unscoped) + colors.css tokens via data-blok-top-layer',
  },
  'tools/audio/cover-picker.ts': {
    reason: 'dialog styled by authored blok-audio-cover-picker / blok-media-empty BEM classes (unscoped)',
  },
  'tools/image/download.ts': { reason: 'transient styleless <a download> clicked and removed' },
  'tools/video/index.ts': { reason: 'transient styleless <a download> clicked and removed' },
  'tools/audio/index.ts': { reason: 'transient styleless <a download> clicked and removed' },
};

const collectTsFiles = (dir: string): string[] => {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      return collectTsFiles(full);
    }

    return full.endsWith('.ts') && !full.endsWith('.stories.ts') ? [full] : [];
  });
};

const isExcluded = (relPath: string): boolean => {
  return relPath.startsWith('playground/') || relPath.startsWith('stories/');
};

describe('Body-Mount Scope Law', () => {
  const files = collectTsFiles(SRC_DIR)
    .map((file) => ({ file, rel: relative(SRC_DIR, file) }))
    .filter(({ rel }) => !isExcluded(rel));

  const bodyMountFiles = files.filter(({ file }) => BODY_MOUNT_RE.test(readFileSync(file, 'utf8')));

  it('finds body-mount sites at all (guard against the scan silently matching nothing)', () => {
    expect(bodyMountFiles.length).toBeGreaterThan(0);
  });

  it.each(bodyMountFiles.map(({ rel }) => [rel]))(
    '%s mounts to document.body only with a scope attribute or an exemption',
    (rel) => {
      const source = readFileSync(join(SRC_DIR, rel), 'utf8');
      const exemption = EXEMPTIONS[rel];

      if (exemption === undefined) {
        expect(
          SCOPE_ATTR_SET_RE.test(source),
          `${rel} appends to document.body but never sets a bare data-blok-popover/data-blok-interface ` +
            'scope attribute. Scoped Tailwind utilities and the preflight reset will NOT apply to that ' +
            'element in consumer apps (the playground masks this — see body-mount-scope-law header). ' +
            'Set the attribute on the mounted root, or add an exemption with a reason.'
        ).toBe(true);

        return;
      }

      if ('scopedBy' in exemption) {
        const builderSource = readFileSync(join(SRC_DIR, exemption.scopedBy), 'utf8');

        expect(
          SCOPE_ATTR_SET_RE.test(builderSource),
          `${rel} is exempt via scopedBy=${exemption.scopedBy}, but that module does not set a bare ` +
            'data-blok-popover/data-blok-interface scope attribute — the exemption is stale or the fix regressed.'
        ).toBe(true);
      }
    }
  );

  it('has no stale exemptions (every exempt file still mounts to document.body)', () => {
    const mounted = new Set(bodyMountFiles.map(({ rel }) => rel));
    const stale = Object.keys(EXEMPTIONS).filter((rel) => !mounted.has(rel));

    expect(stale, `Exempt files no longer mount to document.body — remove them: ${stale.join(', ')}`).toEqual([]);
  });
});
