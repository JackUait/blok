type Schema = Record<string, unknown>;

const isSchema = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const SCHEMA_MAPS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
const SCHEMA_LISTS = ['oneOf', 'anyOf', 'allOf', 'prefixItems'];
const SCHEMA_VALUES = [
  'items', 'additionalProperties', 'additionalItems', 'contains', 'propertyNames',
  'if', 'then', 'else', 'not', 'unevaluatedProperties', 'unevaluatedItems',
];

const schemaChildren = (value: Schema): unknown[] => [
  ...SCHEMA_MAPS.flatMap(key => isSchema(value[key]) ? Object.values(value[key]) : []),
  ...SCHEMA_LISTS.map(key => value[key]),
  ...SCHEMA_VALUES.map(key => value[key]),
];

export function isClosedSchema(schema: unknown, requireAllProperties = false): boolean {
  const path = new Set<unknown>();

  const visit = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) {
      return true;
    }

    if (path.has(value)) {
      return false;
    }

    path.add(value);

    if (Array.isArray(value)) {
      const values: unknown[] = value;
      const closed = values.every(visit);

      path.delete(value);

      return closed;
    }

    if (!isSchema(value)) {
      return false;
    }

    const types: unknown[] = Array.isArray(value.type) ? value.type : [value.type];
    const objectSchema = types.includes('object') || isSchema(value.properties) || isSchema(value.patternProperties);
    const properties = isSchema(value.properties) ? value.properties : {};
    const required: unknown[] = Array.isArray(value.required) ? value.required : [];

    if (objectSchema && (value.additionalProperties !== false ||
      (requireAllProperties && Object.keys(properties).some(key => !required.includes(key))))) {
      return false;
    }

    // Literal values in enum, const and examples are not schemas.
    const childrenClosed = schemaChildren(value).every(visit);

    path.delete(value);

    return childrenClosed;
  };

  return visit(schema);
}

export function cloneSchema(schema: Readonly<Schema>): Schema {
  const path = new Set<unknown>();

  const copy = (value: unknown): unknown => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) {
      return value;
    }

    if (typeof value !== 'object' || value === null || path.has(value)) {
      throw new TypeError('Schema must be JSON without cycles or non-JSON values');
    }

    path.add(value);

    if (Array.isArray(value)) {
      const values: unknown[] = value;
      const copied = Array.from(values, copy);

      path.delete(value);

      return copied;
    }

    if (!isSchema(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
      throw new TypeError('Schema must contain only JSON objects');
    }

    const entries: Array<[string, unknown]> = Object.entries(value).map(([key, child]) => [key, copy(child)]);

    path.delete(value);

    return Object.fromEntries(entries);
  };
  const cloned = copy(schema);

  if (!isSchema(cloned)) {
    throw new TypeError('Schema root must be an object');
  }

  return cloned;
}

export interface SchemaSize {
  properties: number;
  depth: number;
  enumValues: number;
}

export function measureSchema(schema: unknown): SchemaSize {
  const size: SchemaSize = { properties: 0, depth: 0, enumValues: 0 };
  const path = new Set<unknown>();

  const visit = (value: unknown, depth: number): void => {
    if (typeof value !== 'object' || value === null) {
      return;
    }

    if (path.has(value)) {
      throw new TypeError('Schema must be JSON without cycles');
    }

    path.add(value);

    if (Array.isArray(value)) {
      const values: unknown[] = value;

      values.forEach(child => visit(child, depth));
    } else if (isSchema(value)) {
      const properties = isSchema(value.properties) ? value.properties : undefined;
      const here = properties === undefined ? depth : depth + 1;

      size.depth = Math.max(size.depth, here);
      size.properties += properties === undefined ? 0 : Object.keys(properties).length;
      size.enumValues += Array.isArray(value.enum) ? value.enum.length : 0;
      schemaChildren(value).forEach(child => visit(child, here));
    }

    path.delete(value);
  };

  visit(schema, 0);

  return size;
}

export function hoistDefs(prefix: string, schema: Readonly<Schema>, into: Schema): Schema {
  const cloned = cloneSchema(schema);
  const defs = isSchema(cloned.$defs) ? cloned.$defs : {};
  const names = new Map<string, string>();
  const used = new Set(Object.keys(into));
  const reserved = new Set(Object.keys(defs).map(name => `${prefix}__${name}`));

  Object.keys(defs).forEach(name => {
    const base = `${prefix}__${name}`;
    const candidate = { key: base, suffix: 2 };

    while (used.has(candidate.key) || (candidate.key !== base && reserved.has(candidate.key))) {
      candidate.key = `${base}__${candidate.suffix++}`;
    }

    names.set(name, candidate.key);
    used.add(candidate.key);
  });
  const pointerToken = (name: string): string => name.replace(/~/g, '~0').replace(/\//g, '~1');

  const rewrite = (value: unknown): void => {
    if (Array.isArray(value)) {
      const values: unknown[] = value;

      values.forEach(rewrite);

      return;
    }

    if (!isSchema(value)) {
      return;
    }

    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/$defs/')) {
      const local = value.$ref.slice('#/$defs/'.length);
      const slash = local.indexOf('/');
      const token = slash < 0 ? local : local.slice(0, slash);
      const suffix = slash < 0 ? '' : local.slice(slash);
      const name = token.replace(/~1/g, '/').replace(/~0/g, '~');

      const key = names.get(name);

      if (key === undefined) {
        throw new TypeError(`Missing local schema definition: ${name}`);
      }

      Object.defineProperty(value, '$ref', {
        value: `#/$defs/${pointerToken(key)}${suffix}`,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }

    schemaChildren(value).forEach(rewrite);
  };

  rewrite(cloned);
  names.forEach((key, name) => {
    Object.defineProperty(into, key, {
      value: defs[name],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  });
  delete cloned.$defs;

  return cloned;
}
