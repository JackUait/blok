import { vi } from 'vitest';

/**
 * Mock for `../../../src/blok` shared by the Vue adapter unit tests.
 *
 * `isReady` is a Promise that stays PENDING until the test calls
 * `resolveReady()` — so the "null until ready, instance after" contract and the
 * stale-instance guard are exercised against genuine async timing. Each
 * constructed instance is recorded in `blokRegistry` (`.last`, `.instances`).
 *
 * Use from a test via:
 *   vi.mock('../../../src/blok', async () => await import('./mock-blok'));
 *   import { blokRegistry } from './mock-blok';
 */

export interface MockBlokInstance {
  config: Record<string, unknown>;
  isReady: Promise<MockBlokInstance>;
  resolveReady: () => void;
  rejectReady: (error?: unknown) => void;
  destroy: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  readOnly: { set: ReturnType<typeof vi.fn> };
  theme: { set: ReturnType<typeof vi.fn> };
  width: { set: ReturnType<typeof vi.fn> };
  placeholder: { set: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
}

class MockBlok implements MockBlokInstance {
  public config: Record<string, unknown>;
  public isReady: Promise<MockBlokInstance>;
  public resolveReady!: () => void;
  public rejectReady!: (error?: unknown) => void;
  public destroy = vi.fn();
  public focus = vi.fn().mockReturnValue(true);
  public save = vi.fn().mockResolvedValue({ time: 0, blocks: [], version: '0' });
  public render = vi.fn().mockResolvedValue(undefined);
  public readOnly = { set: vi.fn().mockResolvedValue(false) };
  public theme = { set: vi.fn() };
  public width = { set: vi.fn() };
  public placeholder = { set: vi.fn() };
  public on = vi.fn();
  public off = vi.fn();

  constructor(config: Record<string, unknown>) {
    this.config = config;
    this.isReady = new Promise<MockBlokInstance>((resolve, reject) => {
      this.resolveReady = (): void => resolve(this);
      this.rejectReady = (error?: unknown): void => reject(error ?? new Error('init failed'));
    });
    // Swallow unhandled rejections for tests that reject without awaiting.
    this.isReady.catch(() => undefined);
    blokRegistry.instances.push(this);
  }
}

export const blokRegistry = {
  instances: [] as MockBlok[],
  get last(): MockBlok | undefined {
    return this.instances.at(-1);
  },
  reset(): void {
    this.instances = [];
  },
};

export { MockBlok as Blok };
