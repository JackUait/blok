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
 */
export const relatedTabSources = (
  schema: PropertyDefinition[],
  databaseId: string,
  mirrorOf: (property: PropertyDefinition) => string | undefined,
  titleOf: (databaseId: string) => string | undefined
): RelatedTabSource[] => schema.flatMap((property) => {
  const target = property.relation?.targetDatabaseId;

  if (property.type !== 'relation' || target === undefined || target === databaseId || property.relation?.targetDocumentId !== undefined) return [];
  const title = titleOf(target);
  const backPropertyId = mirrorOf(property);

  return title === undefined || backPropertyId === undefined ? [] : [{ propertyId: property.id, sourceId: target, backPropertyId, title }];
});

/** research/13 §1c: "<back property>: Contains This page", read per row page. */
export const thisPageFilter = (backPropertyId: string): FilterConfig => ({
  id: nanoid(),
  propertyId: backPropertyId,
  operator: 'contains',
  value: [THIS_PAGE_FILTER_VALUE],
});
