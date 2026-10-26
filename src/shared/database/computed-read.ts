import { ComputedProperties } from './computed-properties';
import type { DatabaseSource } from './computed-properties';
import { relationIdsOf } from './relation-values';
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

const REMOTE_ROLLUP = 'Rolls up a database stored in another document; not computed here.';
const CYCLE = 'Depends on a database that depends on this one. Not computed here.';
const LIMIT = 'The formula passed a limit (text or list over 10,000, too much work, or a pattern that could run too long). The cell shows nothing.';

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

interface Loaded {
  schema: PropertyDefinition[];
  /** Numbered, without computed values. */
  rows: DatabaseRow[];
}

interface Computed {
  /** Undefined when the read was too large: a database that reads this one is too. */
  source?: DatabaseSource;
  values: Map<string, Record<string, ComputedRowValue>>;
}

/**
 * Rows plus stored relation links one read works out at most, over every
 * database it touches. The engine's relation and rollup work grows with both.
 */
export const MAX_COMPUTED_ROWS = 5_000;

/** Related databases one read follows at most. Also bounds the recursion below. */
export const MAX_RELATED_DATABASES = 100;

const TOO_LARGE = `Too large to work out here: the read touches more than ${MAX_COMPUTED_ROWS} database rows and links, or ${MAX_RELATED_DATABASES} databases.`;

/** Values that come from the related rows' own computed values. */
const DERIVED: ReadonlySet<string> = new Set(['formula', 'rollup', 'relation']);

/**
 * Reads the values a database cell shows but no row stores: formula, rollup,
 * relation (with self-relation back-links), unique ID and the four created
 * and edited columns. Uses the editor's own engine, so a read and a cell
 * agree. One reader per document state.
 *
 * Each database is worked out once. Databases that relate to each other in a
 * cycle read each other's stored values only, and a value that needs more is
 * marked, so the answer is the same whichever row is read first.
 * @param get - a block by id
 * @param now - the clock now() and today() read
 */
export const createComputedReader = (
  get: (id: string) => ComputedReadBlock | undefined,
  now: Date = new Date()
): ((rowId: string, parentId: string | null) => Record<string, ComputedRowValue> | undefined) => {
  const loaded = new Map<string, Loaded | undefined>();
  const done = new Map<string, Computed | undefined>();
  const component = new Map<string, number>();
  const budget = { rows: 0 };

  const load = (databaseId: string): Loaded | undefined => {
    if (loaded.has(databaseId)) return loaded.get(databaseId);
    const block = get(databaseId);
    const schema = block?.type === 'database' ? schemaOf(block.data) : [];
    const titleId = schema.find(p => p.type === 'title')?.id;
    const rows = block?.type !== 'database' ? [] : block.content.flatMap((id) => {
      const child = get(id);
      const row = child === undefined ? undefined : rowOf(id, child, titleId);

      return row === undefined ? [] : [row];
    });
    const result = block?.type !== 'database'
      ? undefined
      : { schema, rows: schema.filter(p => p.type === 'uniqueId').reduce((acc, p) => assignUniqueIds(acc, p.id), rows) };

    loaded.set(databaseId, result);

    return result;
  };

  /** Other databases of this document a database relates to. */
  const targetsOf = (databaseId: string): string[] => [...new Set((load(databaseId)?.schema ?? [])
    .flatMap(p => p.type === 'relation' && p.relation !== undefined && p.relation.targetDocumentId === undefined
      && p.relation.targetDatabaseId !== databaseId && load(p.relation.targetDatabaseId) !== undefined
      ? [p.relation.targetDatabaseId] : []))];

  /** Tarjan: numbers the strongly connected components reachable from a database. */
  const number = (start: string): void => {
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const visit = (id: string): void => {
      index.set(id, index.size);
      low.set(id, index.get(id) ?? 0);
      stack.push(id);
      targetsOf(id).filter(target => !component.has(target)).forEach((target) => {
        if (!index.has(target)) {
          visit(target);
          low.set(id, Math.min(low.get(id) ?? 0, low.get(target) ?? 0));
        } else if (stack.includes(target)) {
          low.set(id, Math.min(low.get(id) ?? 0, index.get(target) ?? 0));
        }
      });
      if (low.get(id) === index.get(id)) {
        const label = component.size;

        stack.splice(stack.lastIndexOf(id)).forEach(member => component.set(member, label));
      }
    };

    if (!component.has(start)) visit(start);
  };

  /** Whether more than MAX_RELATED_DATABASES databases are reachable. Iterative, so a long chain cannot overflow the stack. */
  const tooFar = (start: string): boolean => {
    const seen = new Set([start]);
    const queue = [start];

    // for...of visits what is pushed while it runs.
    for (const id of queue) {
      targetsOf(id).filter(target => !seen.has(target)).forEach((target) => {
        seen.add(target);
        queue.push(target);
      });
      if (seen.size > MAX_RELATED_DATABASES) return true;
    }

    return false;
  };

  const tooLarge = (databaseId: string, schema: PropertyDefinition[], rows: DatabaseRow[]): Computed => {
    const shown = schema.filter(p => SHOWN.has(p.type));
    const marked: Computed = {
      values: new Map(rows.map(row => [row.id, Object.fromEntries(shown.map(p => [p.id, { unavailable: TOO_LARGE }]))])),
    };

    done.set(databaseId, marked);

    return marked;
  };

  const compute = (databaseId: string): Computed | undefined => {
    if (done.has(databaseId)) return done.get(databaseId);
    const own = load(databaseId);

    if (own === undefined) {
      done.set(databaseId, undefined);

      return undefined;
    }
    const { schema, rows } = own;

    if (!component.has(databaseId) && tooFar(databaseId)) return tooLarge(databaseId, schema, rows);
    number(databaseId);
    const shown = schema.filter(p => SHOWN.has(p.type));
    const inCycle = (id: string): boolean => id !== databaseId && component.get(id) === component.get(databaseId);
    // Other components first: they never lead back here, so each is worked out once.
    const sources = new Map(targetsOf(databaseId).map((id): [string, DatabaseSource | undefined] => {
      const other = load(id);

      return [id, inCycle(id) ? other && { schema: other.schema, rows: other.rows } : compute(id)?.source];
    }));
    const starved = [...sources].some(([id, source]) => !inCycle(id) && source === undefined);

    const links = schema.filter(p => p.type === 'relation').reduce((sum, p) =>
      sum + rows.reduce((count, row) => count + relationIdsOf(row.properties[p.id]).length, 0), 0);
    const cost = rows.length + links;

    if (starved || budget.rows + cost > MAX_COMPUTED_ROWS) return tooLarge(databaseId, schema, rows);
    budget.rows += cost;
    const engine = new ComputedProperties(databaseId);
    const filled = engine.apply(schema, rows, { databaseId, now, resolveDatabase: id => sources.get(id) });
    const relationOf = (property: PropertyDefinition): PropertyDefinition | undefined =>
      property.type === 'relation' ? property : schema.find(p => p.id === property.rollup?.relationPropertyId);
    const reasonOf = (p: PropertyDefinition): string | undefined => {
      const relation = relationOf(p)?.relation;

      if (p.type === 'formula') {
        const compiled = engine.compile(p, schema);

        return compiled.ok ? undefined : `The formula has an error: ${compiled.error.message}. The cell shows nothing.`;
      }
      if (p.type !== 'rollup' || relation === undefined) return undefined;
      if (relation.targetDocumentId !== undefined) return REMOTE_ROLLUP;
      const target = inCycle(relation.targetDatabaseId)
        ? load(relation.targetDatabaseId)?.schema.find(t => t.id === p.rollup?.targetPropertyId)
        : undefined;

      return target !== undefined && DERIVED.has(target.type) ? CYCLE : undefined;
    };
    const reasons = new Map(shown.flatMap((p): Array<[string, string]> => {
      const reason = reasonOf(p);

      return reason === undefined ? [] : [[p.id, reason]];
    }));
    const readsIntoCycle = (id: string): boolean => {
      const used = schema.find(u => u.id === id);
      const target = used?.type === 'relation' ? used.relation?.targetDatabaseId : undefined;

      return reasons.get(id) === CYCLE || (target !== undefined && inCycle(target));
    };
    // A formula that reads into the cycle, or reads a marked value, is marked too, until none changes.
    const markBlocked = (): boolean => {
      const blocked = shown.filter((p) => {
        const compiled = p.type === 'formula' && !reasons.has(p.id) ? engine.compile(p, schema) : undefined;

        return compiled?.ok === true && compiled.formula.propSpans.some(span => readsIntoCycle(span.id));
      });

      blocked.forEach(p => reasons.set(p.id, CYCLE));

      return blocked.length > 0;
    };

    while (markBlocked());
    const values = new Map(filled.map((row): [string, Record<string, ComputedRowValue>] => [row.id, Object.fromEntries(shown.map((p): [string, ComputedRowValue] => {
      const reason = reasons.get(p.id);

      if (reason !== undefined) return [p.id, { unavailable: reason }];
      if (engine.limited(row.id, p.id)) return [p.id, { unavailable: LIMIT }];
      if (p.type === 'uniqueId') return [p.id, shownUniqueId(p, row.properties[p.id])];

      return [p.id, readPropertyValue(row, p) ?? null];
    }))]));
    const result: Computed = {
      source: { schema, rows: filled, valueProperty: (p) => engine.valueProperty(p) },
      values,
    };

    done.set(databaseId, result);

    return result;
  };

  return (rowId, parentId) => {
    if (parentId === null || get(rowId)?.type !== 'database-row') return undefined;
    const values = compute(parentId)?.values.get(rowId);

    return values === undefined || Object.keys(values).length === 0 ? undefined : values;
  };
};
