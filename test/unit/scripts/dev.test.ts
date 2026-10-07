// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isBuildStale, parseDevArgs, playgroundSeedFor, resolveBackendMode, syncServiceArgs, vitePort } from '../../../scripts/dev.mjs';

describe('parseDevArgs', () => {
  it('takes --no-server off the list Vite receives', () => {
    const parsed = parseDevArgs(['--no-server']);

    expect(parsed.noServer).toBe(true);
    expect(parsed.viteArgs).not.toContain('--no-server');
  });

  it('leaves the backend on when the flag is absent', () => {
    expect(parseDevArgs([]).noServer).toBe(false);
  });

  it('forwards every other argument to Vite', () => {
    expect(parseDevArgs(['--port', '3000', '--host']).viteArgs).toEqual(
      expect.arrayContaining(['--port', '3000', '--host'])
    );
  });

  it('keeps --no-open, which the plain `vite --no-open` script used to pass', () => {
    expect(parseDevArgs([]).viteArgs).toContain('--no-open');
  });
});

describe('vitePort', () => {
  it('defaults to the port the Vite config declares', () => {
    expect(vitePort(['--no-open'])).toBe(3303);
  });

  it('reads a separated --port', () => {
    expect(vitePort(['--port', '3000'])).toBe(3000);
  });

  // The origin collaboration is pinned to is built from this, so missing the
  // equals form would leave the socket refused with nothing in the log.
  it('reads an --port=value', () => {
    expect(vitePort(['--port=3000'])).toBe(3000);
  });
});

describe('resolveBackendMode', () => {
  it('runs the backend when it is wanted and .NET is there', () => {
    expect(resolveBackendMode({ noServer: false, hasDotnet: true })).toEqual({
      enabled: true,
      reason: 'on',
    });
  });

  it('skips the backend when --no-server was passed', () => {
    expect(resolveBackendMode({ noServer: true, hasDotnet: true })).toEqual({
      enabled: false,
      reason: 'requested-off',
    });
  });

  it('degrades to frontend-only instead of failing when .NET is missing', () => {
    expect(resolveBackendMode({ noServer: false, hasDotnet: false })).toEqual({
      enabled: false,
      reason: 'no-dotnet',
    });
  });

  it('reports the explicit flag, not the missing toolchain, when both apply', () => {
    expect(resolveBackendMode({ noServer: true, hasDotnet: false }).reason).toBe('requested-off');
  });
});

describe('isBuildStale', () => {
  it('builds when nothing has been built yet', () => {
    expect(isBuildStale({ binaryMtimeMs: null, newestSourceMtimeMs: 1000 })).toBe(true);
  });

  it('rebuilds when a source file is newer than the binary', () => {
    expect(isBuildStale({ binaryMtimeMs: 1000, newestSourceMtimeMs: 2000 })).toBe(true);
  });

  // A no-change `dotnet build` still costs ~40s here, so an up-to-date binary
  // has to short-circuit or every `yarn serve` pays for it.
  it('reuses the binary when no source has moved', () => {
    expect(isBuildStale({ binaryMtimeMs: 2000, newestSourceMtimeMs: 1000 })).toBe(false);
  });

  it('reuses the binary when the newest source is exactly as old', () => {
    expect(isBuildStale({ binaryMtimeMs: 1000, newestSourceMtimeMs: 1000 })).toBe(false);
  });
});

describe('playgroundSeedFor', () => {
  const showcase = { blocks: [{ id: 's', type: 'paragraph', data: { text: 'showcase' } }] };
  const pages = {
    'getting-started': { blocks: [{ id: 'g', type: 'paragraph', data: { text: 'guide' } }] },
  };
  const seedFor = playgroundSeedFor({ showcase, pages });

  it('seeds the root document with the showcase', () => {
    expect(seedFor('playground')).toEqual(showcase);
  });

  // Each page is its own room; a page the user just made must open empty.
  it('seeds a new page empty', () => {
    expect(seedFor('playground--page--AChzQBnLop')).toEqual({ blocks: [] });
  });

  it('seeds a demo page with its own blocks', () => {
    expect(seedFor('playground--page--getting-started')).toEqual({ blocks: pages['getting-started'].blocks });
  });
});

describe('syncServiceArgs', () => {
  const args = syncServiceArgs({
    listen: '127.0.0.1:4000',
    origins: ['http://localhost:3303', 'http://127.0.0.1:3303'],
    collabDir: '/repo/.dev/collab',
    docEndpoint: 'http://127.0.0.1:4500/docs',
    storageDir: '/repo/.dev/uploads',
  });
  const valueOf = (flag: string): string | undefined => {
    const index = args.indexOf(flag);

    return index === -1 ? undefined : args[index + 1];
  };

  // History names its authors from ticket users; --auth none journals no actor.
  it('runs the service in ticket mode', () => {
    expect(valueOf('--auth')).toBe('ticket');
  });

  // Ticket mode turns on 60 requests a minute; one playground session uses more.
  it('turns the ticket-mode rate limit off', () => {
    expect(valueOf('--rate-limit')).toBe('0');
  });

  it('keeps the operation journal history is read from', () => {
    expect(args).toContain('--collab-journal');
    expect(args).toContain('--collab');
  });

  // The secret goes by BLOK_SECRET so it never shows in a process list.
  it('never puts a secret on the command line', () => {
    expect(args).not.toContain('--secret');
  });

  it('keeps the listen address, origins, rooms, store and uploads', () => {
    expect(valueOf('--listen')).toBe('127.0.0.1:4000');
    expect(valueOf('--allow-origin')).toBe('http://localhost:3303,http://127.0.0.1:3303');
    expect(valueOf('--collab-dir')).toBe('/repo/.dev/collab');
    expect(valueOf('--doc-endpoint')).toBe('http://127.0.0.1:4500/docs');
    expect(valueOf('--storage-dir')).toBe('/repo/.dev/uploads');
  });
});
