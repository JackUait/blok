import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  PAGE_LAYOUT_PIN_LIMIT,
  addModule,
  addSection,
  canPlaceInPanel,
  deleteSection,
  moveInPlace,
  moveToSection,
  pageLayoutFields,
  pageLayoutOf,
  pin,
  removeFromLayout,
  renameSection,
  resetPageLayout,
  resolvePageLayout,
  setGroupIn,
  setPropertyIcons,
  setStructure,
} from '../../../../src/tools/database/page-layout';
import type { PropertyDefinition } from '../../../../src/tools/database/types';

const prop = (id: string, type: PropertyDefinition['type'] = 'text'): PropertyDefinition =>
  ({ id, name: id.toUpperCase(), type, position: `a${id}` });

const TITLE: PropertyDefinition = { id: 'title', name: 'Name', type: 'title', position: 'a0' };
const PROPS = [prop('a'), prop('b'), prop('c'), prop('rel', 'relation')];

const ids = (list: PropertyDefinition[]): string[] => list.map((p) => p.id);

describe('page layout — reading the title property', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads an absent layout as the classic page: every property in one group', () => {
    const resolved = resolvePageLayout(pageLayoutOf(TITLE), PROPS);

    expect(ids(resolved.group)).toEqual(['a', 'b', 'c', 'rel']);
    expect(resolved.heading).toEqual([]);
    expect(resolved.sections).toEqual([]);
    expect(resolved.structure).toBe('simple');
    expect(resolved.groupIn).toBe('page');
  });

  it('places pins, modules and sections, and keeps the rest in the group in schema order', () => {
    const layout = pageLayoutOf({
      ...TITLE,
      pageLayoutSections: [{ id: 's1', name: 'Dates' }],
      pageLayoutPlacements: [
        { id: 'c', place: 'heading' },
        { id: 'b', place: 'panel' },
        { id: 'a', place: 'section', sectionId: 's1' },
      ],
    });
    const resolved = resolvePageLayout(layout, PROPS);

    expect(ids(resolved.heading)).toEqual(['c']);
    expect(ids(resolved.panelModules)).toEqual(['b']);
    expect(resolved.sections.map((s) => [s.section.name, ids(s.properties)])).toEqual([['Dates', ['a']]]);
    expect(ids(resolved.group)).toEqual(['rel']);
  });

  it('lets the first entry win when a merge left one property in two places', () => {
    const layout = pageLayoutOf({
      ...TITLE,
      pageLayoutPlacements: [{ id: 'a', place: 'heading' }, { id: 'a', place: 'page' }],
    });
    const resolved = resolvePageLayout(layout, PROPS);

    expect(ids(resolved.heading)).toEqual(['a']);
    expect(resolved.pageModules).toEqual([]);
    expect(ids(resolved.group)).toEqual(['b', 'c', 'rel']);
  });

  it('drops placements of deleted properties and sends a deleted section back to the group', () => {
    const layout = pageLayoutOf({
      ...TITLE,
      pageLayoutPlacements: [{ id: 'gone', place: 'heading' }, { id: 'a', place: 'section', sectionId: 'missing' }],
    });
    const resolved = resolvePageLayout(layout, PROPS);

    expect(resolved.heading).toEqual([]);
    expect(ids(resolved.group)).toEqual(['a', 'b', 'c', 'rel']);
  });

  it('caps the heading at the pin limit when two peers pinned past it', () => {
    const many = Array.from({ length: PAGE_LAYOUT_PIN_LIMIT + 2 }, (_, i) => prop(`p${String(i).padStart(2, '0')}`));
    const layout = pageLayoutOf({ ...TITLE, pageLayoutPlacements: many.map((p) => ({ id: p.id, place: 'heading' as const })) });
    const resolved = resolvePageLayout(layout, many);

    expect(resolved.heading).toHaveLength(PAGE_LAYOUT_PIN_LIMIT);
    expect(ids(resolved.group)).toEqual(['p15', 'p16']);
  });

  it('keeps a relation out of the details panel', () => {
    const layout = pageLayoutOf({ ...TITLE, pageLayoutPlacements: [{ id: 'rel', place: 'panel' }] });
    const resolved = resolvePageLayout(layout, PROPS);

    expect(canPlaceInPanel(prop('rel', 'relation'))).toBe(false);
    expect(resolved.panelModules).toEqual([]);
    expect(ids(resolved.pageModules)).toEqual(['rel']);
  });

  it('dedupes sections by id, first wins', () => {
    const layout = pageLayoutOf({
      ...TITLE,
      pageLayoutSections: [{ id: 's1', name: 'One' }, { id: 's1', name: 'Again' }],
    });

    expect(resolvePageLayout(layout, PROPS).sections.map((s) => s.section.name)).toEqual(['One']);
  });
});

describe('page layout — edits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const empty = pageLayoutOf(TITLE);

  it('pins up to the limit and no further', () => {
    const many = Array.from({ length: PAGE_LAYOUT_PIN_LIMIT + 1 }, (_, i) => `p${i}`);
    const layout = many.reduce((acc, id) => pin(id)(acc), empty);

    expect(layout.placements.filter((p) => p.place === 'heading')).toHaveLength(PAGE_LAYOUT_PIN_LIMIT);
    expect(layout.placements.some((p) => p.id === `p${PAGE_LAYOUT_PIN_LIMIT}`)).toBe(false);
  });

  it('moves a property from a module to the heading without leaving a second entry', () => {
    const layout = pin('a')(addModule('a', 'page')(empty));

    expect(layout.placements).toEqual([{ id: 'a', place: 'heading' }]);
  });

  it('does not put a relation into the panel', () => {
    expect(addModule('rel', 'panel', prop('rel', 'relation'))(empty)).toEqual(empty);
  });

  it('removes a property from the layout, back to the group', () => {
    expect(removeFromLayout('a')(pin('a')(empty)).placements).toEqual([]);
  });

  it('moves a module up and down among modules of the same place', () => {
    const layout = [addModule('a', 'page'), addModule('b', 'panel'), addModule('c', 'page')].reduce((acc, op) => op(acc), empty);
    const moved = moveInPlace('c', -1)(layout);

    expect(moved.placements.filter((p) => p.place === 'page').map((p) => p.id)).toEqual(['c', 'a']);
    expect(moveInPlace('c', 1)(layout)).toEqual(layout);
  });

  it('adds, renames and deletes a section; deleting returns its properties to the group', () => {
    const withSection = moveToSection('a', 's1')(addSection('s1', 'Dates')(empty));

    expect(withSection.placements).toEqual([{ id: 'a', place: 'section', sectionId: 's1' }]);
    expect(renameSection('s1', 'When')(withSection).sections).toEqual([{ id: 's1', name: 'When' }]);
    const deleted = deleteSection('s1')(withSection);

    expect(deleted.sections).toEqual([]);
    expect(deleted.placements).toEqual([]);
    expect(moveToSection('a', null)(withSection).placements).toEqual([]);
  });

  it('sets the structure and where the group sits, and resets to the original layout', () => {
    const changed = setGroupIn('panel')(setStructure('tabbed')(pin('a')(addSection('s1', 'X')(empty))));

    expect(changed.structure).toBe('tabbed');
    expect(changed.groupIn).toBe('panel');
    expect(resetPageLayout()(changed)).toEqual(empty);
  });

  it('writes the lists even when empty, and drops default scalars', () => {
    expect(pageLayoutFields(empty)).toEqual({
      pageLayoutStructure: undefined,
      pageLayoutGroupIn: undefined,
      pageLayoutPlacements: [],
      pageLayoutSections: [],
    });
    expect(pageLayoutFields(setStructure('tabbed')(empty)).pageLayoutStructure).toBe('tabbed');
  });

  it('turns property icons off as false on the title property, and back on by dropping the key', () => {
    const off = setPropertyIcons(false)(empty);

    expect(pageLayoutFields(off).pageLayoutPropertyIcons).toBe(false);
    expect(pageLayoutOf({ ...TITLE, pageLayoutPropertyIcons: false }).propertyIcons).toBe(false);
    expect(empty.propertyIcons).toBe(true);
    expect(pageLayoutFields(setPropertyIcons(true)(off)).pageLayoutPropertyIcons).toBeUndefined();
    expect(resolvePageLayout(off, PROPS).propertyIcons).toBe(false);
    expect(resetPageLayout()(off).propertyIcons).toBe(true);
  });
});
