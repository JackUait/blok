// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_SKILLS } from '../../../src/shared/skills';

const ROOT = resolve(__dirname, '../../..');

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A plain substring check would let `--authorize` stand in for `--auth`.
const mentions = (text: string, name: string): boolean => new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`).test(text);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('@bloklabs/mcp README', () => {
  // The names come from the parser, so a flag added later fails here until it is documented.
  const config = readFileSync(resolve(ROOT, 'src/shared/mcp/config.ts'), 'utf-8');
  const readme = readFileSync(resolve(ROOT, 'packages/mcp/README.md'), 'utf-8');
  const flags = [...new Set([...config.matchAll(/'(--[a-z][a-z-]*)'/g)].map((match) => match[1]))];
  const envs = [...new Set([...config.matchAll(/env(?:\.|\[')([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]))];

  it('finds the parser names (non-vacuity)', () => {
    expect(flags.length).toBeGreaterThan(15);
    expect(flags).toContain('--auth');
    expect(envs).toContain('BLOK_SECRET');
  });

  it('matches whole names only', () => {
    expect(mentions('use --authorize here', '--auth')).toBe(false);
    expect(mentions('use `--auth oauth`', '--auth')).toBe(true);
  });

  it.each(flags)('documents %s', (flag) => {
    expect(mentions(readme, flag)).toBe(true);
  });

  it.each(envs)('documents %s', (env) => {
    expect(mentions(readme, env)).toBe(true);
  });

  it('states how an OAuth token names its principal', () => {
    expect(readme).toMatch(/principal is the token's `sub`/);
    expect(readme).toContain('`client:<client_id>`');
  });

  it('states how to declare custom inline tools in the custom tools file', () => {
    expect(readme).toContain('`inlineTools`');
    expect(readme).toMatch(/Function rules cannot go in a JSON file/);
  });

  it('states that flag values are separate arguments and unknown flags are refused', () => {
    expect(readme).toContain('`--auth=oauth`');
    expect(readme).toMatch(/unknown flag.*refuse/i);
  });

  it.each(AGENT_SKILLS.map((skill) => skill.id))('documents the %s prompt', (id) => {
    expect(readme).toContain(`| \`${id}\` |`);
  });

  it('states the version lockstep and the Markdown rule', () => {
    expect(readme).toMatch(/@bloklabs\/core[\s\S]*@bloklabs\/server|@bloklabs\/server[\s\S]*@bloklabs\/core/);
    expect(readme).toMatch(/never.*Markdown/i);
  });

  // The ports refuse a module hook (BlokMcpCli.cs, cli.go, cli.rs): only Node can load JavaScript.
  it('says a module --authorize hook works in Node only', () => {
    expect(readme).toMatch(/Anything else is a module path\. Its default export .* Node only: the C#, Go and Rust builds take only a webhook URL/);
    expect(readme).toContain('Per-document access hook. A module path works in Node only.');
  });

  it('lists the C#, Go and Rust builds and where they differ on purpose', () => {
    const section = readme.slice(readme.indexOf('## Other builds: C#, Go and Rust'), readme.indexOf('## Limits'));

    for (const name of ['Blok.Mcp', 'AddBlokMcp', 'MapBlokMcp', 'blokmcp.New', 'blok_mcp::Embedded::new', 'cargo build --release -p blok-mcp']) {
      expect(section, name).toContain(name);
    }
    expect(section).toMatch(/60 second limit per call/);
    expect(section).toMatch(/memory budget/);
    expect(section).toMatch(/Uploads work only through the library API/);
    expect(section).toMatch(/The C# library checks the `Host` header only when you list `AllowedHosts`/);
    expect(section).toMatch(/Rust library.*`hosts`.*other machines.*without OAuth/);
    expect(section).toMatch(/`LiveRooms` in C#, `Options\.Rooms` in Go and `rooms` in Rust/);
    expect(section).not.toMatch(/C# library opens live handles only/);
  });

  it('documents the nesting limit every build shares', () => {
    const limits = readme.slice(readme.indexOf('## Limits'));

    expect(limits).toMatch(/nest at most 48 levels of objects and arrays/);
  });
});

// Registries show these to whoever installs Blok.Mcp, so the list must follow the parser.
describe('Blok.Mcp server.json', () => {
  const config = readFileSync(resolve(ROOT, 'src/shared/mcp/config.ts'), 'utf-8');
  const envs = [...new Set([...config.matchAll(/env(?:\.|\[')([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]))].sort();
  const server = JSON.parse(readFileSync(resolve(ROOT, 'packages/server/dotnet/Blok.Mcp/.mcp/server.json'), 'utf-8')) as {
    packages: Array<{ environmentVariables: Array<{ name: string; isSecret: boolean }> }>;
  };
  const listed = server.packages[0].environmentVariables;

  it('lists every environment variable the parser reads, and no other', () => {
    expect(listed.map(({ name }) => name).sort()).toEqual(envs);
  });

  it('marks the secrets as secret', () => {
    expect(listed.filter(({ isSecret }) => isSecret).map(({ name }) => name).sort())
      .toEqual(['BLOK_DOC_ENDPOINT_AUTH', 'BLOK_MCP_HOST_TOKEN', 'BLOK_SECRET']);
  });
});

// 2.1.0 shipped the Go server earlier and the C# and Go MCP builds (CHANGELOG); only Rust has not shipped.
describe('which builds the READMEs say have shipped', () => {
  it.each(['packages/mcp/README.md', 'packages/server/README.md'])('%s names Rust as the one MCP build not shipped', (file) => {
    const text = readFileSync(resolve(ROOT, file), 'utf-8');

    expect(text).not.toContain('No release has shipped them yet.');
    expect(text).toMatch(/Rust build has not shipped/);
  });
});
