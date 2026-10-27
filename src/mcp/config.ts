import type { BlokMcpOptions } from './options';

export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpConfigError';
  }
}

export interface ParsedCli {
  options: Omit<BlokMcpOptions, 'authorize' | 'manifest' | 'overrides'>;
  files: { manifest?: string; overrides?: string; authorize?: string };
}

const VALUE_FLAGS = new Set([
  '--http', '--auth', '--sync-url', '--origin', '--ticket-url', '--oauth-issuer', '--oauth-audience', '--oauth-jwks',
  '--source', '--source-list', '--page-titles', '--rich-text-fields', '--schema', '--handle-idle-ms', '--max-handles',
  '--principal', '--manifest', '--manifest-overrides', '--authorize',
]);
const SWITCH_FLAGS = new Set(['--public']);

// `flag()` looks names up by exact match, so `--auth=oauth` or a typo would be silently ignored.
const checkArgs = (argv: string[]): void => {
  const at = { index: 0 };
  const seen = new Set<string>();

  while (at.index < argv.length) {
    const arg = argv[at.index];

    if (!arg.startsWith('--')) {
      throw new McpConfigError(`Unexpected argument "${arg}"`);
    }
    const equals = arg.indexOf('=');

    if (equals > 2) {
      throw new McpConfigError(`${arg.slice(0, equals)} takes its value as the next argument, not after "="`);
    }
    if (!VALUE_FLAGS.has(arg) && !SWITCH_FLAGS.has(arg)) {
      throw new McpConfigError(`Unknown flag ${arg}`);
    }
    // flag() reads the first copy only, so a second one would be silently ignored.
    if (seen.has(arg)) {
      throw new McpConfigError(`${arg} is given twice`);
    }
    seen.add(arg);
    at.index += VALUE_FLAGS.has(arg) ? 2 : 1;
  }
};

const flag = (argv: string[], name: string): string | undefined => {
  const index = argv.indexOf(name);

  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];

  if (value === undefined || value.startsWith('--')) {
    throw new McpConfigError(`${name} needs a value`);
  }

  return value;
};

const positiveInt = (name: string, raw: string | undefined): number | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);

  if (!Number.isInteger(value) || value < 1) {
    throw new McpConfigError(`${name} must be a positive integer, got "${raw}"`);
  }

  return value;
};

const oneOf = <T extends string>(name: string, raw: string | undefined, allowed: readonly T[]): T | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const match = allowed.find((value) => value === raw);

  if (match === undefined) {
    throw new McpConfigError(`${name} must be one of ${allowed.join(', ')}, got "${raw}"`);
  }

  return match;
};

const parseSource = (
  raw: string | undefined,
  env: Record<string, string | undefined>,
  list: string | undefined
): BlokMcpOptions['source'] => {
  if (raw === undefined) {
    return undefined;
  }
  if (raw.startsWith('files:')) {
    return { kind: 'files', dir: raw.slice('files:'.length) };
  }
  if (raw.startsWith('endpoint:')) {
    return {
      kind: 'endpoint',
      url: raw.slice('endpoint:'.length),
      endpointAuth: env.BLOK_DOC_ENDPOINT_AUTH ?? '',
      ...(list !== undefined && { list }),
    };
  }

  throw new McpConfigError(`--source must be files:<dir> or endpoint:<url>, got "${raw}"`);
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((field: unknown) => typeof field === 'string');

const isRichTextFields = (value: unknown): value is Record<string, string[]> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.values(value).every(isStringArray);

const parseRichTextFields = (raw: string | undefined): BlokMcpOptions['richTextFields'] => {
  if (raw === undefined) {
    return undefined;
  }
  const parsed: unknown = (() => {
    try {
      const value: unknown = JSON.parse(raw);

      return value;
    } catch {
      return undefined;
    }
  })();

  if (!isRichTextFields(parsed)) {
    throw new McpConfigError('--rich-text-fields must be JSON like {"callout":["title"]}');
  }

  return parsed;
};

const parseAuth = (argv: string[], kind: 'none' | 'oauth'): BlokMcpOptions['auth'] => {
  if (kind === 'none') {
    return { kind: 'none' };
  }
  const issuer = flag(argv, '--oauth-issuer');
  const audience = flag(argv, '--oauth-audience');
  const jwksUrl = flag(argv, '--oauth-jwks');

  if (issuer === undefined || audience === undefined || jwksUrl === undefined) {
    throw new McpConfigError('--auth oauth needs --oauth-issuer, --oauth-audience and --oauth-jwks');
  }

  return { kind: 'oauth', issuer, audience, jwksUrl };
};

const parseTickets = (
  ticketUrl: string | undefined,
  env: Record<string, string | undefined>
): BlokMcpOptions['tickets'] => {
  if (ticketUrl !== undefined) {
    const hostToken = env.BLOK_MCP_HOST_TOKEN;

    if (hostToken === undefined || hostToken === '') {
      throw new McpConfigError('--ticket-url needs BLOK_MCP_HOST_TOKEN');
    }

    return { kind: 'url', url: ticketUrl, hostToken };
  }

  return env.BLOK_SECRET !== undefined && env.BLOK_SECRET !== ''
    ? { kind: 'secret', secret: env.BLOK_SECRET }
    : undefined;
};

export const parseMcpArgs = (
  argv: string[],
  env: Record<string, string | undefined>
): ParsedCli => {
  checkArgs(argv);
  const http = flag(argv, '--http') ?? env.BLOK_MCP_HTTP;
  const authKind = oneOf('--auth', flag(argv, '--auth'), ['none', 'oauth'] as const) ?? 'none';
  const syncUrl = flag(argv, '--sync-url') ?? env.BLOK_SYNC_URL;
  const origin = flag(argv, '--origin') ?? env.BLOK_MCP_ORIGIN;
  const ticketUrl = flag(argv, '--ticket-url') ?? env.BLOK_TICKET_URL;
  const auth = parseAuth(argv, authKind);
  const tickets = parseTickets(ticketUrl, env);

  if (http === undefined && argv.includes('--public')) {
    throw new McpConfigError('--public applies to --http only');
  }

  const options: ParsedCli['options'] = {
    transport: http === undefined
      ? { kind: 'stdio' }
      : { kind: 'http', listen: http, ...(argv.includes('--public') && { public: true }) },
    auth,
    ...(syncUrl !== undefined && { sync: { url: syncUrl, ...(origin !== undefined && { origin }) } }),
    ...(tickets !== undefined && { tickets }),
    source: parseSource(flag(argv, '--source'), env, flag(argv, '--source-list')),
    pageTitles: oneOf('--page-titles', flag(argv, '--page-titles'), ['off', 'page-map'] as const),
    richTextFields: parseRichTextFields(flag(argv, '--rich-text-fields') ?? env.BLOK_RICH_TEXT_FIELDS),
    schema: oneOf('--schema', flag(argv, '--schema'), ['envelope', 'full', 'mixed'] as const),
    handleIdleMs: positiveInt('--handle-idle-ms', flag(argv, '--handle-idle-ms')),
    maxHandlesPerPrincipal: positiveInt('--max-handles', flag(argv, '--max-handles')),
    principal: flag(argv, '--principal'),
  };
  const manifest = flag(argv, '--manifest');
  const overrides = flag(argv, '--manifest-overrides');
  const authorize = flag(argv, '--authorize');

  return {
    options,
    files: {
      ...(manifest !== undefined && { manifest }),
      ...(overrides !== undefined && { overrides }),
      ...(authorize !== undefined && { authorize }),
    },
  };
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

const hostOf = (listen: string): string => listen.startsWith('[')
  ? listen.slice(0, listen.indexOf(']') + 1)
  : listen.slice(0, listen.lastIndexOf(':'));

const UPLOAD_KINDS = new Set(['image', 'video', 'audio', 'file']);

const checkUploadLimit = (kind: string, limit: unknown): void => {
  if (!UPLOAD_KINDS.has(kind)) {
    throw new McpConfigError(`uploads.limits.${kind} is not a kind: use image, video, audio or file`);
  }
  if (typeof limit !== 'object' || limit === null || Array.isArray(limit)) {
    throw new McpConfigError(`uploads.limits.${kind} must be an object with types and maxSize`);
  }
  const types: unknown = Reflect.get(limit, 'types');
  const maxSize: unknown = Reflect.get(limit, 'maxSize');

  if (types !== undefined && !(Array.isArray(types) && types.every(type => typeof type === 'string'))) {
    throw new McpConfigError(`uploads.limits.${kind}.types must be a list of MIME types`);
  }
  if (maxSize !== undefined && !(typeof maxSize === 'number' && Number.isSafeInteger(maxSize) && maxSize > 0)) {
    throw new McpConfigError(`uploads.limits.${kind}.maxSize must be a positive whole number of bytes`);
  }
};

const checkUploads = (options: BlokMcpOptions): void => {
  const uploads = options.uploads;

  if (uploads === undefined) {
    return;
  }
  if (typeof uploads.uploader?.uploadByFile !== 'function') {
    throw new McpConfigError('uploads.uploader needs an uploadByFile function');
  }
  const limits: unknown = uploads.limits;

  if (limits !== undefined && (typeof limits !== 'object' || limits === null || Array.isArray(limits))) {
    throw new McpConfigError('uploads.limits must be an object keyed by image, video, audio or file');
  }
  for (const [kind, limit] of Object.entries(limits ?? {})) {
    checkUploadLimit(kind, limit);
  }
  // Over HTTP the caller is remote, and a path would read this machine's disk for them.
  if (uploads.root !== undefined && options.transport.kind === 'http') {
    throw new McpConfigError('uploads.root reads local files, so it works over stdio only');
  }
};

export const checkOptionSafety = (options: BlokMcpOptions): void => {
  checkUploads(options);
  if (options.tickets?.kind === 'url'
    && (options.tickets.hostToken === undefined || options.tickets.hostToken === '')) {
    throw new McpConfigError('--ticket-url needs BLOK_MCP_HOST_TOKEN');
  }
  // Spec §3.5/§3.8: a live handle needs a ticket whose user is the agent, or the room cannot name it.
  if (options.sync !== undefined && options.tickets === undefined) {
    throw new McpConfigError('--sync-url needs a ticket mode: set BLOK_SECRET, or --ticket-url with BLOK_MCP_HOST_TOKEN');
  }
  if (options.transport.kind !== 'http') {
    return;
  }
  // Spec §3.8: a signing secret with no authorize hook would mint a ticket for any HTTP caller.
  if (options.tickets?.kind === 'secret' && options.authorize === undefined) {
    throw new McpConfigError('A signing secret over HTTP needs --authorize, or use --ticket-url');
  }
  const loopback = LOOPBACK_HOSTS.has(hostOf(options.transport.listen));

  if (!loopback && options.transport.public !== true) {
    throw new McpConfigError(`Refusing to bind ${options.transport.listen}: a non-loopback address needs --public`);
  }
  if (options.transport.public === true && options.auth.kind === 'none') {
    throw new McpConfigError('--public needs --auth oauth: a public MCP endpoint without auth opens every document');
  }
  // Spec §3.8: endpointAuth and OAuth say who calls, not which documents they may open.
  // Over HTTP that per-document decision is --authorize, or the host's --ticket-url with no --source.
  const hostDecides = options.tickets?.kind === 'url' && options.source === undefined;

  if (options.authorize === undefined && !hostDecides) {
    throw new McpConfigError('HTTP needs a per-document check: pass --authorize, or serve live rooms only with --ticket-url and no --source');
  }
};
