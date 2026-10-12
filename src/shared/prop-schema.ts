// src/shared/prop-schema.ts
import type { BlockToolDescription } from '../../types/tools/tool-description';
import { richText } from './tool-descriptions/rich-text';

/** One field of a block's prop schema. */
export interface PropSchemaEntry {
  /** Default value, used when the incoming data omits this key. */
  default: unknown;
  /** Optional allowed values (advisory; not enforced at runtime in v1). */
  values?: readonly unknown[];
}

/**
 * Declarative data shape. The keys here are EXACTLY the keys `save()` returns to
 * Yjs — this closes the per-key-sync key-resurrection gap (a cleared field is
 * written as its explicit default, never dropped).
 */
export type PropSchema = Record<string, PropSchemaEntry>;

/**
 * Fill a data object against the schema: every schema key present, incoming
 * value when defined else the schema default, and ONLY schema keys (so `save()`
 * is never partial). Returns a frozen plain object — safe to hand straight to
 * core's per-key Yjs sync.
 */
export const fillDefaults = <Data>(
  schema: PropSchema,
  data: Record<string, unknown>
): Readonly<Data> => {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(schema)) {
    result[key] = data[key] !== undefined ? data[key] : schema[key].default;
  }

  return Object.freeze(result) as Readonly<Data>;
};

const typeFor = (value: unknown): Record<string, unknown> =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? { type: typeof value } : {};

/**
 * Agent description for a framework block. propSchema keys are exactly what
 * save() returns, so the data object is closed.
 */
export const describeFromPropSchema = (input: {
  type: string;
  title?: string;
  propSchema: PropSchema;
  richTextFields?: string[];
}): BlockToolDescription => {
  const rich = new Set(input.richTextFields ?? []);
  const entries = Object.entries(input.propSchema);

  return {
    summary: `${input.title ?? input.type} block`,
    data: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(entries.map(([key, entry]) => [key, rich.has(key)
        ? richText(`Rich-text field "${key}".`)
        : { ...typeFor(entry.default), ...(entry.values === undefined ? {} : { enum: [...entry.values] }) }])),
    },
    defaultData: Object.fromEntries(entries.map(([key, entry]) => [key, entry.default])),
  };
};
