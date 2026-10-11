import type { ViewStateFallback } from './database-view-state';
import type { DatabaseTabDisplay, DatabaseViewStateStore } from './types';

const KEY = 'tabDisplay';
const MODES: readonly DatabaseTabDisplay[] = ['both', 'text', 'icon'];

const asMode = (value: unknown): DatabaseTabDisplay | undefined => MODES.find((mode) => mode === value);

export interface TabDisplayPreferenceOptions {
  store?: DatabaseViewStateStore;
  fallback: ViewStateFallback;
  /** Called when the host store's value arrives. */
  onChange: () => void;
}

/**
 * This person's "Display as" for a database's view tabs (research/03 §1.2).
 * Personal, so it never enters the document. Reads are synchronous.
 */
export class TabDisplayPreference {
  private readonly options: TabDisplayPreferenceOptions;
  private value: DatabaseTabDisplay | undefined;

  constructor(options: TabDisplayPreferenceOptions) {
    this.options = options;
  }

  private get hostStore(): Required<Pick<DatabaseViewStateStore, 'getTabDisplay' | 'setTabDisplay'>> | undefined {
    const { store } = this.options;

    return store?.getTabDisplay !== undefined && store.setTabDisplay !== undefined
      ? { getTabDisplay: store.getTabDisplay.bind(store), setTabDisplay: store.setTabDisplay.bind(store) }
      : undefined;
  }

  async load(): Promise<void> {
    const host = this.hostStore;

    if (host === undefined) return;
    try {
      this.value = asMode(await host.getTabDisplay()) ?? 'both';
    } catch {
      return;
    }
    this.options.onChange();
  }

  get(): DatabaseTabDisplay {
    if (this.value !== undefined) return this.value;
    if (this.hostStore !== undefined) return 'both';
    try {
      this.value = asMode(this.options.fallback.get(KEY)) ?? 'both';
    } catch {
      this.value = 'both';
    }

    return this.value;
  }

  set(display: DatabaseTabDisplay): void {
    this.value = display;
    const host = this.hostStore;

    if (host !== undefined) {
      host.setTabDisplay(display).catch(() => undefined);

      return;
    }
    try {
      this.options.fallback.set(KEY, display === 'both' ? undefined : display);
    } catch {
      // Storage can be full or blocked; the choice still holds for this session.
    }
  }
}
