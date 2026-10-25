import type { PropertyValue } from './types';
import { toIsoDay, toIsoTime } from './date-value';

export interface DynamicContext {
  /** The current user's id, from the people lever. */
  me: string | null;
  now: Date;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A button's or a template's value with `@today`, `@now` and `@me` filled in.
 * `@me` drops out of a person list when the host has no current user.
 */
export const resolveDynamicValue = (value: PropertyValue, ctx: DynamicContext): PropertyValue => {
  if (value === '@today') return toIsoDay(ctx.now);
  if (value === '@now') return `${toIsoDay(ctx.now)}T${toIsoTime(ctx.now)}`;
  if (!Array.isArray(value)) return value;

  return (value as unknown[]).flatMap((item) => {
    if (!isRecord(item) || item.id !== '@me') return [item];

    return ctx.me === null ? [] : [{ ...item, id: ctx.me }];
  }) as PropertyValue;
};

export const resolveDynamicProperties = (
  properties: Record<string, PropertyValue>,
  ctx: DynamicContext
): Record<string, PropertyValue> =>
  Object.fromEntries(Object.entries(properties).map(([id, value]) => [id, resolveDynamicValue(value, ctx)]));
