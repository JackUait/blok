import type { JsonSchema, PlannerToolEntry, SchemaValidator } from './types';

export interface VariantMatch {
  tool: string;
  data: Record<string, unknown>;
}

type VariantSource = Pick<PlannerToolEntry, 'name' | 'data' | 'variants'>;

const squash = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A schema's per-field rules without root rules like `required`, which do not apply to partial writes. */
export const fieldRules = (schema: JsonSchema): JsonSchema => Object.fromEntries(Object.entries(schema).filter(([key]) =>
  key === 'properties' || key === 'patternProperties' || key === 'additionalProperties'));

/**
 * Variants whose name, title or a data value matches an unregistered type name ("checklist" is a list style).
 * Variants whose data the schema refuses are left out, so a hint never leads into DATA_REJECTED.
 */
export const matchVariants = (
  name: string,
  entries: Iterable<VariantSource>,
  validate: SchemaValidator
): VariantMatch[] => {
  const wanted = squash(name);
  const found = new Map<string, VariantMatch>();
  const named = (value: unknown): boolean => typeof value === 'string' && wanted !== '' && squash(value) === wanted;

  for (const entry of entries) {
    (entry.variants ?? [])
      .filter(variant => [variant.name, variant.title, ...Object.values(variant.data)].some(named))
      .filter(variant => Object.keys(variant.data).length > 0 && validate(fieldRules(entry.data), variant.data).length === 0)
      .forEach(variant => found.set(JSON.stringify([entry.name, variant.data]), { tool: entry.name, data: variant.data }));
  }

  return [...found.values()];
};

/** The sentence that follows "No block tool X …", or '' when nothing matches. */
export const variantSentence = (name: string, matches: readonly VariantMatch[]): string =>
  matches.length === 0
    ? ''
    : ` "${name}" is a variant: use ${matches.map(match => `type "${match.tool}" with data ${JSON.stringify(match.data)}`).join(', or ')}.`;
