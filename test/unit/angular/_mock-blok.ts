import { vi } from 'vitest';

/**
 * Shared Blok runtime mock for the Angular adapter unit tests.
 *
 * Usage in a test file:
 * ```ts
 * vi.mock('@blok/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));
 * import { blokRegistry } from './_mock-blok';
 * ```
 * The async `vi.mock` factory and the test's top-level import resolve to the
 * same module instance, so `blokRegistry` observes every constructed mock.
 *
 * `isReady` is deferred: call `blokRegistry.last.resolveReady()` to resolve it,
 * which mirrors the real `Promise<Blok>` resolving AFTER the constructor returns
 * (so identity-guard tests exercise genuine staleness).
 */
export interface MockBlokRecord {
  config: Record<string, unknown>;
  isReady: Promise<unknown>;
  resolveReady: () => void;
  rejectReady: (reason?: unknown) => void;
  destroy: ReturnType<typeof vi.fn>;
  readOnly: { set: ReturnType<typeof vi.fn> };
  theme: { set: ReturnType<typeof vi.fn> };
  width: { set: ReturnType<typeof vi.fn> };
  placeholder: { set: ReturnType<typeof vi.fn> };
  focus: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
}

export const blokRegistry = {
  instances: [] as MockBlokRecord[],
  reset(): void {
    this.instances.length = 0;
  },
  get last(): MockBlokRecord {
    return this.instances[this.instances.length - 1];
  },
};

export class MockBlok {
  public isReady: Promise<unknown>;
  public destroy = vi.fn();
  public readOnly = { set: vi.fn().mockResolvedValue(false) };
  public theme = { set: vi.fn() };
  public width = { set: vi.fn() };
  public placeholder = { set: vi.fn() };
  public focus = vi.fn().mockReturnValue(true);
  public save = vi.fn().mockResolvedValue({ time: 0, blocks: [], version: '0' });
  public render = vi.fn().mockResolvedValue(undefined);
  public on = vi.fn();
  public off = vi.fn();
  public emit = vi.fn();

  private resolveFn!: (value: unknown) => void;
  private rejectFn!: (reason?: unknown) => void;

  public constructor(config: Record<string, unknown>) {
    this.isReady = new Promise((resolve, reject) => {
      this.resolveFn = resolve;
      this.rejectFn = reject;
    });

    blokRegistry.instances.push({
      config,
      isReady: this.isReady,
      resolveReady: () => this.resolveFn(this),
      rejectReady: (reason?: unknown) => this.rejectFn(reason),
      destroy: this.destroy,
      readOnly: this.readOnly,
      theme: this.theme,
      width: this.width,
      placeholder: this.placeholder,
      focus: this.focus,
      save: this.save,
      render: this.render,
      on: this.on,
      off: this.off,
      emit: this.emit,
    });
  }
}
