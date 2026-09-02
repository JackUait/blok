import fs, {
  mkdirSync,
  mkdtempSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, UserConfig, ViteDevServer } from 'vite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import viteConfig from '../vite.config';

type Response = {
  statusCode: number;
  headers: Map<string, string>;
  setHeader: (name: string, value: string) => void;
  end: (data?: string) => void;
};

type Middleware = (
  request: { url?: string },
  response: Response,
  next: () => void,
) => void;

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '..', '..');
const parentDistDir = resolve(repoRoot, 'dist');
const rootPackagePath = resolve(repoRoot, 'package.json');
let createdParentDistDir = false;

const getExternalDistPlugin = (): Plugin => {
  const config = viteConfig as UserConfig;
  const plugin = config.plugins?.flat().find((candidate): candidate is Plugin => (
    typeof candidate === 'object' &&
    candidate !== null &&
    'name' in candidate &&
    candidate.name === 'external-dist'
  ));

  if (plugin === undefined) {
    throw new Error('external-dist plugin not found');
  }

  return plugin;
};

const getExternalDistMiddleware = (): Middleware => {
  const plugin = getExternalDistPlugin();

  if (typeof plugin.configureServer !== 'function') {
    throw new Error('external-dist configureServer hook not found');
  }

  let middleware: unknown;
  const server = {
    watcher: { add: vi.fn(), on: vi.fn() },
    moduleGraph: { idToModuleMap: new Map() },
    ws: { send: vi.fn() },
    middlewares: {
      use(handler: unknown) {
        middleware = handler;
      },
    },
  } as unknown as ViteDevServer;

  const context = {} as unknown as ThisParameterType<typeof plugin.configureServer>;
  plugin.configureServer.call(context, server);

  if (typeof middleware !== 'function') {
    throw new Error('external-dist middleware not registered');
  }

  return middleware as Middleware;
};

const request = (middleware: Middleware, url: string): Response => {
  const headers = new Map<string, string>();
  const response: Response = {
    statusCode: 200,
    headers,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    end: vi.fn(),
  };

  middleware({ url }, response, vi.fn());

  return response;
};

describe('external-dist development middleware', () => {
  beforeAll(() => {
    if (!fs.existsSync(parentDistDir)) {
      mkdirSync(parentDistDir, { recursive: true });
      createdParentDistDir = true;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (createdParentDistDir) {
      rmdirSync(parentDistDir);
    }
  });

  it.each([
    ['parent traversal', '/dist/../package.json'],
    ['absolute path', `/dist/${rootPackagePath}`],
    ['directory', '/dist/'],
  ])('rejects a %s request without exposing it through CORS', (_label, url) => {
    const readStream = vi.spyOn(fs, 'createReadStream').mockReturnValue({
      pipe: vi.fn(),
    } as unknown as ReturnType<typeof fs.createReadStream>);
    const response = request(getExternalDistMiddleware(), url);

    expect(response.statusCode).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBeUndefined();
    expect(readStream).not.toHaveBeenCalled();
  });

  it('does not resolve a distribution traversal as a module', async () => {
    const plugin = getExternalDistPlugin();

    if (typeof plugin.resolveId !== 'function') {
      throw new Error('external-dist resolveId hook not found');
    }

    const context = {
      environment: { name: 'client' },
      resolve: vi.fn(),
    } as unknown as ThisParameterType<typeof plugin.resolveId>;
    const result = await plugin.resolveId.call(
      context,
      '/dist/../package.json',
      undefined,
      { isEntry: false },
    );

    expect(result).toBeNull();
  });

  it('does not load a sibling path that shares the dist prefix', async () => {
    const plugin = getExternalDistPlugin();

    if (typeof plugin.load !== 'function') {
      throw new Error('external-dist load hook not found');
    }

    const readFile = vi.spyOn(fs, 'readFileSync').mockReturnValue('secret');
    const context = {
      addWatchFile: vi.fn(),
    } as unknown as ThisParameterType<typeof plugin.load>;
    const result = await plugin.load.call(
      context,
      `${parentDistDir}-outside/secret.mjs`,
      {},
    );

    expect(result).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('serves a distribution file when the request has a cache query', () => {
    const temporaryDirectory = mkdtempSync(
      resolve(parentDistDir, '.vite-config-test-'),
    );
    const filePath = resolve(temporaryDirectory, 'bundle.mjs');

    try {
      writeFileSync(filePath, 'export const value = true;');
      const readStream = vi.spyOn(fs, 'createReadStream').mockReturnValue({
        pipe: vi.fn(),
      } as unknown as ReturnType<typeof fs.createReadStream>);
      const response = request(
        getExternalDistMiddleware(),
        `/dist/${basename(temporaryDirectory)}/bundle.mjs?v=1`,
      );

      expect(response.statusCode).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        'application/javascript; charset=utf-8',
      );
      expect(readStream).toHaveBeenCalledWith(fs.realpathSync(filePath));
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a symlink that escapes the distribution directory', () => {
    const temporaryDirectory = mkdtempSync(
      resolve(parentDistDir, '.vite-config-test-'),
    );
    const linkPath = resolve(temporaryDirectory, 'outside-link.json');

    try {
      symlinkSync(rootPackagePath, linkPath, 'file');
      const readStream = vi.spyOn(fs, 'createReadStream').mockReturnValue({
        pipe: vi.fn(),
      } as unknown as ReturnType<typeof fs.createReadStream>);
      const response = request(
        getExternalDistMiddleware(),
        `/dist/${basename(temporaryDirectory)}/outside-link.json`,
      );

      expect(response.statusCode).toBe(404);
      expect(readStream).not.toHaveBeenCalled();
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
