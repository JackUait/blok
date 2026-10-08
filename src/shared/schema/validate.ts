export const SCHEMA_PROFILE_KEYWORDS: readonly string[] = [
  'type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'patternProperties',
  'items', 'oneOf', 'anyOf', 'allOf', 'if', 'then', 'minimum', 'maximum', 'exclusiveMinimum',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'deprecated', 'description',
  'default', 'examples',
];

export interface SchemaProblem {
  path: string;
  message: string;
}

type Schema = Readonly<Record<string, unknown>>;

const TYPES = ['string', 'number', 'integer', 'boolean', 'null', 'object', 'array'];
const SUBSCHEMA_MAPS = ['properties', 'patternProperties'];
const SUBSCHEMA_LISTS = ['oneOf', 'anyOf', 'allOf'];
const SUBSCHEMA_ONE = ['items', 'additionalProperties', 'if', 'then'];

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const pointer = (base: string, key: string | number): string =>
  `${base}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;

const isJson = (value: unknown): boolean => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (isArray(value)) {
    const items: unknown[] = value;

    return [...items].every(isJson);
  }

  return isRecord(value) && Object.values(value).every(isJson);
};

const sameJson = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }

  if (isArray(a) && isArray(b)) {
    const items: unknown[] = a;

    return items.length === b.length && items.every((item, index) => sameJson(item, b[index]));
  }

  if (!isRecord(a) || !isRecord(b)) {
    return false;
  }

  const keys = Object.keys(a);

  return keys.length === Object.keys(b).length &&
    keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && sameJson(a[key], b[key]));
};

const validPattern = (value: unknown): boolean => {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    new RegExp(value, 'u');

    return true;
  } catch {
    return false;
  }
};

const schemaMapError = (keyword: string, value: unknown, path: string): string | undefined => {
  const invalid = `invalid schema keyword at ${path}`;

  if (!isRecord(value)) {
    return invalid;
  }

  for (const [name, sub] of Object.entries(value)) {
    if (keyword === 'patternProperties' && !validPattern(name)) {
      return invalid;
    }

    const error = schemaError(sub, pointer(path, name));

    if (error !== undefined) {
      return error;
    }
  }

  return undefined;
};

const schemaListError = (value: unknown, path: string): string | undefined => {
  if (!isArray(value) || value.length === 0) {
    return `invalid schema keyword at ${path}`;
  }

  for (const [index, sub] of value.entries()) {
    const error = schemaError(sub, pointer(path, index));

    if (error !== undefined) {
      return error;
    }
  }

  return undefined;
};

const schemaKeywordError = (keyword: string, value: unknown, path: string): string | undefined => {
  const invalid = `invalid schema keyword at ${path}`;

  if (SUBSCHEMA_MAPS.includes(keyword)) {
    return schemaMapError(keyword, value, path);
  }

  if (SUBSCHEMA_LISTS.includes(keyword)) {
    return schemaListError(value, path);
  }

  if (SUBSCHEMA_ONE.includes(keyword)) {
    return keyword === 'additionalProperties' && typeof value === 'boolean' ? undefined : schemaError(value, path);
  }

  switch (keyword) {
    case 'type': {
      const types = isArray(value) ? [...value] : [value];

      if (types.length === 0 || new Set(types).size !== types.length ||
        !types.every(name => typeof name === 'string' && TYPES.includes(name))) {
        return invalid;
      }
      break;
    }
    case 'required': {
      if (!isArray(value)) {
        return invalid;
      }

      const names = [...value];

      if (!names.every(name => typeof name === 'string') || new Set(names).size !== names.length) {
        return invalid;
      }
      break;
    }
    case 'enum':
    case 'examples':
      if (!isArray(value) || !isJson(value)) {
        return invalid;
      }
      break;
    case 'const':
    case 'default':
      if (!isJson(value)) {
        return invalid;
      }
      break;
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return invalid;
      }
      break;
    case 'minLength':
    case 'maxLength':
    case 'minItems':
    case 'maxItems':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        return invalid;
      }
      break;
    case 'pattern':
      if (!validPattern(value)) {
        return invalid;
      }
      break;
    case 'description':
      if (typeof value !== 'string') {
        return invalid;
      }
      break;
    case 'deprecated':
      if (typeof value !== 'boolean') {
        return invalid;
      }
      break;
  }

  return undefined;
};

const schemaError = (schema: unknown, path = ''): string | undefined => {
  if (!isRecord(schema)) {
    return `expected a schema object at ${path || '/'}`;
  }

  for (const [keyword, value] of Object.entries(schema)) {
    const error = schemaKeywordError(keyword, value, pointer(path, keyword));

    if (error !== undefined) {
      return error;
    }
  }

  return undefined;
};

const typeOf = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }

  if (isArray(value)) {
    return 'array';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }

  return typeof value;
};

const checkNumber = (schema: Schema, value: number, path: string, out: SchemaProblem[]): void => {
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    out.push({ path, message: `must be >= ${schema.minimum}` });
  }

  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    out.push({ path, message: `must be <= ${schema.maximum}` });
  }

  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
    out.push({ path, message: `must be > ${schema.exclusiveMinimum}` });
  }
};

const checkString = (schema: Schema, value: string, path: string, out: SchemaProblem[]): void => {
  // JSON Schema counts code points, not UTF-16 units.
  const length = [...value].length;

  if (typeof schema.minLength === 'number' && length < schema.minLength) {
    out.push({ path, message: `must have at least ${schema.minLength} characters` });
  }

  if (typeof schema.maxLength === 'number' && length > schema.maxLength) {
    out.push({ path, message: `must have at most ${schema.maxLength} characters` });
  }

  if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
    out.push({ path, message: `must match ${schema.pattern}` });
  }
};

const checkArray = (schema: Schema, value: unknown[], path: string, out: SchemaProblem[]): void => {
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
    out.push({ path, message: `must have at least ${schema.minItems} items` });
  }

  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
    out.push({ path, message: `must have at most ${schema.maxItems} items` });
  }

  const items = isRecord(schema.items) ? schema.items : {};

  value.forEach((item, index) => check(items, item, pointer(path, index), out));
};

const checkObject = (schema: Schema, value: Record<string, unknown>, path: string, out: SchemaProblem[]): void => {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const patterns = isRecord(schema.patternProperties) ? Object.entries(schema.patternProperties) : [];

  const required = isArray(schema.required) ? schema.required : [];

  for (const key of required) {
    if (typeof key === 'string' && !Object.prototype.hasOwnProperty.call(value, key)) {
      out.push({ path, message: `missing required field "${key}"` });
    }
  }

  for (const [key, item] of Object.entries(value)) {
    const at = pointer(path, key);
    const declared = Object.prototype.hasOwnProperty.call(properties, key);
    const sub = declared ? properties[key] : undefined;
    const matched = patterns.filter(([pattern]) => new RegExp(pattern, 'u').test(key));

    if (isRecord(sub)) {
      check(sub, item, at, out);
    }

    matched.forEach(([, patternSchema]) => {
      if (isRecord(patternSchema)) {
        check(patternSchema, item, at, out);
      }
    });

    if (declared || matched.length > 0) {
      continue;
    }

    if (schema.additionalProperties === false) {
      out.push({ path: at, message: `unknown field "${key}"` });
    } else {
      const additional = isRecord(schema.additionalProperties) ? schema.additionalProperties : {};

      check(additional, item, at, out);
    }
  }
};

const passes = (schema: Schema, value: unknown): boolean => {
  const problems: SchemaProblem[] = [];

  check(schema, value, '', problems);

  return problems.length === 0;
};

const check = (schema: Schema, value: unknown, path: string, out: SchemaProblem[]): void => {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    out.push({ path, message: 'must be a finite number' });

    return;
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'type')) {
    const types: unknown[] = isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);

    if (!types.some(name => actual === name || (name === 'number' && actual === 'integer'))) {
      out.push({ path, message: `expected ${types.join(' or ')}, got ${actual}` });

      return;
    }
  }

  if (isArray(schema.enum) && !schema.enum.some((choice: unknown) => sameJson(choice, value))) {
    out.push({ path, message: 'must be one of the allowed values' });
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const') && !sameJson(schema.const, value)) {
    out.push({ path, message: 'must equal the constant value' });
  }

  if (typeof value === 'number') {
    checkNumber(schema, value, path, out);
  } else if (typeof value === 'string') {
    checkString(schema, value, path, out);
  } else if (isArray(value)) {
    checkArray(schema, value, path, out);
  } else if (isRecord(value)) {
    checkObject(schema, value, path, out);
  }

  const branches = (keyword: string): Schema[] => {
    const entries: unknown[] = isArray(schema[keyword]) ? schema[keyword] : [];

    return entries.filter(isRecord);
  };

  if (isArray(schema.oneOf)) {
    const matching = branches('oneOf').filter(branch => passes(branch, value)).length;

    if (matching !== 1) {
      out.push({ path, message: matching === 0 ? 'matches none of the allowed shapes' : 'matches more than one allowed shape' });
    }
  }

  if (isArray(schema.anyOf) && !branches('anyOf').some(branch => passes(branch, value))) {
    out.push({ path, message: 'matches none of the allowed shapes' });
  }

  branches('allOf').forEach(branch => check(branch, value, path, out));

  if (isRecord(schema.if) && isRecord(schema.then) && passes(schema.if, value)) {
    check(schema.then, value, path, out);
  }
};

export const validateAgainst = (schema: Schema, value: unknown): SchemaProblem[] => {
  // Check every branch before matching; unused invalid branches must also fail.
  const error = schemaError(schema);

  if (error !== undefined) {
    return [{ path: '', message: error }];
  }

  const out: SchemaProblem[] = [];

  check(schema, value, '', out);

  return out;
};

const findUnknown = (schema: unknown, path: string): string[] => {
  if (!isRecord(schema)) {
    return [];
  }

  return Object.entries(schema).flatMap(([keyword, value]) => {
    const at = pointer(path, keyword);

    if (!SCHEMA_PROFILE_KEYWORDS.includes(keyword)) {
      return [at];
    }

    if (SUBSCHEMA_MAPS.includes(keyword) && isRecord(value)) {
      return Object.entries(value).flatMap(([name, sub]) => findUnknown(sub, pointer(at, name)));
    }

    if (SUBSCHEMA_LISTS.includes(keyword) && isArray(value)) {
      const branches: unknown[] = value;

      return branches.flatMap((sub, index) => findUnknown(sub, pointer(at, index)));
    }

    return SUBSCHEMA_ONE.includes(keyword) ? findUnknown(value, at) : [];
  });
};

export const unknownKeywords = (schema: unknown): string[] => findUnknown(schema, '');
