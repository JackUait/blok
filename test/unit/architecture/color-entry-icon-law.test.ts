/**
 * Every menu entry that opens a color picker shows IconPaintRoller.
 *
 * The "A" glyph was drawn in four separate places (inline marker, both table
 * color menus, block settings), so fixing one left the rest. Every file that
 * calls a color-picker factory must be listed in SITES. An unlisted caller
 * fails here until someone decides which icon its entry shows.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as icons from '../../../src/components/icons';
import { IconPaintRoller } from '../../../src/components/icons';
import { buildBlockColorTunes } from '../../../src/components/shared/block-color';
import { MarkerInlineTool } from '../../../src/components/inline-tools/inline-tool-marker';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SRC_DIR = join(REPO_ROOT, 'src');

/** A call, not the declaration (`function createColorPicker(` is skipped). */
const FACTORY_CALL = /(?<!function\s)\b(?:createColorPicker|createCellColorPicker|buildBlockColorTunes)\(/;

type Site = { builds: 'entry' } | { inherits: string };

const SITES: Record<string, Site> = {
  'src/components/inline-tools/inline-tool-marker.ts': { builds: 'entry' },
  'src/components/shared/block-color.ts': { builds: 'entry' },
  'src/tools/callout/index.ts': { builds: 'entry' },
  'src/tools/table/table-row-col-popover.ts': { builds: 'entry' },
  'src/tools/table/table-cell-selection.ts': { builds: 'entry' },
  'src/tools/table/table-cell-color-picker.ts': { inherits: 'wraps the picker element; the two table menus build the entry' },
  'src/tools/paragraph/index.ts': { inherits: 'buildBlockColorTunes builds the entry' },
  'src/tools/header/index.ts': { inherits: 'buildBlockColorTunes builds the entry' },
  'src/tools/toggle/index.ts': { inherits: 'buildBlockColorTunes builds the entry' },
  'src/tools/page/index.ts': { inherits: 'buildBlockColorTunes builds the entry' },
  'src/tools/table-of-contents/index.ts': { inherits: 'buildBlockColorTunes builds the entry' },
};

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return walk(path);
    }

    return path.endsWith('.ts') ? [path] : [];
  });

const callers = (): string[] =>
  walk(SRC_DIR)
    .filter((path) => FACTORY_CALL.test(readFileSync(path, 'utf8')))
    .map((path) => relative(REPO_ROOT, path))
    .sort();

const i18n = { t: (key: string) => key, has: () => true } as never;

describe('color entry icon law', () => {
  it('ships no letter-A color icon', () => {
    expect(Object.keys(icons)).not.toContain('IconMarker');
  });

  it('knows every file that opens a color picker', () => {
    expect(callers()).toEqual(Object.keys(SITES).sort());
  });

  it.each(Object.entries(SITES).filter(([, site]) => 'builds' in site).map(([path]) => path))(
    '%s gives its color entry the paint roller',
    (path) => {
      expect(readFileSync(join(REPO_ROOT, path), 'utf8')).toContain('icon: IconPaintRoller');
    }
  );

  it.each(Object.entries(SITES).filter(([, site]) => 'inherits' in site).map(([path]) => path))(
    '%s does not repaint the inherited color entry icon',
    (path) => {
      expect(readFileSync(join(REPO_ROOT, path), 'utf8')).not.toMatch(/\.\.\.item,\s*icon:/);
    }
  );

  it.each([
    ['no color', {}],
    ['a text color', { textColor: 'red' }],
  ])('block settings Color entry shows the paint roller with %s', (_label, data) => {
    const [tune] = buildBlockColorTunes({ data, i18n, onPick: vi.fn() }) as Array<{ icon: string }>;

    expect(tune.icon).toBe(IconPaintRoller);
  });

  it('inline toolbar color button shows the paint roller', () => {
    const tool = new MarkerInlineTool({ api: { i18n } } as never);

    expect((tool.render() as { icon: string }).icon).toBe(IconPaintRoller);
  });
});
