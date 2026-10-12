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
  /** Group properties outside every section: `group` placements in their order, then the rest in schema order. */
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
});

/** Fields to write on the title property. `undefined` removes a key. */
export const pageLayoutFields = (layout: PageLayoutData): Required<Pick<PageLayoutFields, 'pageLayoutPlacements' | 'pageLayoutSections'>> & PageLayoutFields => ({
  pageLayoutStructure: layout.structure === 'tabbed' ? 'tabbed' : undefined,
  pageLayoutGroupIn: layout.groupIn === 'panel' ? 'panel' : undefined,
  pageLayoutPropertyIcons: layout.propertyIcons ? undefined : false,
  pageLayoutPropertyLabels: layout.propertyLabels ? undefined : false,
  pageLayoutTemplates: layout.templates ? undefined : false,
  pageLayoutFullWidth: layout.fullWidth ? true : undefined,
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
  const sectionIds = new Set(sections.map((s) => s.id));
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
  const inGroup = new Set<string>();

  for (const [id, placement] of placed) {
    const property = byId.get(id) as PropertyDefinition;

    if (placement.place === 'group') {
      resolved.group.push(property);
    } else if (placement.place === 'heading' && resolved.heading.length < PAGE_LAYOUT_PIN_LIMIT) {
      resolved.heading.push(property);
    } else if (placement.place === 'page' || (placement.place === 'panel' && !canPlaceInPanel(property))) {
      resolved.pageModules.push(property);
    } else if (placement.place === 'panel') {
      resolved.panelModules.push(property);
    } else {
      inGroup.add(id);
    }
  }
  for (const property of properties) {
    const placement = placed.get(property.id);

    if (placement !== undefined && !inGroup.has(property.id)) {
      continue;
    }
    const section = placement?.place === 'section' && placement.sectionId !== undefined && sectionIds.has(placement.sectionId)
      ? resolved.sections.find((s) => s.section.id === placement.sectionId)
      : undefined;

    (section?.properties ?? resolved.group).push(property);
  }

  return resolved;
};

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

export const addModule = (id: string, place: 'page' | 'panel', property?: PropertyDefinition): PageLayoutOp => (layout) =>
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
 * A new section goes at the top. The first one takes every property still in the
 * group (research/10 §3). `propertyIds` are all the database's properties; which of
 * them sit in the group is read when the op runs, so a pin made since is kept.
 */
export const addSection = (id: string, name: string, propertyIds: readonly string[]): PageLayoutOp => (layout) => {
  const sections = [{ id, name }, ...layout.sections];
  const sectionIds = new Set(layout.sections.map((s) => s.id));

  if (sectionIds.size > 0) return { ...layout, sections };
  const inGroup = (p: PageLayoutPlacement | undefined): boolean =>
    p === undefined || p.place === 'group' || (p.place === 'section' && (p.sectionId === undefined || !sectionIds.has(p.sectionId)));
  const moved = propertyIds.filter((pid) => inGroup(layout.placements.find((p) => p.id === pid)));
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

export const setStructure = (structure: PageLayoutData['structure']): PageLayoutOp => (layout) => ({ ...layout, structure });

export const setGroupIn = (groupIn: PageLayoutData['groupIn']): PageLayoutOp => (layout) => ({ ...layout, groupIn });

export const setPropertyIcons = (propertyIcons: boolean): PageLayoutOp => (layout) => ({ ...layout, propertyIcons });

export const setPropertyLabels = (propertyLabels: boolean): PageLayoutOp => (layout) => ({ ...layout, propertyLabels });

export const setTemplates = (templates: boolean): PageLayoutOp => (layout) => ({ ...layout, templates });

export const setFullWidth = (fullWidth: boolean): PageLayoutOp => (layout) => ({ ...layout, fullWidth });

/** "Reset to original page layout". The lists stay, empty, so the next edit does not race their birth. */
export const resetPageLayout = (): PageLayoutOp => () => pageLayoutOf(undefined);
