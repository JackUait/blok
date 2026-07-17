/**
 * Architectural enforcement: root floating surfaces have one explicit
 * coordinate-space and movement-lifecycle contract.
 *
 * Discovery is syntax-aware. The analyzer follows ordinary root/style aliases,
 * computed properties, local mount helpers, constructor aliases, dynamic style
 * APIs, and TSX. Exact bidirectional registries turn every newly discovered
 * path into a mandatory review point instead of a silently growing allowlist.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  analyzeFloatingSource,
  type FloatingEvidence,
  type FloatingEvidenceKind,
} from './floating-positioning-analyzer';

const SRC_DIR = resolve(__dirname, '../../../src');

const collectSourceFiles = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
  const fullPath = join(dir, entry);

  if (statSync(fullPath).isDirectory()) {
    return collectSourceFiles(fullPath);
  }

  const isTypeScript = fullPath.endsWith('.ts') || fullPath.endsWith('.tsx');
  const isStory = fullPath.endsWith('.stories.ts') || fullPath.endsWith('.stories.tsx');

  return isTypeScript && !isStory ? [fullPath] : [];
});

interface SourceAnalysis {
  source: string;
  evidence: FloatingEvidence[];
}

const analyses = new Map<string, SourceAnalysis>(
  collectSourceFiles(SRC_DIR)
    .map((file): [string, SourceAnalysis] => {
      const relPath = relative(SRC_DIR, file);
      const source = readFileSync(file, 'utf8');

      return [relPath, {
        source,
        evidence: analyzeFloatingSource(source, relPath),
      }];
    })
    .filter(([relPath]) =>
      !relPath.startsWith('playground/')
      && !relPath.startsWith('stories/'))
);

const hasEvidence = (
  analysis: SourceAnalysis,
  kind: FloatingEvidenceKind
): boolean => analysis.evidence.some((item) => item.kind === kind);

const filesWith = (kind: FloatingEvidenceKind): string[] => [...analyses]
  .filter(([, analysis]) => hasEvidence(analysis, kind))
  .map(([relPath]) => relPath)
  .sort();

const filesWithAll = (...kinds: FloatingEvidenceKind[]): string[] => [...analyses]
  .filter(([, analysis]) => kinds.every((kind) => hasEvidence(analysis, kind)))
  .map(([relPath]) => relPath)
  .sort();

const expectExactReasonedClassification = (
  discovered: string[],
  classifications: Record<string, string>
): void => {
  expect(discovered).toEqual(Object.keys(classifications).sort());

  Object.entries(classifications).forEach(([relPath, reason]) => {
    expect(reason.length, `${relPath} needs a meaningful classification`)
      .toBeGreaterThan(40);
  });
};

/** Every physical document-root mount and its non-positioning or safe contract. */
const ROOT_MOUNT_CLASSIFICATIONS: Record<string, string> = {
  'components/modules/drag/DragController.ts': 'Pointer-following drag preview; coordinates refresh on every pointer move.',
  'components/utils/announcer.ts': 'Visually hidden ARIA live region with no element anchor or collision boundary.',
  'components/utils/caret/boundaries.ts': 'Synchronous hidden text-measurement node removed before control returns.',
  'components/utils/link-hover-card.ts': 'Tracked fixed root surface registered in ROOT_SURFACE_CONTRACTS.',
  'components/utils/notifier/index.ts': 'Viewport toast region with no live element anchor or collision calculation.',
  'components/utils/popover/popover-abstract.ts': 'Root mount primitive whose desktop subclass owns positioning and tracking.',
  'components/utils/popover/popover-desktop.ts': 'Shared root implementation registered in ROOT_SURFACE_CONTRACTS.',
  'components/utils/tooltip.ts': 'Dismiss-on-scroll fixed surface registered in ROOT_SURFACE_CONTRACTS.',
  'tools/audio/cover-picker.ts': 'Shared anchored root surface registered in ROOT_SURFACE_CONTRACTS.',
  'tools/audio/index.ts': 'Transient styleless download anchor clicked and removed synchronously.',
  'tools/callout/index.ts': 'Mount owner for the tracked emoji-picker root surface.',
  'tools/database/database-card-drag.ts': 'Pointer-following database card ghost refreshed on every pointer move.',
  'tools/database/database-column-drag.ts': 'Pointer-following database column ghost refreshed on every pointer move.',
  'tools/database/database-list-row-drag.ts': 'Pointer-following database row ghost refreshed on every pointer move.',
  'tools/database/database-property-type-popover.ts': 'Shared anchored root surface registered in ROOT_SURFACE_CONTRACTS.',
  'tools/database/database-tab-bar.ts': 'Shared anchored overflow menu plus a tracked drag ghost and popover consumer.',
  'tools/image/download.ts': 'Transient styleless download anchor clicked and removed synchronously.',
  'tools/image/ui.ts': 'Viewport modal lightbox, not a surface positioned against a live anchor.',
  'tools/spacer/alignment-guide.ts': 'Pointer-driven fixed guide whose coordinates refresh throughout the drag.',
  'tools/table/table-row-col-drag.ts': 'Pointer-following table ghost and indicator refreshed on every pointer move.',
  'tools/video/index.ts': 'Transient styleless download anchor clicked and removed synchronously.',
};

/**
 * Every file that both reads live geometry and writes top/left is reviewed,
 * even when it is locally contained rather than root mounted.
 */
const MANUAL_POSITION_CLASSIFICATIONS: Record<string, string> = {
  'components/modules/drag/preview/DragPreview.ts': 'Fixed pointer-following preview; root coordinates refresh on every drag pointer update.',
  'components/modules/drag/utils/ColumnDropAnimation.ts': 'Ephemeral fixed drag preview animates to a viewport target rect and is then removed.',
  'components/modules/rectangleSelection.ts': 'Selection rectangle converts pointer coordinates into its measured local overlay container.',
  'components/modules/toolbar/index.ts': 'Editor-owned toolbar wrapper uses locally resolved offsets supplied by the toolbar positioner.',
  'components/modules/toolbar/positioning.ts': 'Toolbar geometry is converted into offsets local to the editor-owned wrapper.',
  'components/utils/link-hover-card.ts': 'Fixed top-layer hover card continuously tracks its live anchor and viewport bounds.',
  'components/utils/popover/anchored-position.ts': 'Shared coordinate-space engine and the only approved root anchored style writer.',
  'components/utils/popover/popover-desktop.ts': 'Shared root popover delegates boundary resolution and continuously tracks movement.',
  'components/utils/popover/popover-inline.ts': 'Inline and nested popovers write offsets inside their own local positioned wrappers.',
  'components/utils/tooltip.ts': 'Fixed tooltip uses viewport coordinates and intentionally dismisses on capture-phase scroll.',
  'tools/callout/emoji-picker/index.ts': 'Fixed-backdrop picker continuously repositions from its live callout anchor.',
  'tools/database/database-card-drag.ts': 'Fixed pointer-following card ghost refreshes coordinates on every drag pointer move.',
  'tools/database/database-column-drag.ts': 'Fixed pointer-following column ghost refreshes coordinates on every drag pointer move.',
  'tools/database/database-list-row-drag.ts': 'Fixed pointer-following row ghost refreshes coordinates on every drag pointer move.',
  'tools/database/database-tab-bar.ts': 'Overflow menu uses shared fixed placement; its separate ghost follows pointer movement.',
  'tools/image/crop-editor.ts': 'Crop handles use percentage offsets local to the measured crop frame.',
  'tools/spacer/alignment-guide.ts': 'Fixed alignment guide receives fresh viewport coordinates throughout pointer dragging.',
  'tools/table/table-add-controls.ts': 'Add controls convert measured table geometry into offsets local to the table wrapper.',
  'tools/table/table-cell-selection.ts': 'Selection overlay and pill convert cell rects into the table grid local coordinate space.',
  'tools/table/table-row-col-controls.ts': 'Row and column grips convert cell rects into offsets local to their table overlay.',
  'tools/table/table-row-col-drag.ts': 'Fixed ghost follows pointer coordinates while the local drop indicator uses table offsets.',
};

/** Dynamic property setters remain exact review points, never silent escapes. */
const DYNAMIC_STYLE_ACCESS_CLASSIFICATIONS: Record<string, string> = {
  'components/inline-tools/inline-tool-marker.ts': 'Copies allowlisted inline style properties and CSS custom properties during marker splitting.',
  'components/utils/color-migration.ts': 'Writes a validated CSS custom-property name during legacy color migration.',
  'components/utils/notifier/draw.ts': 'Writes notifier CSS custom properties selected by the notifier layout implementation.',
  'components/utils/popover/popover-desktop.ts': 'Writes named popover CSS variables; physical top/left placement stays inventoried separately.',
  'components/utils/popover/popover-inline.ts': 'Writes named inline-popover CSS variables inside its local positioned wrapper.',
  'components/utils/tooltip.ts': 'Writes named tooltip CSS custom properties and dismisses on capture-phase scrolling.',
};

const SHARED_POSITION_CALL_CLASSIFICATIONS: Record<string, string> = {
  'components/utils/popover/anchored-position.ts': 'Defines the shared document and fixed coordinate-space placement adapters.',
  'components/utils/popover/popover-desktop.ts': 'Uses shared boundary resolution and position tracking for root popovers.',
  'tools/audio/cover-picker.ts': 'Uses shared absolute anchored placement and continuous position tracking.',
  'tools/database/database-property-type-popover.ts': 'Uses shared fixed anchored placement and continuous position tracking.',
  'tools/database/database-tab-bar.ts': 'Uses shared fixed anchored placement and continuous position tracking.',
  'tools/image/alt-popover.ts': 'Uses shared fixed anchored placement and continuous position tracking.',
  'tools/table/table-operations.ts': 'Uses the shared pure resolver for a locally-contained table operation surface.',
};

const CAPTURE_SCROLL_CLASSIFICATIONS: Record<string, string> = {
  'components/utils/tooltip.ts': 'Capture-phase scroll listener intentionally dismisses the snapshot tooltip.',
  'tools/file/preview-scroll-haze.ts': 'Capture-phase listener refreshes local file-preview scroll haze state.',
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

const TRACKED_VIRTUAL_POSITION_CLASSIFICATIONS: Record<string, string> = {
  'components/modules/toolbar/blockSettings.ts': 'Context-menu and keyboard rectangles track the active block holder.',
  'components/ui/toolbox.ts': 'Caret and slash-search rectangles track the current block holder.',
  'tools/link/paste-menu/controller.ts': 'Link-end rectangles track the inserted link block holder while open.',
};

const DISMISSIBLE_VIRTUAL_POSITION_CLASSIFICATIONS: Record<string, string> = {
  'components/ui/toolbox.ts': 'Missing-block fallback explicitly dismisses if nested scrolling invalidates the snapshot.',
  'tools/link/paste-menu/controller.ts': 'Missing-trigger fallback explicitly dismisses if nested scrolling invalidates the snapshot.',
};

describe('Floating Positioning Law', () => {
  it('routes an adversarial aliased root surface into every required review path', () => {
    const evidence = analyzeFloatingSource(`
      const root = document.body;
      const menu = document.createElement('div');
      root['appendChild'](menu);
      const rect = anchor.getBoundingClientRect();
      const style = menu.style;
      style['top'] = rect.bottom + 'px';
      style['left'] = rect.left + 'px';
    `);
    const kinds = new Set(evidence.map(({ kind }) => kind));

    expect(kinds).toContain('root-mount');
    expect(kinds).toContain('geometry-read');
    expect(kinds).toContain('coordinate-write');
  });

  it('classifies every physical body/html mount exactly', () => {
    expectExactReasonedClassification(
      filesWith('root-mount'),
      ROOT_MOUNT_CLASSIFICATIONS
    );
  });

  it('classifies every manual geometry-to-coordinate path exactly', () => {
    expectExactReasonedClassification(
      filesWithAll('geometry-read', 'coordinate-write'),
      MANUAL_POSITION_CLASSIFICATIONS
    );
  });

  it('classifies every dynamic root/style access exactly', () => {
    expectExactReasonedClassification(
      filesWith('dynamic-root-style-access'),
      DYNAMIC_STYLE_ACCESS_CLASSIFICATIONS
    );
  });

  it('never reads body/html CSS geometry as a collision viewport', () => {
    expect(filesWith('root-geometry-read')).toEqual([]);
  });

  it('classifies every shared placement-engine caller exactly', () => {
    expectExactReasonedClassification(
      filesWith('shared-position-call'),
      SHARED_POSITION_CALL_CLASSIFICATIONS
    );
  });

  it('classifies every capture-phase scroll listener exactly', () => {
    expectExactReasonedClassification(
      filesWith('capture-scroll-listener'),
      CAPTURE_SCROLL_CLASSIFICATIONS
    );
  });

  it('requires every root surface to retain tracking or dismissal evidence', () => {
    Object.entries(ROOT_SURFACE_CONTRACTS).forEach(([relPath, contract]) => {
      const analysis = analyses.get(relPath);

      expect(analysis, `${relPath} disappeared; update its contract`).toBeDefined();

      if (analysis === undefined) {
        return;
      }

      if (contract === 'shared' || contract === 'popover-core') {
        expect(hasEvidence(analysis, 'shared-position-call'), relPath).toBe(true);
        expect(hasEvidence(analysis, 'position-tracker-call'), relPath).toBe(true);

        return;
      }

      if (contract === 'tracked-manual') {
        expect(hasEvidence(analysis, 'position-tracker-call'), relPath).toBe(true);

        return;
      }

      expect(hasEvidence(analysis, 'capture-scroll-listener'), relPath).toBe(true);
    });
  });

  it('fingerprints every external PopoverDesktop construction path exactly', () => {
    const discovered = filesWith('popover-desktop-construction')
      .filter((relPath) => !relPath.startsWith('components/utils/popover/'));

    expect(discovered).toEqual(POPOVER_DESKTOP_CONSUMERS);
  });

  it('requires every production virtual anchor to declare its lifecycle', () => {
    expect(filesWith('unclassified-virtual-position')).toEqual([]);
    expectExactReasonedClassification(
      filesWith('tracked-virtual-position'),
      TRACKED_VIRTUAL_POSITION_CLASSIFICATIONS
    );
    expectExactReasonedClassification(
      filesWith('dismissible-virtual-position'),
      DISMISSIBLE_VIRTUAL_POSITION_CLASSIFICATIONS
    );
  });
});
