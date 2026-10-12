import type { PageLayoutFields, PageLayoutPlacement, PageLayoutSection, PropertyDefinition } from './types';

/** Notion's help page says 15 (help/layouts). Its guide says four. */
export const PAGE_LAYOUT_PIN_LIMIT = 15;

export interface PageLayoutData {
  structure: 'simple' | 'tabbed';
  groupIn: 'page' | 'panel';
  propertyIcons: boolean;
  placements: PageLayoutPlacement[];
  sections: PageLayoutSection[];
}

/** One edit. A draft keeps edits, not a snapshot, so applying it replays them on the newest layout. */
export type PageLayoutOp = (layout: PageLayoutData) => PageLayoutData;

export interface ResolvedPageLayout {
  structure: 'simple' | 'tabbed';
  groupIn: 'page' | 'panel';
  propertyIcons: boolean;
  heading: PropertyDefinition[];
  pageModules: PropertyDefinition[];
  panelModules: PropertyDefinition[];
  /** Group properties outside every section, in schema order. */
  group: PropertyDefinition[];
  sections: Array<{ section: PageLayoutSection; properties: PropertyDefinition[] }>;
}

/** Notion: "Some properties, like Relation, can't be moved to the details panel." */
export const canPlaceInPanel = (property: PropertyDefinition | undefined): boolean => property?.type !== 'relation';

export const pageLayoutOf = (title: PropertyDefinition | undefined): PageLayoutData => ({
  structure: title?.pageLayoutStructure === 'tabbed' ? 'tabbed' : 'simple',
  groupIn: title?.pageLayoutGroupIn === 'panel' ? 'panel' : 'page',
  propertyIcons: title?.pageLayoutPropertyIcons !== false,
  placements: Array.isArray(title?.pageLayoutPlacements) ? title.pageLayoutPlacements.map((p) => ({ ...p })) : [],
  sections: Array.isArray(title?.pageLayoutSections) ? title.pageLayoutSections.map((s) => ({ ...s })) : [],
});

/** Fields to write on the title property. `undefined` removes a key. */
export const pageLayoutFields = (layout: PageLayoutData): Required<Pick<PageLayoutFields, 'pageLayoutPlacements' | 'pageLayoutSections'>> & PageLayoutFields => ({
  pageLayoutStructure: layout.structure === 'tabbed' ? 'tabbed' : undefined,
  pageLayoutGroupIn: layout.groupIn === 'panel' ? 'panel' : undefined,
  pageLayoutPropertyIcons: layout.propertyIcons ? undefined : false,
  pageLayoutPlacements: layout.placements,
  pageLayoutSections: layout.sections,
});

/**
 * Where each property goes. Two peers' merged lists can name a property twice,
 * pin past the limit or point at a deleted section: the first entry wins and
 * anything that does not fit falls back to the group.
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

    if (placement.place === 'heading' && resolved.heading.length < PAGE_LAYOUT_PIN_LIMIT) {
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

export const pin = (id: string): PageLayoutOp => (layout) => {
  const pinned = layout.placements.filter((p) => p.place === 'heading' && p.id !== id).length;

  return pinned >= PAGE_LAYOUT_PIN_LIMIT ? layout : withPlacement(layout, { id, place: 'heading' }, id);
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

export const addSection = (id: string, name: string): PageLayoutOp => (layout) => ({
  ...layout,
  sections: [...layout.sections, { id, name }],
});

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

/** "Reset to original page layout". The lists stay, empty, so the next edit does not race their birth. */
export const resetPageLayout = (): PageLayoutOp => () => pageLayoutOf(undefined);
