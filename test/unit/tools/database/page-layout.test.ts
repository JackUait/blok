import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  PAGE_LAYOUT_PIN_LIMIT,
  addModule,
  addSection,
  applyDraft,
  arrangeSection,
  canPlaceInPanel,
  groupFirst,
  deleteSection,
  isDraftEmpty,
  moveInPlace,
  moveSection,
  moveToSection,
  pageLayoutFields,
  pageLayoutOf,
  pin,
  pinFirst,
  placeBefore,
  removeFromLayout,
  renameSection,
  resetPageLayout,
  resolvePageLayout,
  sectionFirst,
  setFullWidth,
  setGroupIn,
  setPropertyIcons,
  setPropertyLabels,
  setStructure,
  setTabsId,
  setTemplates,
} from '../../../../src/tools/database/page-layout';
import type { PageLayoutDraft } from '../../../../src/tools/database/page-layout';
import { DatabaseModel } from '../../../../src/tools/database/database-model';
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

  // feel/findings-rowpage R12, research/09:44: an unplaced property sits in the group A→Z by name, not in schema order.
  it('orders unplaced group properties by name, after the group placements in their saved order', () => {
    const named = [
      { ...prop('z'), name: 'Zeta' },
      { ...prop('t'), name: 'text' },
      { ...prop('a2'), name: 'Aardvark' },
      { ...prop('d'), name: 'Date' },
      { ...prop('n'), name: 'Note' },
    ];

    expect(ids(resolvePageLayout(pageLayoutOf(TITLE), named).group)).toEqual(['a2', 'd', 'n', 't', 'z']);
    const dragged = pageLayoutOf({ ...TITLE, pageLayoutPlacements: [{ id: 'z', place: 'group' }, { id: 'n', place: 'group' }] });

    expect(ids(resolvePageLayout(dragged, named).group)).toEqual(['z', 'n', 'a2', 'd', 't']);
  });

  it('places pins, modules and sections, and keeps the rest in the group in name order', () => {
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

  it.each([
    ['section first', [{ id: 'a', place: 'section' as const, sectionId: 's1' }, { id: 'a', place: 'heading' as const }]],
    ['pin first', [{ id: 'a', place: 'heading' as const }, { id: 'a', place: 'section' as const, sectionId: 's1' }]],
  ])('lets a pin beat a section entry when a merge left one property in both (%s)', (_, placements) => {
    const layout = pageLayoutOf({ ...TITLE, pageLayoutSections: [{ id: 's1', name: 'One' }], pageLayoutPlacements: placements });
    const resolved = resolvePageLayout(layout, PROPS);

    expect(ids(resolved.heading)).toEqual(['a']);
    expect(resolved.sections.map((s) => ids(s.properties))).toEqual([[]]);
  });

  it('moves a pin that a merge also left in a section', () => {
    const layout = pageLayoutOf({
      ...TITLE,
      pageLayoutSections: [{ id: 's1', name: 'One' }],
      pageLayoutPlacements: [{ id: 'a', place: 'section', sectionId: 's1' }, { id: 'b', place: 'heading' }, { id: 'a', place: 'heading' }],
    });

    expect(ids(resolvePageLayout(moveInPlace('a', -1)(layout), PROPS).heading)).toEqual(['a', 'b']);
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

  // A dragged module or pin lands before another one of its place, or at the end (plan Phase 5c).
  describe('placeBefore', () => {
    const base = [addModule('a', 'page'), addModule('b', 'panel'), addModule('c', 'page'), pin('p1'), pin('p2')].reduce((acc, op) => op(acc), empty);
    const order = (layout: typeof empty, place: string): string[] => layout.placements.filter((p) => p.place === place).map((p) => p.id);

    it('moves a module before another of the same place', () => {
      expect(order(placeBefore('c', 'page', 'a')(base), 'page')).toEqual(['c', 'a']);
    });

    it('moves a module to the end of its place with no target', () => {
      expect(order(placeBefore('a', 'page', null)(base), 'page')).toEqual(['c', 'a']);
    });

    it('moves a page module into the panel, before a panel module', () => {
      const moved = placeBefore('a', 'panel', 'b')(base);

      expect(order(moved, 'panel')).toEqual(['a', 'b']);
      expect(order(moved, 'page')).toEqual(['c']);
    });

    it('lands at the end when the target is gone or sits in another place', () => {
      expect(order(placeBefore('a', 'panel', 'gone')(base), 'panel')).toEqual(['b', 'a']);
      expect(order(placeBefore('a', 'panel', 'c')(base), 'panel')).toEqual(['b', 'a']);
    });

    it('never puts a relation into the panel', () => {
      const layout = addModule('rel', 'page')(base);

      expect(placeBefore('rel', 'panel', 'b', prop('rel', 'relation'))(layout)).toEqual(layout);
    });

    it('reorders pins', () => {
      expect(order(placeBefore('p2', 'heading', 'p1')(base), 'heading')).toEqual(['p2', 'p1']);
    });

    it('keeps the layout when the property is its own target', () => {
      expect(placeBefore('a', 'page', 'a')(base)).toEqual(base);
    });
  });

  it('adds, renames and deletes a section; deleting returns its properties to the group', () => {
    const withSection = moveToSection('a', 's1')(addSection('s1', 'Dates', [])(empty));

    expect(withSection.placements).toEqual([{ id: 'a', place: 'section', sectionId: 's1' }]);
    expect(renameSection('s1', 'When')(withSection).sections).toEqual([{ id: 's1', name: 'When' }]);
    const deleted = deleteSection('s1')(withSection);

    expect(deleted.sections).toEqual([]);
    expect(deleted.placements).toEqual([]);
    expect(moveToSection('a', null)(withSection).placements).toEqual([]);
  });

  it('sets the structure and where the group sits, and resets to the original layout', () => {
    const changed = setGroupIn('panel')(setStructure('tabbed')(pin('a')(addSection('s1', 'X', [])(empty))));

    expect(changed.structure).toBe('tabbed');
    expect(changed.groupIn).toBe('panel');
    expect(resetPageLayout()(changed)).toEqual({ ...empty, placements: [{ id: 'a', place: 'group' }] });
    expect(resetPageLayout()(setStructure('tabbed')(empty))).toEqual(empty);
  });

  // research/10 §5 L166: the group reads the old pins, then the old sections, not schema order.
  it('keeps the old pins, then the old sections\' properties, as group placements on reset', () => {
    const layout = {
      ...empty,
      sections: [{ id: 's2', name: 'More' }, { id: 's1', name: 'Details' }],
      placements: [
        { id: 'c', place: 'section' as const, sectionId: 's1' },
        { id: 'b', place: 'heading' as const },
        { id: 'rel', place: 'section' as const, sectionId: 's2' },
        { id: 'a', place: 'section' as const, sectionId: 's1' },
        { id: 'x', place: 'page' as const },
        { id: 'y', place: 'section' as const, sectionId: 'gone' },
      ],
    };
    const reset = resetPageLayout()(layout);

    expect(reset.placements).toEqual([
      { id: 'b', place: 'group' },
      { id: 'rel', place: 'group' },
      { id: 'c', place: 'group' },
      { id: 'a', place: 'group' },
    ]);
    expect(reset.sections).toEqual([]);
    expect(ids(resolvePageLayout(reset, PROPS).group)).toEqual(['b', 'rel', 'c', 'a']);
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

  it('adds the first section at the top and moves every group property into it', () => {
    const start = [pin('a'), addModule('b', 'page'), moveToSection('c', 'gone')].reduce((acc, op) => op(acc), empty);
    const layout = addSection('s1', 'New section', ids(PROPS))(start);
    const resolved = resolvePageLayout(layout, PROPS);

    expect(layout.sections).toEqual([{ id: 's1', name: 'New section' }]);
    expect(resolved.sections.map((s) => [s.section.id, ids(s.properties)])).toEqual([['s1', ['c', 'rel']]]);
    expect(resolved.group).toEqual([]);
    expect(ids(resolved.heading)).toEqual(['a']);
    expect(ids(resolved.pageModules)).toEqual(['b']);
  });

  it('adds a later section at the top, empty', () => {
    const first = addSection('s1', 'One', ids(PROPS))(empty);
    const layout = addSection('s2', 'Two', ids(PROPS))(first);
    const resolved = resolvePageLayout(layout, PROPS);

    expect(layout.sections.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(resolved.sections.map((s) => [s.section.id, ids(s.properties)])).toEqual([['s2', []], ['s1', ['a', 'b', 'c', 'rel']]]);
  });

  it('moves a section up and down', () => {
    const layout = [addSection('s1', 'One', []), addSection('s2', 'Two', []), addSection('s3', 'Three', [])].reduce((acc, op) => op(acc), empty);

    expect(layout.sections.map((s) => s.id)).toEqual(['s3', 's2', 's1']);
    expect(moveSection('s3', 1)(layout).sections.map((s) => s.id)).toEqual(['s2', 's3', 's1']);
    expect(moveSection('s1', -1)(layout).sections.map((s) => s.id)).toEqual(['s3', 's1', 's2']);
    expect(moveSection('s3', -1)(layout)).toEqual(layout);
    expect(moveSection('s1', 1)(layout)).toEqual(layout);
    expect(moveSection('missing', 1)(layout)).toEqual(layout);
  });

  it('pins a property made from the Pinned list first', () => {
    const layout = [pin('a'), addModule('b', 'page'), pin('c')].reduce((acc, op) => op(acc), empty);
    const resolved = resolvePageLayout(pinFirst('rel')(layout), PROPS);

    expect(ids(resolved.heading)).toEqual(['rel', 'a', 'c']);
    expect(ids(resolved.pageModules)).toEqual(['b']);

    const full = Array.from({ length: PAGE_LAYOUT_PIN_LIMIT }, (_, i) => `p${i}`).reduce((acc, id) => pin(id)(acc), empty);

    expect(pinFirst('extra')(full)).toEqual(full);
  });

  it('writes property labels off as false, templates off as false, full width on as true, and drops each key at its default', () => {
    expect(empty.propertyLabels).toBe(true);
    expect(empty.templates).toBe(true);
    expect(empty.fullWidth).toBe(false);
    const changed = [setPropertyLabels(false), setTemplates(false), setFullWidth(true)].reduce((acc, op) => op(acc), empty);
    const fields = pageLayoutFields(changed);

    expect(fields.pageLayoutPropertyLabels).toBe(false);
    expect(fields.pageLayoutTemplates).toBe(false);
    expect(fields.pageLayoutFullWidth).toBe(true);
    expect(pageLayoutOf({ ...TITLE, ...fields })).toMatchObject({ propertyLabels: false, templates: false, fullWidth: true });

    const back = pageLayoutFields([setPropertyLabels(true), setTemplates(true), setFullWidth(false)].reduce((acc, op) => op(acc), changed));

    expect(back.pageLayoutPropertyLabels).toBeUndefined();
    expect(back.pageLayoutTemplates).toBeUndefined();
    expect(back.pageLayoutFullWidth).toBeUndefined();
  });

  // research/11 §3: Simple keeps the view tabs; Reset drops them.
  it('keeps the layout tabs block id through Simple and drops it on reset', () => {
    expect(empty.tabsId).toBeUndefined();
    expect(pageLayoutFields(empty).pageLayoutTabsId).toBeUndefined();
    const tabbed = setTabsId('tabs-1')(setStructure('tabbed')(empty));

    expect(pageLayoutFields(tabbed).pageLayoutTabsId).toBe('tabs-1');
    expect(pageLayoutOf({ ...TITLE, pageLayoutTabsId: 'tabs-1' }).tabsId).toBe('tabs-1');
    expect(pageLayoutOf({ ...TITLE, pageLayoutTabsId: 7 } as unknown as PropertyDefinition).tabsId).toBeUndefined();
    expect(setStructure('simple')(tabbed).tabsId).toBe('tabs-1');
    expect(resetPageLayout()(tabbed).tabsId).toBeUndefined();
    expect(pageLayoutFields(resetPageLayout()(tabbed)).pageLayoutTabsId).toBeUndefined();
  });

  it('resets property labels, templates and full width to their defaults', () => {
    const model = new DatabaseModel({ schema: [TITLE, ...PROPS], views: [], activeViewId: '' });
    const changed = [setPropertyLabels(false), setTemplates(false), setFullWidth(true)].reduce((acc, op) => op(acc), model.getPageLayout());

    model.setPageLayout(changed);
    expect(model.getSchema().find((p) => p.type === 'title')).toMatchObject({ pageLayoutPropertyLabels: false, pageLayoutTemplates: false, pageLayoutFullWidth: true });
    model.setPageLayout(resetPageLayout()(changed));
    const title = model.getSchema().find((p) => p.type === 'title');

    expect(title).not.toHaveProperty('pageLayoutPropertyLabels');
    expect(title).not.toHaveProperty('pageLayoutTemplates');
    expect(title).not.toHaveProperty('pageLayoutFullWidth');
    expect(model.getPageLayout()).toMatchObject({ propertyLabels: true, templates: true, fullWidth: false });
  });

  it('puts group placements first, in placement order, and the rest in schema order', () => {
    const layout = pageLayoutOf({
      ...TITLE,
      pageLayoutPlacements: [{ id: 'c', place: 'group' }, { id: 'a', place: 'heading' }, { id: 'rel', place: 'group' }],
    });

    expect(ids(resolvePageLayout(layout, PROPS).group)).toEqual(['c', 'rel', 'b']);
  });

  // research/09 §3 L57: "+ Add a property" from the Property group lands at its top.
  it('puts a property first in the group, ahead of earlier group placements', () => {
    const layout = [pin('a'), groupFirst('c'), groupFirst('rel')].reduce((acc, op) => op(acc), empty);
    const resolved = resolvePageLayout(layout, PROPS);

    expect(ids(resolved.group)).toEqual(['rel', 'c', 'b']);
    expect(ids(resolved.heading)).toEqual(['a']);
    expect(ids(resolvePageLayout(groupFirst('a')(layout), PROPS).group)).toEqual(['a', 'rel', 'c', 'b']);
    expect(ids(resolvePageLayout(groupFirst('a')(layout), PROPS).heading)).toEqual([]);
  });

  it('never changes a property position for layout order', () => {
    const model = new DatabaseModel({ schema: [TITLE, ...PROPS], views: [], activeViewId: '' });
    const before = model.getSchema().map((p) => [p.id, p.position]);
    const layout = [
      addSection('s1', 'One', ids(PROPS)),
      addSection('s2', 'Two', ids(PROPS)),
      moveSection('s2', 1),
      pinFirst('c'),
      moveInPlace('c', 1),
    ].reduce((acc, op) => op(acc), model.getPageLayout());

    model.setPageLayout({ ...layout, placements: [...layout.placements, { id: 'rel', place: 'group' }] });

    expect(model.getSchema().map((p) => [p.id, p.position])).toEqual(before);
  });

  // research/10 §3: properties drag between sections, so a section keeps the order they were put in.
  it('orders a section by its placements, not by schema order', () => {
    const layout = pageLayoutOf({
      ...TITLE,
      pageLayoutSections: [{ id: 's1', name: 'One' }],
      pageLayoutPlacements: [{ id: 'c', place: 'section', sectionId: 's1' }, { id: 'a', place: 'section', sectionId: 's1' }],
    });

    expect(ids(resolvePageLayout(layout, PROPS).sections[0].properties)).toEqual(['c', 'a']);
  });

  it('arranges a dragged property into a section in the order it was dropped', () => {
    const start = [addSection('s1', 'One', ids(PROPS)), addSection('s2', 'Two', ids(PROPS))].reduce((acc, op) => op(acc), empty);
    const layout = arrangeSection('c', 's2', ['c'])(start);
    const twice = arrangeSection('a', 's2', ['c', 'a'])(layout);
    const before = arrangeSection('b', 's2', ['b', 'c', 'a'])(twice);
    const resolved = resolvePageLayout(before, PROPS);

    expect(resolved.sections.map((s) => [s.section.id, ids(s.properties)])).toEqual([['s2', ['b', 'c', 'a']], ['s1', ['rel']]]);
  });

  it('arranges a property out of a section into the group, in the dropped order', () => {
    const start = [addSection('s1', 'One', ids(PROPS)), moveToSection('b', null), moveToSection('c', null)].reduce((acc, op) => op(acc), empty);
    const layout = arrangeSection('rel', null, ['b', 'rel', 'c'])(start);
    const resolved = resolvePageLayout(layout, PROPS);

    expect(ids(resolved.group)).toEqual(['b', 'rel', 'c']);
    expect(ids(resolved.sections[0].properties)).toEqual(['a']);
  });

  it('leaves a property a peer moved elsewhere since the drop', () => {
    const start = [addSection('s1', 'One', ids(PROPS)), addSection('s2', 'Two', [])].reduce((acc, op) => op(acc), empty);
    const peer = pin('b')(arrangeSection('a', 's2', ['a'])(start));
    const layout = arrangeSection('c', 's2', ['b', 'c', 'a'])(peer);
    const resolved = resolvePageLayout(layout, PROPS);

    expect(ids(resolved.heading)).toEqual(['b']);
    expect(resolved.sections.map((s) => [s.section.id, ids(s.properties)])).toEqual([['s2', ['c', 'a']], ['s1', ['rel']]]);
  });

  it('puts a property first in a section', () => {
    const start = [addSection('s1', 'One', ['a', 'b']), addSection('s2', 'Two', [])].reduce((acc, op) => op(acc), empty);
    const layout = sectionFirst('c', 's1')(start);
    const resolved = resolvePageLayout(sectionFirst('rel', 's2')(layout), PROPS);

    expect(resolved.sections.map((s) => [s.section.id, ids(s.properties)])).toEqual([['s2', ['rel']], ['s1', ['c', 'a', 'b']]]);
    expect(sectionFirst('a', 'gone')(start)).toEqual(start);
  });

  it('a draft with only visibility edits is not empty, and applying it replays the ops on the newest layout', () => {
    const blank: PageLayoutDraft = { ops: [], visibility: new Map(), madeProperties: [] };

    expect(isDraftEmpty(blank)).toBe(true);
    expect(isDraftEmpty({ ...blank, visibility: new Map([['a', 'hidden']]) })).toBe(false);
    expect(isDraftEmpty({ ...blank, madeProperties: ['a'] })).toBe(false);
    expect(isDraftEmpty({ ...blank, ops: [pin('a')] })).toBe(false);

    const draft: PageLayoutDraft = { ops: [pin('a')], visibility: new Map([['b', 'hidden']]), madeProperties: [] };
    const newest = pin('c')(empty);

    expect(applyDraft(draft, newest).placements).toEqual([{ id: 'c', place: 'heading' }, { id: 'a', place: 'heading' }]);
  });
});

