/**
 * Architectural enforcement: root floating surfaces have one coordinate-space
 * contract.
 *
 * `getBoundingClientRect()` returns viewport coordinates. A body/top-layer
 * surface can therefore repeat the bookmark-menu bug whenever it treats the
 * CSS box of body/html as a viewport, adds scroll twice (or not at all), or
 * remains open while a nested scroller moves its anchor.
 *
 * This law deliberately combines three discovery routes:
 *
 * 1. every physical body/html mount is classified, including split builder /
 *    positioner implementations;
 * 2. every manual root-positioning candidate is classified;
 * 3. every shared positioning helper and PopoverDesktop consumer is
 *    fingerprinted.
 *
 * A new path must therefore either use the shared engine or stop here for an
 * explicit, reviewed interaction contract. The exact registries are also
 * checked for stale entries so the scan cannot pass through an ever-growing
 * whitelist.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(__dirname, '../../../src');

const collectSourceFiles = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
  const fullPath = join(dir, entry);

  if (statSync(fullPath).isDirectory()) {
    return collectSourceFiles(fullPath);
  }

  return /\.tsx?$/.test(fullPath) && !/\.stories\.tsx?$/.test(fullPath) ? [fullPath] : [];
});

const sources = new Map(
  collectSourceFiles(SRC_DIR)
    .map((file) => [relative(SRC_DIR, file), readFileSync(file, 'utf8')] as const)
    .filter(([relPath]) => !relPath.startsWith('playground/') && !relPath.startsWith('stories/'))
);

const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

/** Physical root mounts, including Tooltip's small append(document.body) wrapper. */
const ROOT_MOUNT_RE = /(?:document\.(?:body|documentElement)\.(?:appendChild|append|prepend|insertBefore)\s*\(|(?:this\.)?append\(\s*document\.(?:body|documentElement)\b)/;

/**
 * Heuristic for hand-positioned root UI. It intentionally over-matches drag
 * ghosts and guides; those are classified below so a new false positive still
 * creates the desired review point instead of weakening discovery.
 */
const isManualRootPositioningCandidate = (rawSource: string): boolean => {
  const source = stripComments(rawSource);
  const readsViewportGeometry = /getBoundingClientRect\s*\(\s*\)/.test(source);
  const writesCoordinates = /(?:\.style\.(?:top|left)\s*=|\.style\.setProperty\(\s*['"](?:top|left)['"])/.test(source);
  const hasRootSignal = /(?:document\.(?:body|documentElement)\.(?:appendChild|append|prepend|insertBefore)\s*\(|(?:this\.)?append\(\s*document\.(?:body|documentElement)\b|promoteToTopLayer\s*\(|['"`]fixed\b|position\s*=\s*['"]fixed['"])/.test(source);

  return readsViewportGeometry && writesCoordinates && hasRootSignal;
};

/** Every physical root mount must remain present here with an honest purpose. */
const ROOT_MOUNT_CLASSIFICATIONS: Record<string, string> = {
  'components/modules/drag/DragController.ts': 'Pointer-following drag preview; coordinates are refreshed by every pointermove.',
  'components/utils/announcer.ts': 'Visually hidden ARIA live region; it is not positioned against an anchor.',
  'components/utils/caret/boundaries.ts': 'Synchronous hidden text measurement node; it is removed before control returns.',
  'components/utils/link-hover-card.ts': 'Tracked root surface registered in ROOT_SURFACE_CONTRACTS.',
  'components/utils/notifier/index.ts': 'Viewport toast region with no element anchor or collision boundary.',
  'components/utils/popover/popover-abstract.ts': 'Root mount primitive; PopoverDesktop owns positioning and tracking.',
  'components/utils/popover/popover-desktop.ts': 'Shared root surface registered in ROOT_SURFACE_CONTRACTS.',
  'components/utils/tooltip.ts': 'Dismiss-on-scroll root surface registered in ROOT_SURFACE_CONTRACTS.',
  'tools/audio/cover-picker.ts': 'Shared anchored root surface registered in ROOT_SURFACE_CONTRACTS.',
  'tools/audio/index.ts': 'Transient styleless download anchor, clicked and removed synchronously.',
  'tools/callout/index.ts': 'Mount owner for the tracked emoji-picker root surface.',
  'tools/database/database-card-drag.ts': 'Pointer-following database card ghost, refreshed by every pointermove.',
  'tools/database/database-column-drag.ts': 'Pointer-following database column ghost, refreshed by every pointermove.',
  'tools/database/database-list-row-drag.ts': 'Pointer-following database row ghost, refreshed by every pointermove.',
  'tools/database/database-property-type-popover.ts': 'Shared anchored root surface registered in ROOT_SURFACE_CONTRACTS.',
  'tools/database/database-tab-bar.ts': 'Shared anchored overflow menu plus PopoverDesktop consumer.',
  'tools/image/download.ts': 'Transient styleless download anchor, clicked and removed synchronously.',
  'tools/image/ui.ts': 'Modal lightbox; viewport overlay is not positioned against a live anchor.',
  'tools/spacer/alignment-guide.ts': 'Pointer-driven fixed guide; its viewport coordinates are supplied on every drag update.',
  'tools/table/table-row-col-drag.ts': 'Pointer-following table ghost and indicator, refreshed by every pointermove.',
  'tools/video/index.ts': 'Transient styleless download anchor, clicked and removed synchronously.',
};

type SurfaceContract = 'shared' | 'popover-core' | 'tracked-manual' | 'dismiss-on-scroll';

const ROOT_SURFACE_CONTRACTS: Record<string, SurfaceContract> = {
  'components/utils/link-hover-card.ts': 'tracked-manual',
  'components/utils/popover/popover-desktop.ts': 'popover-core',
  'components/utils/tooltip.ts': 'dismiss-on-scroll',
  'tools/audio/cover-picker.ts': 'shared',
  'tools/callout/emoji-picker/index.ts': 'tracked-manual',
  'tools/database/database-property-type-popover.ts': 'shared',
  'tools/database/database-tab-bar.ts': 'shared',
  'tools/image/alt-popover.ts': 'shared',
};

/** Expected over-matches from the broad manual-root heuristic. */
const MANUAL_ROOT_CANDIDATES = [
  'components/utils/link-hover-card.ts',
  'components/utils/popover/anchored-position.ts',
  'components/utils/popover/popover-desktop.ts',
  'components/utils/tooltip.ts',
  'tools/callout/emoji-picker/index.ts',
  'tools/database/database-card-drag.ts',
  'tools/database/database-column-drag.ts',
  'tools/database/database-list-row-drag.ts',
  'tools/database/database-tab-bar.ts',
  'tools/spacer/alignment-guide.ts',
  'tools/table/table-row-col-drag.ts',
].sort();

const SHARED_POSITION_CALLERS = [
  'tools/audio/cover-picker.ts',
  'tools/database/database-property-type-popover.ts',
  'tools/database/database-tab-bar.ts',
  'tools/image/alt-popover.ts',
].sort();

const POPOVER_DESKTOP_CONSUMERS = [
  'components/modules/toolbar/blockSettings.ts',
  'components/ui/toolbox.ts',
  'tools/code/index.ts',
  'tools/database/database-tab-bar.ts',
  'tools/database/database-view-popover.ts',
  'tools/database/index.ts',
  'tools/link/paste-menu/controller.ts',
  'tools/table/table-cell-selection.ts',
  'tools/table/table-row-col-popover.ts',
].sort();

describe('Floating Positioning Law', () => {
  it('detects an unsafe synthetic body-mounted anchor path (mutation guard)', () => {
    const unsafe = `
      const menu = document.createElement('div');
      document.body.appendChild(menu);
      const rect = anchor.getBoundingClientRect();
      menu.style.top = rect.bottom + 'px';
      menu.style.left = rect.left + 'px';
    `;
    const local = `
      localContainer.appendChild(menu);
      const rect = anchor.getBoundingClientRect();
      menu.style.top = rect.bottom + 'px';
      menu.style.left = rect.left + 'px';
    `;

    expect(isManualRootPositioningCandidate(unsafe)).toBe(true);
    expect(isManualRootPositioningCandidate(local)).toBe(false);
  });

  it('classifies every physical body/html mount and has no stale classifications', () => {
    const discovered = [...sources]
      .filter(([, source]) => ROOT_MOUNT_RE.test(stripComments(source)))
      .map(([relPath]) => relPath)
      .sort();

    expect(discovered).toEqual(Object.keys(ROOT_MOUNT_CLASSIFICATIONS).sort());
    Object.entries(ROOT_MOUNT_CLASSIFICATIONS).forEach(([relPath, reason]) => {
      expect(reason.length, `${relPath} needs a meaningful classification`).toBeGreaterThan(40);
    });
  });

  it('classifies every hand-positioned root candidate exactly', () => {
    const discovered = [...sources]
      .filter(([, source]) => isManualRootPositioningCandidate(source))
      .map(([relPath]) => relPath)
      .sort();

    expect(discovered).toEqual(MANUAL_ROOT_CANDIDATES);
  });

  it('requires every shared anchored-position caller to stay inventoried', () => {
    const discovered = [...sources]
      .filter(([relPath, source]) => relPath !== 'components/utils/popover/anchored-position.ts'
        && /\bposition(?:Fixed)?Anchored\s*\(/.test(stripComments(source)))
      .map(([relPath]) => relPath)
      .sort();

    expect(discovered).toEqual(SHARED_POSITION_CALLERS);
  });

  it('requires every root surface to retain its tracking or dismissal contract', () => {
    Object.entries(ROOT_SURFACE_CONTRACTS).forEach(([relPath, contract]) => {
      const source = stripComments(sources.get(relPath) ?? '');

      expect(source.length, `${relPath} disappeared; remove or update its contract`).toBeGreaterThan(0);

      if (contract === 'shared') {
        expect(source, `${relPath} must use the shared placement engine`).toMatch(/\bposition(?:Fixed)?Anchored\s*\(/);
        expect(source, `${relPath} must track scroll/resize while open`).toMatch(/\bcreatePositionTracker\s*\(/);
      } else if (contract === 'popover-core') {
        expect(source).toMatch(/\bresolveBoundaryRect\s*\(/);
        expect(source).toMatch(/\bcreatePositionTracker\s*\(/);
      } else if (contract === 'tracked-manual') {
        expect(source, `${relPath} must track scroll/resize while open`).toMatch(/\bcreatePositionTracker\s*\(/);
      } else {
        expect(source, `${relPath} must observe non-bubbling nested scrolls`).toMatch(
          /addEventListener\(\s*['"]scroll['"][\s\S]*?capture\s*:\s*true/
        );
      }
    });
  });

  it('fingerprints every PopoverDesktop consumer for explicit audit review', () => {
    const discovered = [...sources]
      .filter(([relPath, source]) => !relPath.startsWith('components/utils/popover/')
        && /\bPopoverDesktop\b/.test(stripComments(source)))
      .map(([relPath]) => relPath)
      .sort();

    expect(discovered).toEqual(POPOVER_DESKTOP_CONSUMERS);
  });

  it('keeps virtual anchors tied to live context or fail-closed on nested scroll', () => {
    const popoverSource = stripComments(sources.get('components/utils/popover/popover-desktop.ts') ?? '');
    const blockSettingsSource = stripComments(sources.get('components/modules/toolbar/blockSettings.ts') ?? '');
    const toolboxSource = stripComments(sources.get('components/ui/toolbox.ts') ?? '');

    expect(popoverSource).toMatch(/hasMeasurablePositionContext\s*\(\s*\)/);
    expect(popoverSource).toMatch(
      /nestedScrollerMoved[\s\S]*hasUntrackableVirtualAnchor[\s\S]*this\.hide\s*\(\s*\)/
    );
    expect(blockSettingsSource).toMatch(
      /positionContext\s*:\s*anchorRect\s*===\s*undefined\s*\?\s*undefined\s*:\s*block\.holder/
    );
    expect(toolboxSource).toMatch(
      /updatePosition\s*\(\s*anchorRect\s*,\s*currentBlock\?\.holder\s*\)/
    );
  });

  it('never reads body/html CSS geometry as a collision viewport', () => {
    const violations = [...sources].flatMap(([relPath, source]) => {
      const geometryReads = stripComments(source).match(/document\.(?:body|documentElement)\.getBoundingClientRect\s*\(/g) ?? [];

      return geometryReads.map(() => relPath);
    });

    expect(violations).toEqual([]);

    const popoverSource = stripComments(sources.get('components/utils/popover/popover-desktop.ts') ?? '');

    expect(popoverSource).not.toMatch(/scopeElement\.getBoundingClientRect\s*\(/);
  });
});
