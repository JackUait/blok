// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkOptionSafety, McpConfigError, parseMcpArgs } from '../../../src/mcp/config';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseMcpArgs', () => {
  it('defaults to stdio with no auth, sync or tickets', () => {
    const { options, files } = parseMcpArgs([], {});

    expect(options.transport).toEqual({ kind: 'stdio' });
    expect(options.auth).toEqual({ kind: 'none' });
    expect(options.sync).toBeUndefined();
    expect(options.tickets).toBeUndefined();
    expect(options.source).toBeUndefined();
    expect(files).toEqual({});
  });

  it('reads a files source without changing its directory', () => {
    const { options } = parseMcpArgs(['--source', 'files:./docs'], {});

    expect(options.source).toEqual({ kind: 'files', dir: './docs' });
  });

  it('reads an endpoint source with its host credential', () => {
    const { options } = parseMcpArgs(
      ['--source', 'endpoint:https://app.example.com/api/docs'],
      { BLOK_DOC_ENDPOINT_AUTH: 'Bearer s3cret' },
    );

    expect(options.source).toEqual({
      kind: 'endpoint',
      url: 'https://app.example.com/api/docs',
      endpointAuth: 'Bearer s3cret',
    });
  });

  it('reads an endpoint listing URL', () => {
    const { options } = parseMcpArgs(
      [
        '--source', 'endpoint:https://app.example.com/api/docs',
        '--source-list', 'https://app.example.com/api/docs/list',
      ],
      { BLOK_DOC_ENDPOINT_AUTH: 'Bearer s3cret' },
    );

    expect(options.source).toEqual({
      kind: 'endpoint',
      url: 'https://app.example.com/api/docs',
      endpointAuth: 'Bearer s3cret',
      list: 'https://app.example.com/api/docs/list',
    });
  });

  it('reads HTTP transport from the environment', () => {
    const { options } = parseMcpArgs([], { BLOK_MCP_HTTP: '127.0.0.1:4100' });

    expect(options.transport).toEqual({ kind: 'http', listen: '127.0.0.1:4100' });
  });

  it('lets the HTTP flag override the environment', () => {
    const { options } = parseMcpArgs(
      ['--http', '127.0.0.1:4100'],
      { BLOK_MCP_HTTP: '0.0.0.0:4200' },
    );

    expect(options.transport).toEqual({ kind: 'http', listen: '127.0.0.1:4100' });
  });

  it('reads sync, origin and a signing secret from the environment', () => {
    const { options } = parseMcpArgs([], {
      BLOK_SYNC_URL: 'ws://127.0.0.1:4000/sync',
      BLOK_MCP_ORIGIN: 'http://localhost:5173',
      BLOK_SECRET: '0123456789abcdef0123456789abcdef',
    });

    expect(options.sync).toEqual({
      url: 'ws://127.0.0.1:4000/sync',
      origin: 'http://localhost:5173',
    });
    expect(options.tickets).toEqual({
      kind: 'secret',
      secret: '0123456789abcdef0123456789abcdef',
    });
  });

  it('lets sync and origin flags override their environment values', () => {
    const { options } = parseMcpArgs(
      ['--sync-url', 'ws://flag.example/sync', '--origin', 'https://flag.example'],
      { BLOK_SYNC_URL: 'ws://env.example/sync', BLOK_MCP_ORIGIN: 'https://env.example' },
    );

    expect(options.sync).toEqual({
      url: 'ws://flag.example/sync',
      origin: 'https://flag.example',
    });
  });

  it('parses a sync URL without a ticket mode, which the safety check then refuses', () => {
    const { options } = parseMcpArgs(['--sync-url', 'ws://127.0.0.1:4000/sync'], {});

    expect(options.sync).toEqual({ url: 'ws://127.0.0.1:4000/sync' });
    expect(options.tickets).toBeUndefined();
    expect(() => checkOptionSafety(options)).toThrow(McpConfigError);
  });

  it('does not create sync options for an origin alone', () => {
    const { options } = parseMcpArgs(['--origin', 'http://localhost:5173'], {});

    expect(options.sync).toBeUndefined();
  });

  it('does not configure tickets from an empty signing secret', () => {
    const { options } = parseMcpArgs([], { BLOK_SECRET: '' });

    expect(options.tickets).toBeUndefined();
  });

  it('reads a ticket URL and its host credential from the environment', () => {
    const { options } = parseMcpArgs([], {
      BLOK_TICKET_URL: 'https://app.example.com/tickets',
      BLOK_MCP_HOST_TOKEN: 'host-token',
    });

    expect(options.tickets).toEqual({
      kind: 'url',
      url: 'https://app.example.com/tickets',
      hostToken: 'host-token',
    });
  });

  it('prefers the ticket URL flag over the environment URL and signing secret', () => {
    const { options } = parseMcpArgs(
      ['--ticket-url', 'https://flag.example/tickets'],
      {
        BLOK_TICKET_URL: 'https://env.example/tickets',
        BLOK_MCP_HOST_TOKEN: 'host-token',
        BLOK_SECRET: '0123456789abcdef0123456789abcdef',
      },
    );

    expect(options.tickets).toEqual({
      kind: 'url',
      url: 'https://flag.example/tickets',
      hostToken: 'host-token',
    });
  });

  it('prefers an environment ticket URL over the signing secret', () => {
    const { options } = parseMcpArgs([], {
      BLOK_TICKET_URL: 'https://app.example.com/tickets',
      BLOK_MCP_HOST_TOKEN: 'host-token',
      BLOK_SECRET: '0123456789abcdef0123456789abcdef',
    });

    expect(options.tickets).toEqual({
      kind: 'url',
      url: 'https://app.example.com/tickets',
      hostToken: 'host-token',
    });
  });

  it('refuses a ticket URL flag without a host credential', () => {
    expect(() => parseMcpArgs(['--ticket-url', 'https://app.example.com/tickets'], {}))
      .toThrow(McpConfigError);
  });

  it('refuses an environment ticket URL without a host credential', () => {
    expect(() => parseMcpArgs([], { BLOK_TICKET_URL: 'https://app.example.com/tickets' }))
      .toThrow(McpConfigError);
  });

  it('refuses an empty host credential for a ticket URL', () => {
    expect(() => parseMcpArgs(
      ['--ticket-url', 'https://app.example.com/tickets'],
      { BLOK_MCP_HOST_TOKEN: '' },
    )).toThrow(McpConfigError);
  });

  it('does not fall back to the signing secret when a ticket URL lacks its credential', () => {
    expect(() => parseMcpArgs(
      ['--ticket-url', 'https://app.example.com/tickets'],
      { BLOK_SECRET: '0123456789abcdef0123456789abcdef' },
    )).toThrow(McpConfigError);
  });

  it('reads numeric, enum and principal flags', () => {
    const { options } = parseMcpArgs(
      [
        '--handle-idle-ms', '1000',
        '--max-handles', '2',
        '--schema', 'full',
        '--page-titles', 'page-map',
        '--principal', 'local-user',
      ],
      {},
    );

    expect(options).toMatchObject({
      handleIdleMs: 1000,
      maxHandlesPerPrincipal: 2,
      schema: 'full',
      pageTitles: 'page-map',
      principal: 'local-user',
    });
  });

  it('reads --schema mixed', () => {
    expect(parseMcpArgs(['--schema', 'mixed'], {}).options).toMatchObject({ schema: 'mixed' });
  });

  it('accepts the minimum positive handle limits', () => {
    const { options } = parseMcpArgs(['--handle-idle-ms', '1', '--max-handles', '1'], {});

    expect(options).toMatchObject({ handleIdleMs: 1, maxHandlesPerPrincipal: 1 });
  });

  it('accepts the default enum choices when explicitly supplied', () => {
    const { options } = parseMcpArgs(
      ['--schema', 'envelope', '--page-titles', 'off', '--auth', 'none'],
      {},
    );

    expect(options).toMatchObject({
      schema: 'envelope',
      pageTitles: 'off',
      auth: { kind: 'none' },
    });
  });

  it.each([
    { flag: '--schema', value: 'loose' },
    { flag: '--page-titles', value: 'on' },
    { flag: '--auth', value: 'basic' },
  ])('refuses $flag=$value', ({ flag, value }) => {
    expect(() => parseMcpArgs([flag, value], {})).toThrow(McpConfigError);
  });

  describe.each(['--handle-idle-ms', '--max-handles'])('%s', (flag) => {
    it.each(['0', '-1', '1.5', 'NaN', 'Infinity', 'word'])('refuses %s', (value) => {
      expect(() => parseMcpArgs([flag, value], {})).toThrow(McpConfigError);
    });
  });

  it('refuses an unsupported source kind', () => {
    expect(() => parseMcpArgs(['--source', 'ftp:x'], {})).toThrow(McpConfigError);
  });

  it('reads rich text fields JSON from the environment', () => {
    const { options } = parseMcpArgs([], {
      BLOK_RICH_TEXT_FIELDS: '{"callout":["title"],"card":["summary","body"]}',
    });

    expect(options.richTextFields).toEqual({
      callout: ['title'],
      card: ['summary', 'body'],
    });
  });

  it('lets rich text fields JSON from a flag override the environment', () => {
    const { options } = parseMcpArgs(
      ['--rich-text-fields', '{"callout":["title"]}'],
      { BLOK_RICH_TEXT_FIELDS: '{"card":["body"]}' },
    );

    expect(options.richTextFields).toEqual({ callout: ['title'] });
  });

  it('does not parse discarded environment JSON when a flag overrides it', () => {
    const { options } = parseMcpArgs(
      ['--rich-text-fields', '{"callout":["title"]}'],
      { BLOK_RICH_TEXT_FIELDS: '{' },
    );

    expect(options.richTextFields).toEqual({ callout: ['title'] });
  });

  it.each([
    { value: '{}', expected: {} },
    { value: '{"callout":[]}', expected: { callout: [] } },
  ])('accepts rich text fields JSON $value', ({ value, expected }) => {
    expect(parseMcpArgs(['--rich-text-fields', value], {}).options.richTextFields)
      .toEqual(expected);
  });

  describe.each(['flag', 'env'])('rich text fields from %s', (source) => {
    it.each([
      'null',
      '[]',
      '"title"',
      '42',
      'true',
      '{"callout":"title"}',
      '{"callout":null}',
      '{"callout":{}}',
      '{"callout":[1]}',
      '{"callout":["title",false]}',
    ])('refuses the invalid field map %s', (value) => {
      const argv = source === 'flag' ? ['--rich-text-fields', value] : [];
      const env = source === 'env' ? { BLOK_RICH_TEXT_FIELDS: value } : {};

      expect(() => parseMcpArgs(argv, env)).toThrow(McpConfigError);
    });

    it('refuses malformed JSON', () => {
      const argv = source === 'flag' ? ['--rich-text-fields', '{'] : [];
      const env = source === 'env' ? { BLOK_RICH_TEXT_FIELDS: '{' } : {};

      expect(() => parseMcpArgs(argv, env)).toThrow(McpConfigError);
      expect(() => parseMcpArgs(argv, env)).toThrow(/--rich-text-fields/);
    });
  });

  it('collects file-backed options without loading them', () => {
    const parsed = parseMcpArgs(
      ['--manifest', 'missing-manifest.json', '--manifest-overrides', 'missing-overrides.json', '--authorize', './missing-auth.mjs'],
      {},
    );

    expect(parsed.files).toEqual({
      manifest: 'missing-manifest.json',
      overrides: 'missing-overrides.json',
      authorize: './missing-auth.mjs',
    });
    expect(parsed.options).not.toHaveProperty('manifest');
    expect(parsed.options).not.toHaveProperty('overrides');
    expect(parsed.options).not.toHaveProperty('authorize');
  });

  it('collects an authorization webhook URL without loading it', () => {
    const parsed = parseMcpArgs(['--authorize', 'https://app.example.com/authorize'], {});

    expect(parsed.files).toEqual({ authorize: 'https://app.example.com/authorize' });
  });

  it('reads HTTP and complete OAuth settings', () => {
    const { options } = parseMcpArgs(
      [
        '--http', '127.0.0.1:4100',
        '--auth', 'oauth',
        '--oauth-issuer', 'https://id.example',
        '--oauth-audience', 'https://mcp.example',
        '--oauth-jwks', 'https://id.example/jwks',
      ],
      {},
    );

    expect(options.transport).toEqual({ kind: 'http', listen: '127.0.0.1:4100' });
    expect(options.auth).toEqual({
      kind: 'oauth',
      issuer: 'https://id.example',
      audience: 'https://mcp.example',
      jwksUrl: 'https://id.example/jwks',
    });
  });

  it.each([['--auth', 'none', '--auth', 'oauth'], ['--public', '--public']])('refuses flag given twice: %j', (...argv: string[]) => {
    expect(() => parseMcpArgs(['--http', '127.0.0.1:1', ...argv], {})).toThrow(McpConfigError);
  });

  it('turns on built-in comments only with --comments', () => {
    expect(parseMcpArgs(['--comments'], {}).options.comments).toBe(true);
    expect(parseMcpArgs([], {}).options).not.toHaveProperty('comments');
  });

  it('refuses --public without --http, where it would mean nothing', () => {
    expect(() => parseMcpArgs(['--public'], {})).toThrow(McpConfigError);
  });

  it('records public HTTP transport without applying the safety check during parsing', () => {
    const { options } = parseMcpArgs(['--http', '0.0.0.0:4100', '--public'], {});

    expect(options.transport).toEqual({ kind: 'http', listen: '0.0.0.0:4100', public: true });
    expect(options.auth).toEqual({ kind: 'none' });
  });

  it.each([
    {
      missing: '--oauth-issuer',
      argv: ['--auth', 'oauth', '--oauth-audience', 'https://mcp.example', '--oauth-jwks', 'https://id.example/jwks'],
    },
    {
      missing: '--oauth-audience',
      argv: ['--auth', 'oauth', '--oauth-issuer', 'https://id.example', '--oauth-jwks', 'https://id.example/jwks'],
    },
    {
      missing: '--oauth-jwks',
      argv: ['--auth', 'oauth', '--oauth-issuer', 'https://id.example', '--oauth-audience', 'https://mcp.example'],
    },
    { missing: 'all OAuth settings', argv: ['--auth', 'oauth'] },
  ])('refuses OAuth without $missing', ({ argv }) => {
    expect(() => parseMcpArgs(argv, {})).toThrow(McpConfigError);
  });

  describe.each([
    '--source',
    '--source-list',
    '--http',
    '--auth',
    '--sync-url',
    '--origin',
    '--ticket-url',
    '--schema',
    '--page-titles',
    '--rich-text-fields',
    '--handle-idle-ms',
    '--max-handles',
    '--principal',
    '--manifest',
    '--manifest-overrides',
    '--authorize',
  ])('value for %s', (flag) => {
    const env: Parameters<typeof parseMcpArgs>[1] = flag === '--ticket-url'
      ? { BLOK_MCP_HOST_TOKEN: 'host-token' }
      : {};

    it('refuses a missing value', () => {
      expect(() => parseMcpArgs([flag], env)).toThrow(McpConfigError);
    });

    it('does not consume the next flag as its value', () => {
      expect(() => parseMcpArgs([flag, '--public'], env)).toThrow(McpConfigError);
    });
  });

  describe.each([
    {
      flag: '--oauth-issuer',
      others: ['--oauth-audience', 'https://mcp.example', '--oauth-jwks', 'https://id.example/jwks'],
    },
    {
      flag: '--oauth-audience',
      others: ['--oauth-issuer', 'https://id.example', '--oauth-jwks', 'https://id.example/jwks'],
    },
    {
      flag: '--oauth-jwks',
      others: ['--oauth-issuer', 'https://id.example', '--oauth-audience', 'https://mcp.example'],
    },
  ])('value for $flag', ({ flag, others }) => {
    it('refuses a missing value', () => {
      expect(() => parseMcpArgs(['--auth', 'oauth', ...others, flag], {}))
        .toThrow(McpConfigError);
    });

    it('does not consume the next flag as its value', () => {
      expect(() => parseMcpArgs(['--auth', 'oauth', ...others, flag, '--public'], {}))
        .toThrow(McpConfigError);
    });
  });

  describe('flags it does not know', () => {
    it.each([
      ['--auth=oauth'],
      ['--http=127.0.0.1:8080'],
      ['--source=files:./docs'],
      ['--public=true'],
    ])('refuses the --name=value form %s instead of ignoring it', (arg) => {
      expect(() => parseMcpArgs([arg], {})).toThrow(new McpConfigError(`${arg.slice(0, arg.indexOf('='))} takes its value as the next argument, not after "="`));
    });

    it.each([['--sorce'], ['--help'], ['--version'], ['--']])('refuses the unknown flag %s', (arg) => {
      expect(() => parseMcpArgs(['--source', 'files:./docs', arg], {})).toThrow(new McpConfigError(`Unknown flag ${arg}`));
    });

    it('refuses a stray positional argument', () => {
      expect(() => parseMcpArgs(['files:./docs'], {})).toThrow(new McpConfigError('Unexpected argument "files:./docs"'));
    });

    it('refuses a second value after a flag', () => {
      expect(() => parseMcpArgs(['--schema', 'full', 'envelope'], {})).toThrow(new McpConfigError('Unexpected argument "envelope"'));
    });

    it('still accepts every flag the README documents', () => {
      const { options, files } = parseMcpArgs([
        '--source', 'endpoint:https://app.example/docs', '--source-list', 'https://app.example/list',
        '--sync-url', 'wss://sync.example', '--origin', 'https://app.example', '--ticket-url', 'https://app.example/ticket',
        '--http', '127.0.0.1:0', '--public', '--auth', 'oauth', '--oauth-issuer', 'https://id.example',
        '--oauth-audience', 'https://mcp.example', '--oauth-jwks', 'https://id.example/jwks', '--authorize', './authorize.mjs',
        '--principal', 'me', '--manifest', 'm.json', '--manifest-overrides', 'o.json', '--rich-text-fields', '{}',
        '--page-titles', 'page-map', '--schema', 'full', '--handle-idle-ms', '5', '--max-handles', '2',
      ], { BLOK_MCP_HOST_TOKEN: 'host-token' });

      expect(options.transport).toEqual({ kind: 'http', listen: '127.0.0.1:0', public: true });
      expect(options.auth.kind).toBe('oauth');
      expect(files).toEqual({ manifest: 'm.json', overrides: 'o.json', authorize: './authorize.mjs' });
    });
  });
});

describe('checkOptionSafety', () => {
  const base: Parameters<typeof checkOptionSafety>[0] = {
    transport: { kind: 'stdio' },
    auth: { kind: 'none' },
  };
  const oauth: Parameters<typeof checkOptionSafety>[0]['auth'] = {
    kind: 'oauth',
    issuer: 'https://id.example',
    audience: 'https://mcp.example',
    jwksUrl: 'https://id.example/jwks',
  };

  const ticketTransports: Parameters<typeof checkOptionSafety>[0]['transport'][] = [
    { kind: 'stdio' },
    { kind: 'http', listen: '127.0.0.1:4100' },
  ];

  describe.each(ticketTransports)('URL tickets over $kind', (transport) => {
    it('refuses an empty host credential', () => {
      const options: Parameters<typeof checkOptionSafety>[0] = {
        ...base,
        transport,
        tickets: { kind: 'url', url: 'https://app.example.com/tickets', hostToken: '' },
      };

      expect(() => checkOptionSafety(options)).toThrow(McpConfigError);
    });

    it('allows a nonempty host credential', () => {
      const options: Parameters<typeof checkOptionSafety>[0] = {
        ...base,
        transport,
        tickets: { kind: 'url', url: 'https://app.example.com/tickets', hostToken: 'host-token' },
      };

      expect(() => checkOptionSafety(options)).not.toThrow();
    });
  });

  describe('signing-secret tickets (spec §3.8)', () => {
    const secret: Parameters<typeof checkOptionSafety>[0]['tickets'] = { kind: 'secret', secret: 's3cret' };

    it('refuses HTTP with a signing secret and no authorize hook', () => {
      const options: Parameters<typeof checkOptionSafety>[0] = {
        ...base,
        transport: { kind: 'http', listen: '127.0.0.1:4100' },
        tickets: secret,
      };

      expect(() => checkOptionSafety(options)).toThrow(McpConfigError);
      expect(() => checkOptionSafety(options)).toThrow(/--authorize/);
    });

    it('allows HTTP with a signing secret and an authorize hook', () => {
      expect(() => checkOptionSafety({
        ...base,
        transport: { kind: 'http', listen: '127.0.0.1:4100' },
        tickets: secret,
        authorize: async () => true,
      })).not.toThrow();
    });

    it('allows stdio with a signing secret and no authorize hook', () => {
      expect(() => checkOptionSafety({ ...base, tickets: secret })).not.toThrow();
    });
  });

  // Spec §3.8 and line 336: over HTTP a per-document gate must exist. Either the
  // authorize hook, or a live-only server whose host mints each ticket (--ticket-url, no --source).
  describe('a per-document gate over HTTP', () => {
    const http: Parameters<typeof checkOptionSafety>[0]['transport'] = { kind: 'http', listen: '127.0.0.1:4100' };
    const files: Parameters<typeof checkOptionSafety>[0]['source'] = { kind: 'files', dir: './docs' };
    const ticketUrl: Parameters<typeof checkOptionSafety>[0]['tickets'] = { kind: 'url', url: 'https://app.example.com/tickets', hostToken: 'host-token' };
    const sync = { url: 'wss://sync.example.com/sync' };

    it.each([
      { label: 'OAuth and a files source', options: { auth: oauth, source: files } },
      { label: 'OAuth and an endpoint source', options: { auth: oauth, source: { kind: 'endpoint' as const, url: 'https://app.example.com/docs', endpointAuth: 'Bearer x' } } },
      { label: 'a ticket URL next to a source', options: { auth: oauth, source: files, sync, tickets: ticketUrl } },
      { label: 'no auth and nothing else', options: {} },
    ])('refuses $label without --authorize', ({ options }) => {
      const config: Parameters<typeof checkOptionSafety>[0] = { ...base, transport: http, ...options };

      expect(() => checkOptionSafety(config)).toThrow(McpConfigError);
      expect(() => checkOptionSafety(config)).toThrow(/--authorize/);
    });

    it('allows a source over HTTP with an authorize hook', () => {
      expect(() => checkOptionSafety({ ...base, auth: oauth, transport: http, source: files, authorize: async () => true })).not.toThrow();
    });

    it('allows a live-only server whose host mints each ticket', () => {
      expect(() => checkOptionSafety({ ...base, auth: oauth, transport: http, sync, tickets: ticketUrl })).not.toThrow();
    });

    it('leaves stdio as the local user, without a hook', () => {
      expect(() => checkOptionSafety({ ...base, source: files })).not.toThrow();
    });
  });

  it('allows local stdio without auth', () => {
    expect(() => checkOptionSafety(base)).not.toThrow();
  });

  // Spec §3.5/§3.8: every live handle carries a ticket whose user is the agent.
  describe.each(ticketTransports)('a sync URL over $kind', (transport) => {
    it('is refused without a ticket mode', () => {
      const options: Parameters<typeof checkOptionSafety>[0] = { ...base, transport, sync: { url: 'ws://127.0.0.1:4000/sync' } };

      expect(() => checkOptionSafety(options)).toThrow(McpConfigError);
      expect(() => checkOptionSafety(options)).toThrow(/BLOK_SECRET|--ticket-url/);
    });

    it('is allowed with URL tickets', () => {
      expect(() => checkOptionSafety({
        ...base,
        transport,
        sync: { url: 'ws://127.0.0.1:4000/sync' },
        tickets: { kind: 'url', url: 'https://app.example.com/tickets', hostToken: 'host-token' },
      })).not.toThrow();
    });
  });

  it.each(['127.0.0.1:4100', '[::1]:4100', 'localhost:4100'])
    ('allows loopback HTTP at %s without auth, given a per-document check', (listen) => {
      expect(() => checkOptionSafety({ ...base, transport: { kind: 'http', listen }, authorize: async () => true }))
        .not.toThrow();
    });

  it.each(['0.0.0.0:4100', '192.168.1.10:4100', 'mcp.example.com:4100', '[::]:4100'])
    ('refuses a non-loopback bind at %s without public opt-in', (listen) => {
      const options: Parameters<typeof checkOptionSafety>[0] = {
        ...base,
        transport: { kind: 'http', listen },
      };

      expect(() => checkOptionSafety(options)).toThrow(McpConfigError);
      expect(() => checkOptionSafety(options)).toThrow(/--public/);
    });

  it('still requires public opt-in when a non-loopback bind has OAuth', () => {
    expect(() => checkOptionSafety({
      ...base,
      auth: oauth,
      transport: { kind: 'http', listen: '0.0.0.0:4100' },
    })).toThrow(McpConfigError);
  });

  it.each(['0.0.0.0:4100', '127.0.0.1:4100'])
    ('refuses public HTTP at %s without auth', (listen) => {
      const options: Parameters<typeof checkOptionSafety>[0] = {
        ...base,
        transport: { kind: 'http', listen, public: true },
      };

      expect(() => checkOptionSafety(options)).toThrow(McpConfigError);
      expect(() => checkOptionSafety(options)).toThrow(/auth/);
    });

  it('allows public HTTP with OAuth', () => {
    expect(() => checkOptionSafety({
      ...base,
      auth: oauth,
      authorize: async () => true,
      transport: { kind: 'http', listen: '0.0.0.0:4100', public: true },
    })).not.toThrow();
  });
});
