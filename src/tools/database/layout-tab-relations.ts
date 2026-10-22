import { nanoid } from 'nanoid';

import { THIS_PAGE_FILTER_VALUE } from './database-query';
import type { FilterConfig, PropertyDefinition } from './types';

/** A relation the Add tab menu offers as a view tab of the related database. */
export interface RelatedTabSource {
  propertyId: string;
  /** The related database, which the tab shows. */
  sourceId: string;
  /** The related database's mirror property, which the tab filters on. */
  backPropertyId: string;
  title: string;
}

/**
 * research/13 §1b: one item per relation to another database of this
 * document. The tab filters on the related side's mirror, so a relation
 * with no live mirror (one-way) has nothing to filter on and is left out.
 * research/36 §12: a relation to this same database is offered too, named
 * after the property. One-way, it filters on itself: its value reads both
 * ways, so "contains This page" finds the rows this one relates to.
 */
export const relatedTabSources = (
  schema: PropertyDefinition[],
  databaseId: string,
  mirrorOf: (property: PropertyDefinition) => string | undefined,
  titleOf: (databaseId: string) => string | undefined
): RelatedTabSource[] => schema.flatMap((property) => {
  const target = property.relation?.targetDatabaseId;

  if (property.type !== 'relation' || target === undefined || property.relation?.targetDocumentId !== undefined) return [];
  const self = target === databaseId;
  const title = self ? property.name : titleOf(target);
  const backPropertyId = mirrorOf(property) ?? (self ? property.id : undefined);

  return title === undefined || backPropertyId === undefined ? [] : [{ propertyId: property.id, sourceId: target, backPropertyId, title }];
});

/** research/13 §1c: "<back property>: Contains This page", read per row page. */
export const thisPageFilter = (backPropertyId: string): FilterConfig => ({
  id: nanoid(),
  propertyId: backPropertyId,
  operator: 'contains',
  value: [THIS_PAGE_FILTER_VALUE],
});
