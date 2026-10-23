import type { PageLayoutFields, PageLayoutPlacement, PageLayoutSection, PageVisibility, PropertyDefinition } from './types';

/** Notion's help page says 15 (help/layouts). Its guide says four. */
export const PAGE_LAYOUT_PIN_LIMIT = 15;

export interface PageLayoutData {
  structure: 'simple' | 'tabbed';
  groupIn: 'page' | 'panel';
  propertyIcons: boolean;
  propertyLabels: boolean;
  templates: boolean;
  fullWidth: boolean;
  placements: PageLayoutPlacement[];
  sections: PageLayoutSection[];
  /** The layout tabs block. Kept while Simple, so Tabbed brings the view tabs back (research/11 §3). */
  tabsId?: string;
}

/** One edit. A draft keeps edits, not a snapshot, so applying it replays them on the newest layout. */
export type PageLayoutOp = (layout: PageLayoutData) => PageLayoutData;

/**
 * Edits made while customizing, kept until Apply or Discard. `visibility` writes
 * the property itself, not the title property, so it is not a `PageLayoutOp`.
 */
export interface PageLayoutDraft {
  ops: PageLayoutOp[];
  visibility: Map<string, PageVisibility>;
  /** Properties made while customizing. Discard deletes them. */
  madeProperties: string[];
}

export const applyDraft = (draft: PageLayoutDraft, layout: PageLayoutData): PageLayoutData =>
  draft.ops.reduce((acc, op) => op(acc), layout);

export const isDraftEmpty = (draft: PageLayoutDraft): boolean =>
  draft.ops.length === 0 && draft.visibility.size === 0 && draft.madeProperties.length === 0;

export interface ResolvedPageLayout {
  structure: 'simple' | 'tabbed';
  groupIn: 'page' | 'panel';
  propertyIcons: boolean;
  heading: PropertyDefinition[];
  pageModules: PropertyDefinition[];
  panelModules: PropertyDefinition[];
  /** Group properties outside every section: `group` placements in their order, then the rest A→Z by name (research/09:44). */
  group: PropertyDefinition[];
  sections: Array<{ section: PageLayoutSection; properties: PropertyDefinition[] }>;
}

/** Notion: "Some properties, like Relation, can't be moved to the details panel." */
export const canPlaceInPanel = (property: PropertyDefinition | undefined): boolean => property?.type !== 'relation';

const inGroupRank = (place: PageLayoutPlacement['place']): boolean => place === 'section' || place === 'group';

/**
 * One entry per property. Two peers' merged lists can name a property twice:
 * a pin or module beats a group or section entry, so the first section's bulk
 * write cannot drop a pin made at the same moment. Otherwise the first entry wins.
 */
const dedupePlacements = (placements: PageLayoutPlacement[]): PageLayoutPlacement[] => {
  const winner = new Map<string, PageLayoutPlacement>();

  for (const placement of placements) {
    const current = winner.get(placement.id);

    if (current === undefined || (inGroupRank(current.place) && !inGroupRank(placement.place))) {
      winner.set(placement.id, placement);
    }
  }

  return placements.filter((p) => winner.get(p.id) === p).map((p) => ({ ...p }));
};

export const pageLayoutOf = (title: PropertyDefinition | undefined): PageLayoutData => ({
  structure: title?.pageLayoutStructure === 'tabbed' ? 'tabbed' : 'simple',
  groupIn: title?.pageLayoutGroupIn === 'panel' ? 'panel' : 'page',
  propertyIcons: title?.pageLayoutPropertyIcons !== false,
  propertyLabels: title?.pageLayoutPropertyLabels !== false,
  templates: title?.pageLayoutTemplates !== false,
  fullWidth: title?.pageLayoutFullWidth === true,
  placements: Array.isArray(title?.pageLayoutPlacements) ? dedupePlacements(title.pageLayoutPlacements) : [],
  sections: Array.isArray(title?.pageLayoutSections) ? title.pageLayoutSections.map((s) => ({ ...s })) : [],
  ...(typeof title?.pageLayoutTabsId === 'string' && title.pageLayoutTabsId !== '' ? { tabsId: title.pageLayoutTabsId } : {}),
});

/** Fields to write on the title property. `undefined` removes a key. */
export const pageLayoutFields = (layout: PageLayoutData): Required<Pick<PageLayoutFields, 'pageLayoutPlacements' | 'pageLayoutSections'>> & PageLayoutFields => ({
  pageLayoutStructure: layout.structure === 'tabbed' ? 'tabbed' : undefined,
  pageLayoutGroupIn: layout.groupIn === 'panel' ? 'panel' : undefined,
  pageLayoutPropertyIcons: layout.propertyIcons ? undefined : false,
  pageLayoutPropertyLabels: layout.propertyLabels ? undefined : false,
  pageLayoutTemplates: layout.templates ? undefined : false,
  pageLayoutFullWidth: layout.fullWidth ? true : undefined,
  pageLayoutTabsId: layout.tabsId,
  pageLayoutPlacements: layout.placements,
  pageLayoutSections: layout.sections,
});

/**
 * Where each property goes. Two peers' merged lists can pin past the limit or
 * point at a deleted section: anything that does not fit falls back to the group.
 * A property named twice is settled by `pageLayoutOf`; here the first entry wins.
 */
export const resolvePageLayout = (layout: PageLayoutData, properties: PropertyDefinition[]): ResolvedPageLayout => {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const sections = layout.sections.filter((s, i, all) => all.findIndex((o) => o.id === s.id) === i);
  const placed = new Map<string, PageLayoutPlacement>();

  for (const placement of layout.placements) {
    if (byId.has(placement.id) && !placed.has(placement.id)) {
      placed.set(placement.id, placement);
    }
  }
  const resolved: ResolvedPageLayout = {
    structure: layout.structure,
    groupIn: layout.groupIn,
    propertyIcons: layout.propertyIcons,
    heading: [],
    pageModules: [],
    panelModules: [],
    group: [],
    sections: sections.map((section) => ({ section, properties: [] })),
  };
  for (const [id, placement] of placed) {
    const property = byId.get(id) as PropertyDefinition;
    const section = placement.place === 'section' ? resolved.sections.find((s) => s.section.id === placement.sectionId) : undefined;

    if (section !== undefined) {
      section.properties.push(property);
    } else if (placement.place === 'group') {
      resolved.group.push(property);
    } else if (placement.place === 'heading' && resolved.heading.length < PAGE_LAYOUT_PIN_LIMIT) {
      resolved.heading.push(property);
    } else if (placement.place === 'page' || (placement.place === 'panel' && !canPlaceInPanel(property))) {
      resolved.pageModules.push(property);
    } else if (placement.place === 'panel') {
      resolved.panelModules.push(property);
    } else {
      // A pin past the limit or a gone section's member keeps its saved place in the group.
      resolved.group.push(property);
    }
  }
  for (const property of [...properties].sort(byName)) {
    if (!placed.has(property.id)) {
      resolved.group.push(property);
    }
  }

  return resolved;
};

/** Notion lists an unplaced property by name, so one added later is not last (feel/findings-rowpage R12). */
const byName = (a: PropertyDefinition, b: PropertyDefinition): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || (a.position < b.position ? -1 : Number(a.position > b.position));

const withPlacement = (layout: PageLayoutData, placement: PageLayoutPlacement | null, id: string): PageLayoutData => ({
  ...layout,
  placements: [...layout.placements.filter((p) => p.id !== id), ...(placement === null ? [] : [placement])],
});

const pinsFull = (layout: PageLayoutData, id: string): boolean =>
  layout.placements.filter((p) => p.place === 'heading' && p.id !== id).length >= PAGE_LAYOUT_PIN_LIMIT;

export const pin = (id: string): PageLayoutOp => (layout) =>
  pinsFull(layout, id) ? layout : withPlacement(layout, { id, place: 'heading' }, id);

/** A property made from the Pinned list goes first among the pins (research/10 §7). */
export const pinFirst = (id: string): PageLayoutOp => (layout) => {
  if (pinsFull(layout, id)) return layout;
  const rest = layout.placements.filter((p) => p.id !== id);
  const at = rest.findIndex((p) => p.place === 'heading');
  const placement: PageLayoutPlacement = { id, place: 'heading' };

  return { ...layout, placements: at === -1 ? [...rest, placement] : [...rest.slice(0, at), placement, ...rest.slice(at)] };
};

/** A property made from the Property group menu goes to the top of the group (research/09 §3 L57). */
export const groupFirst = (id: string): PageLayoutOp => (layout) => {
  const rest = layout.placements.filter((p) => p.id !== id);

  return { ...layout, placements: [{ id, place: 'group' }, ...rest] };
};

export const addModule =(id: string, place: 'page' | 'panel', property?: PropertyDefinition): PageLayoutOp => (layout) =>
  place === 'panel' && !canPlaceInPanel(property) ? layout : withPlacement(layout, { id, place }, id);

export const removeFromLayout = (id: string): PageLayoutOp => (layout) => withPlacement(layout, null, id);

/** Swaps a pin or module with its neighbour in the same place. */
export const moveInPlace = (id: string, step: 1 | -1): PageLayoutOp => (layout) => {
  const current = layout.placements.find((p) => p.id === id);

  if (current === undefined) return layout;
  const same = layout.placements.filter((p) => p.place === current.place);
  const target = same[same.indexOf(current) + step];

  if (target === undefined) return layout;
  const placements = [...layout.placements];
  const a = placements.indexOf(current);
  const b = placements.indexOf(target);

  placements[a] = target;
  placements[b] = current;

  return { ...layout, placements };
};

/**
 * A dragged pin or module lands before `beforeId` in `place`, or at the end of
 * `place` when that target is gone or sits elsewhere (a peer may have moved it).
 */
export const placeBefore = (id: string, place: 'heading' | 'page' | 'panel', beforeId: string | null, property?: PropertyDefinition): PageLayoutOp => (layout) => {
  if (id === beforeId || (place === 'panel' && !canPlaceInPanel(property))) return layout;
  const rest = layout.placements.filter((p) => p.id !== id);
  const target = rest.findIndex((p) => p.id === beforeId && p.place === place);
  const last = rest.map((p) => p.place).lastIndexOf(place);
  const end = last === -1 ? rest.length : last + 1;
  const at = target === -1 ? end : target;

  return { ...layout, placements: [...rest.slice(0, at), { id, place }, ...rest.slice(at)] };
};

/** In the group outside every section: unplaced, placed there, or in a section that is gone. */
const inLooseGroup = (p: PageLayoutPlacement | undefined, sectionIds: ReadonlySet<string>): boolean =>
  p === undefined || p.place === 'group' || (p.place === 'section' && (p.sectionId === undefined || !sectionIds.has(p.sectionId)));

/**
 * A new section goes at the top. The first one takes every property still in the
 * group (research/10 §3). `propertyIds` are all the database's properties; which of
 * them sit in the group is read when the op runs, so a pin made since is kept.
 */
export const addSection = (id: string, name: string, propertyIds: readonly string[]): PageLayoutOp => (layout) => {
  const sections = [{ id, name }, ...layout.sections];
  const sectionIds = new Set(layout.sections.map((s) => s.id));

  if (sectionIds.size > 0) return { ...layout, sections };
  const moved = propertyIds.filter((pid) => inLooseGroup(layout.placements.find((p) => p.id === pid), sectionIds));
  const movedIds = new Set(moved);

  return {
    ...layout,
    sections,
    placements: [
      ...layout.placements.filter((p) => !movedIds.has(p.id)),
      ...moved.map((pid): PageLayoutPlacement => ({ id: pid, place: 'section', sectionId: id })),
    ],
  };
};

export const moveSection = (id: string, step: 1 | -1): PageLayoutOp => (layout) => {
  const at = layout.sections.findIndex((s) => s.id === id);
  const to = at + step;

  if (at === -1 || to < 0 || to >= layout.sections.length) return layout;
  const sections = [...layout.sections];

  [sections[at], sections[to]] = [sections[to], sections[at]];

  return { ...layout, sections };
};

export const renameSection = (id: string, name: string): PageLayoutOp => (layout) => ({
  ...layout,
  sections: layout.sections.map((s) => (s.id === id ? { ...s, name } : s)),
});

export const deleteSection = (id: string): PageLayoutOp => (layout) => ({
  ...layout,
  sections: layout.sections.filter((s) => s.id !== id),
  placements: layout.placements.filter((p) => p.place !== 'section' || p.sectionId !== id),
});

export const moveToSection = (id: string, sectionId: string | null): PageLayoutOp => (layout) =>
  withPlacement(layout, sectionId === null ? null : { id, place: 'section', sectionId }, id);

/** A property made from a section's own "+ Add a property" goes first in it. */
export const sectionFirst = (id: string, sectionId: string): PageLayoutOp => (layout) => {
  if (!layout.sections.some((s) => s.id === sectionId)) return layout;
  const rest = layout.placements.filter((p) => p.id !== id);
  const at = rest.findIndex((p) => p.place === 'section' && p.sectionId === sectionId);
  const placement: PageLayoutPlacement = { id, place: 'section', sectionId };

  return { ...layout, placements: at === -1 ? [...rest, placement] : [...rest.slice(0, at), placement, ...rest.slice(at)] };
};

/**
 * A property dropped into a section, or into the group with `sectionId` null.
 * `order` is that list as the drop left it. Members a peer moved out since are
 * left where the peer put them.
 */
export const arrangeSection = (id: string, sectionId: string | null, order: readonly string[]): PageLayoutOp => (layout) => {
  if (sectionId !== null && !layout.sections.some((s) => s.id === sectionId)) return layout;
  const sectionIds = new Set(layout.sections.map((s) => s.id));
  const stillHere = (pid: string): boolean => {
    const p = layout.placements.find((candidate) => candidate.id === pid);

    return sectionId === null ? inLooseGroup(p, sectionIds) : p?.place === 'section' && p.sectionId === sectionId;
  };
  const members = order.filter((pid, i) => order.indexOf(pid) === i && (pid === id || stillHere(pid)));
  const moved = new Set(members);

  return {
    ...layout,
    placements: [
      ...layout.placements.filter((p) => !moved.has(p.id)),
      ...members.map((pid): PageLayoutPlacement => (sectionId === null ? { id: pid, place: 'group' } : { id: pid, place: 'section', sectionId })),
    ],
  };
};

export const setStructure = (structure: PageLayoutData['structure']): PageLayoutOp => (layout) => ({ ...layout, structure });

export const setTabsId = (tabsId: string | undefined): PageLayoutOp => (layout) => {
  const { tabsId: _old, ...rest } = layout;

  return tabsId === undefined ? rest : { ...rest, tabsId };
};

/**
 * `live` with the ids of `order` put in that order, in the slots they hold.
 * Ids not in `order` (Content, a peer's new tab) keep their slot.
 */
export const inTabOrder = (live: readonly string[], order: readonly string[]): string[] => {
  const ordered = new Set(order);
  const queue = order.filter((id) => live.includes(id));

  return live.map((id) => (ordered.has(id) ? queue.shift() ?? id : id));
};

export const setGroupIn = (groupIn: PageLayoutData['groupIn']): PageLayoutOp => (layout) => ({ ...layout, groupIn });

export const setPropertyIcons = (propertyIcons: boolean): PageLayoutOp => (layout) => ({ ...layout, propertyIcons });

export const setPropertyLabels = (propertyLabels: boolean): PageLayoutOp => (layout) => ({ ...layout, propertyLabels });

export const setTemplates = (templates: boolean): PageLayoutOp => (layout) => ({ ...layout, templates });

export const setFullWidth = (fullWidth: boolean): PageLayoutOp => (layout) => ({ ...layout, fullWidth });

/**
 * "Reset to original page layout". The group keeps the old pins, then the old
 * sections' properties, in that order (research/10 §5 L166), as `group`
 * placements: a property `position` would also move table columns. The lists
 * stay, so the next edit does not race their birth.
 */
export const resetPageLayout = (): PageLayoutOp => (layout) => {
  const pins = layout.placements.filter((p) => p.place === 'heading');
  const inSections = layout.sections.flatMap((section) => layout.placements.filter((p) => p.place === 'section' && p.sectionId === section.id));
  const order = [...pins, ...inSections].map((p) => p.id);

  return {
    ...pageLayoutOf(undefined),
    placements: order.filter((id, i) => order.indexOf(id) === i).map((id): PageLayoutPlacement => ({ id, place: 'group' })),
  };
};
