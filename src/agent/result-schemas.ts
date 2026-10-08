type Schema = Record<string, unknown>;

// Keep these shapes aligned with types/agent.d.ts and MCP delivery.
const STRING = { type: 'string' };
const INTEGER = { type: 'integer' };
const IDS = { type: 'array', items: STRING };

export const AGENT_ERROR_SCHEMA = {
  type: 'object',
  properties: {
    code: STRING,
    message: STRING,
    commandIndex: INTEGER,
    path: STRING,
    retryable: { type: 'boolean' },
    details: { type: 'object' },
  },
  required: ['code', 'message', 'retryable'],
};

const WARNING = {
  type: 'object',
  properties: { code: STRING, message: STRING, commandIndex: INTEGER, blockId: STRING, field: STRING },
  required: ['code', 'message'],
};

const CHANGED = {
  type: 'object',
  properties: { created: IDS, updated: IDS, moved: IDS, removed: IDS },
  required: ['created', 'updated', 'moved', 'removed'],
};

const RANGE = {
  type: 'object',
  properties: { blockId: STRING, field: STRING, start: INTEGER, end: INTEGER },
  required: ['blockId', 'field', 'start', 'end'],
};

export const DELIVERY_SCHEMA = {
  type: 'object',
  properties: {
    durable: { type: 'boolean' },
    pending: { type: 'boolean' },
    serverSequence: { type: ['string', 'null'] },
    savedVersion: { type: ['string', 'null'] },
  },
  required: ['durable', 'pending', 'serverSequence', 'savedVersion'],
};

const SUCCESS = {
  type: 'object',
  properties: {
    ok: { const: true },
    revision: STRING,
    results: { type: 'array' },
    refs: { type: 'object', additionalProperties: STRING },
    changed: CHANGED,
    lastRange: RANGE,
    warnings: { type: 'array', items: WARNING },
  },
  required: ['ok', 'revision', 'results', 'refs', 'changed', 'warnings'],
};

const FAILURE = {
  type: 'object',
  properties: {
    ok: { const: false },
    revision: STRING,
    error: AGENT_ERROR_SCHEMA,
    warnings: { type: 'array', items: WARNING },
  },
  required: ['ok', 'error', 'warnings'],
};

export const AGENT_RESULT_SCHEMA = { type: 'object', oneOf: [SUCCESS, FAILURE] };

export const withDelivery = (branch: typeof SUCCESS | typeof FAILURE): Schema => ({
  ...branch,
  properties: { ...branch.properties, delivery: DELIVERY_SCHEMA },
  required: [...branch.required, 'delivery'],
});

export const EXECUTE_OUTPUT_SCHEMA = { type: 'object', oneOf: [withDelivery(SUCCESS), withDelivery(FAILURE)] };

export const orError = (success: Schema): Schema => ({
  type: 'object',
  oneOf: [
    { allOf: [success, { not: { required: ['error'] } }] },
    {
      type: 'object',
      properties: { error: AGENT_ERROR_SCHEMA },
      required: ['error'],
      additionalProperties: false,
    },
  ],
});
