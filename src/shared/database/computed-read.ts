import { ComputedProperties } from './computed-properties';
import type { DatabaseSource } from './computed-properties';
import { assignUniqueIds, readPropertyValue } from './value-helpers';
import type { DatabaseRow, DatabaseRowMeta, PropertyDefinition, PropertyValue } from './types';

/** A saved block as a read sees it. `rest` holds the block's createdAt/createdBy/lastEditedAt/lastEditedBy. */
export interface ComputedReadBlock {
  type: string;
  data: Record<string, unknown>;
  rest?: Record<string, unknown>;
  content: readonly string[];
}

/** A value a read cannot work out, and why. */
export interface UncomputedValue {
  unavailable: string;
}

export type ComputedRowValue = PropertyValue | UncomputedValue;

const SHOWN: ReadonlySet<string> = new Set([
  'formula', 'rollup', 'relation', 'uniqueId', 'createdTime', 'createdBy', 'lastEditedTime', 'lastEditedBy',
]);

const REMOTE_ROLLUP = 'Rolls up a database in another document. Not computed here.';
const CYCLE = 'Depends on a database that depends on this one. Not computed here.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const schemaOf = (data: Record<string, unknown>): PropertyDefinition[] =>
  Array.isArray(data.schema) ? data.schema.filter((p): p is PropertyDefinition => isRecord(p) && typeof p.id === 'string' && typeof p.type === 'string') : [];

const metaOf = (block: ComputedReadBlock, anonymous: boolean): DatabaseRowMeta => {
  const rest = block.rest ?? {};

  return {
    ...(typeof rest.createdAt === 'number' ? { createdAt: rest.createdAt } : {}),
    ...(!anonymous && typeof rest.createdBy === 'string' ? { createdBy: rest.createdBy } : {}),
    ...(typeof rest.lastEditedAt === 'number' ? { lastEditedAt: rest.lastEditedAt } : {}),
    ...(!anonymous && typeof rest.lastEditedBy === 'string' ? { lastEditedBy: rest.lastEditedBy } : {}),
    ...(anonymous ? { anonymous: true as const } : {}),
  };
};

/** A row as the database tool's syncRowsFromBlocks builds it. Templates are no rows. */
const rowOf = (id: string, block: ComputedReadBlock, titleId: string | undefined): DatabaseRow | undefined => {
  const data = block.data;

  if (block.type !== 'database-row' || data.template === true) return undefined;
  const properties: Record<string, PropertyValue> = isRecord(data.properties) ? { ...(data.properties as Record<string, PropertyValue>) } : {};

  // The top-level title is the merged one; properties[title] is a mirror.
  if (titleId !== undefined && typeof data.title === 'string') properties[titleId] = data.title;
  const meta = metaOf(block, data.anonymous === true);

  return {
    id,
    position: typeof data.position === 'string' ? data.position : '',
    properties,
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };
};

/** The ID the cell shows: "PREFIX-n", or n alone. */
const shownUniqueId = (property: PropertyDefinition, value: PropertyValue | undefined): PropertyValue => {
  if (typeof value !== 'number') return null;
  const prefix = property.uniqueId?.prefix;

  return prefix !== undefined && prefix !== '' ? `${prefix}-${value}` : value;
};

interface Computed {
  source: DatabaseSource;
  values: Map<string, Record<string, ComputedRowValue>>;
}

/**
 * Reads the values a database cell shows but no row stores: formula, rollup,
 * relation (with self-relation back-links), unique ID and the four created
 * and edited columns. Uses the editor's own engine, so a read and a cell
 * agree. One reader per document state: it caches every database it works out.
 * @param get - a block by id
 * @param now - the clock now() and today() read
 */
export const createComputedReader = (
  get: (id: string) => ComputedReadBlock | undefined,
  now: Date = new Date()
): ((rowId: string, parentId: string | null) => Record<string, ComputedRowValue> | undefined) => {
  const done = new Map<string, Computed | undefined>();
  const busy = new Set<string>();

  const compute = (databaseId: string): Computed | undefined => {
    if (done.has(databaseId)) return done.get(databaseId);
    const block = get(databaseId);

    if (block?.type !== 'database') {
      done.set(databaseId, undefined);

      return undefined;
    }
    const schema = schemaOf(block.data);
    const titleId = schema.find(p => p.type === 'title')?.id;
    const rows = block.content.flatMap((id) => {
      const child = get(id);
      const row = child === undefined ? undefined : rowOf(id, child, titleId);

      return row === undefined ? [] : [row];
    });
    const numbered = schema.filter(p => p.type === 'uniqueId').reduce((acc, p) => assignUniqueIds(acc, p.id), rows);
    const engine = new ComputedProperties(databaseId);
    const cycled = new Set<string>();

    busy.add(databaseId);
    const filled = (() => {
      try {
        return engine.apply(schema, numbered, {
          databaseId,
          now,
          resolveDatabase: (id) => {
            if (busy.has(id)) {
              cycled.add(id);

              return undefined;
            }

            return compute(id)?.source;
          },
        });
      } finally {
        busy.delete(databaseId);
      }
    })();
    const targetOf = (property: PropertyDefinition): PropertyDefinition | undefined =>
      property.type === 'relation' ? property : schema.find(p => p.id === property.rollup?.relationPropertyId);
    const reasonFor = (property: PropertyDefinition): string | undefined => {
      if (property.type === 'formula') {
        const compiled = engine.compile(property, schema);

        if (!compiled.ok) return `The formula has an error: ${compiled.error.message}. The cell shows nothing.`;
        const uses = new Set(compiled.formula.propSpans.map(span => span.id));
        const touchesCycle = schema.some(p => uses.has(p.id) && p.type !== 'formula' && (() => {
          const relation = targetOf(p)?.relation;

          return relation !== undefined && cycled.has(relation.targetDatabaseId);
        })());

        return touchesCycle ? CYCLE : undefined;
      }
      if (property.type !== 'rollup') return undefined;
      const relation = targetOf(property)?.relation;

      if (relation?.targetDocumentId !== undefined) return REMOTE_ROLLUP;

      return relation !== undefined && cycled.has(relation.targetDatabaseId) ? CYCLE : undefined;
    };
    const shown = schema.filter(p => SHOWN.has(p.type));
    const reasons = new Map(shown.flatMap((p): Array<[string, string]> => {
      const reason = reasonFor(p);

      return reason === undefined ? [] : [[p.id, reason]];
    }));
    const values = new Map(filled.map((row): [string, Record<string, ComputedRowValue>] => [row.id, Object.fromEntries(shown.map((p): [string, ComputedRowValue] => {
      const reason = reasons.get(p.id);

      if (reason !== undefined) return [p.id, { unavailable: reason }];
      if (p.type === 'uniqueId') return [p.id, shownUniqueId(p, row.properties[p.id])];

      return [p.id, readPropertyValue(row, p) ?? null];
    }))]));
    const result: Computed = {
      source: { schema, rows: filled, valueProperty: (p) => engine.valueProperty(p) },
      values,
    };

    // Worked out inside another database's work and cut short by a cycle: a
    // read of it on its own resolves that database, so keep it out of the cache.
    const nested = busy.size > 0;

    if (cycled.size === 0 || !nested) done.set(databaseId, result);

    return result;
  };

  return (rowId, parentId) => {
    if (parentId === null || get(rowId)?.type !== 'database-row') return undefined;
    const values = compute(parentId)?.values.get(rowId);

    return values === undefined || Object.keys(values).length === 0 ? undefined : values;
  };
};
