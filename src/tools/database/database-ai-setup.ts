import { newView } from '../../shared/database/schema-ops';
import { positionBetween } from '../../shared/database/positions';
import { DATABASE_DEFAULT_TEXT } from '../../shared/database/default-text';
import { PROPERTY_TYPE_META } from './database-property-types';
import type { DatabaseSetup, DatabaseViewConfig, PropertyDefinition, ViewType } from './types';

/** Layouts a view may take from the host. A dashboard holds other blocks, so it is left out. */
const VIEW_TYPES: ReadonlySet<string> = new Set<ViewType>(['table', 'board', 'gallery', 'list', 'calendar', 'timeline', 'chart', 'feed', 'form', 'map']);

export interface AiSetupPlan {
  schema: PropertyDefinition[];
  views: DatabaseViewConfig[];
  activeViewId: string;
  title?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * The host's setup checked against the database it replaces. The title
 * property keeps its id, since rows and the backend already name it.
 */
export const planAiSetup = (
  current: { schema: PropertyDefinition[]; views: DatabaseViewConfig[] },
  answer: DatabaseSetup | null | undefined,
  newId: () => string
): AiSetupPlan | null => {
  if (!isRecord(answer) || !Array.isArray(answer.schema)) return null;
  const oldTitle = current.schema.find((p) => p.type === 'title');
  const hostTitle = answer.schema.find((p) => isRecord(p) && p.type === 'title');
  const titleId = oldTitle?.id ?? newId();
  const remap = (id: string): string => (hostTitle !== undefined && id === hostTitle.id ? titleId : id);
  const used = new Set<string>([titleId]);
  const kept: PropertyDefinition[] = [];

  for (const p of answer.schema) {
    const valid = isRecord(p) && typeof p.id === 'string' && typeof p.name === 'string' && p.name.trim() !== ''
      && Object.hasOwn(PROPERTY_TYPE_META, p.type) && p.type !== 'title';

    if (valid && !used.has(p.id)) {
      used.add(p.id);
      kept.push(structuredClone(p));
    }
  }
  const title: PropertyDefinition = {
    ...(oldTitle ?? { id: titleId, name: DATABASE_DEFAULT_TEXT.titleProperty, type: 'title', position: 'a0' }),
    ...(hostTitle !== undefined && typeof hostTitle.name === 'string' && hostTitle.name.trim() !== '' ? { name: hostTitle.name.trim() } : {}),
  };
  const schema = [title, ...kept].reduce<PropertyDefinition[]>((list, p) =>
    [...list, { ...p, position: positionBetween(list.at(-1)?.position ?? null, null) }], []);
  const ids = new Set(schema.map((p) => p.id));
  const real = (id: unknown): id is string => typeof id === 'string' && ids.has(remap(id));

  const views = (Array.isArray(answer.views) ? answer.views : [])
    .filter((view) => isRecord(view) && VIEW_TYPES.has(view.type) && typeof view.name === 'string')
    .reduce<DatabaseViewConfig[]>((list, view) => [...list, newView({
      id: newId(),
      name: view.name,
      type: view.type,
      position: positionBetween(list.at(-1)?.position ?? null, null),
      ...(real(view.groupBy) ? { groupBy: remap(view.groupBy) } : {}),
      sorts: (Array.isArray(view.sorts) ? view.sorts : []).filter((s) => real(s.propertyId))
        .map((s) => ({ id: newId(), propertyId: remap(s.propertyId), direction: s.direction === 'desc' ? 'desc' : 'asc' })),
      filters: (Array.isArray(view.filters) ? view.filters : []).filter((f) => real(f.propertyId))
        .map((f) => ({ id: newId(), propertyId: remap(f.propertyId), operator: f.operator, value: f.value })),
      visibleProperties: (Array.isArray(view.visibleProperties) ? view.visibleProperties : []).filter(real).map(remap),
    }, schema)], []);
  const shown = views.length > 0
    ? views
    : [newView({ id: newId(), name: DATABASE_DEFAULT_TEXT.viewTypeTable, type: 'table', position: 'a0', visibleProperties: kept.map((p) => p.id) }, schema)];
  const name = typeof answer.title === 'string' ? answer.title.trim() : '';

  return { schema, views: shown, activeViewId: shown[0].id, ...(name !== '' ? { title: name } : {}) };
};
