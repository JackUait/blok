const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Inlines local $refs, so the in-house validator (no $ref support) checks what a model reads. Throws on a dangling one. */
export const inlineRefs = (root: Record<string, unknown>): Record<string, unknown> => {
  const defs = isRecord(root.$defs) ? root.$defs : {};
  // A recursive def (insertSpec's children) is left open past its first level.
  const inline = (value: unknown, open: ReadonlySet<string>): unknown => {
    if (Array.isArray(value)) {
      return value.map(item => inline(item, open));
    }
    if (!isRecord(value)) {
      return value;
    }
    if (typeof value.$ref === 'string') {
      const name = value.$ref.replace('#/$defs/', '');
      const target = defs[name];

      if (target === undefined) {
        throw new Error(`dangling ${value.$ref}`);
      }

      return open.has(name) ? {} : inline(target, new Set([...open, name]));
    }

    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$defs').map(([key, child]) => [key, inline(child, open)]));
  };
  const inlined = inline(root, new Set());

  return isRecord(inlined) ? inlined : {};
};
