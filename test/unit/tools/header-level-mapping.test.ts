import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Header, type HeaderConfig, type HeaderData } from '../../../src/tools/header';
import type { API, BlockToolConstructorOptions } from '../../../types';

const createMockAPI = (): API => ({
  styles: {
    block: 'blok-block',
    inlineToolbar: 'blok-inline-toolbar',
    inlineToolButton: 'blok-inline-tool-button',
    inlineToolButtonActive: 'blok-inline-tool-button--active',
    input: 'blok-input',
    loader: 'blok-loader',
    button: 'blok-button',
    settingsButton: 'blok-settings-button',
    settingsButtonActive: 'blok-settings-button--active',
  },
  i18n: {
    t: (key: string) => key,
    has: () => false,
  },
  blocks: {
    getChildren: vi.fn().mockReturnValue([]),
    setBlockParent: vi.fn(),
  },
  events: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
} as unknown as API);

const createHeader = (level: unknown, config: HeaderConfig): Header => {
  const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
    data: { text: 'T', level } as HeaderData,
    config,
    api: createMockAPI(),
    readOnly: false,
    block: { id: 'test-block-id', dispatchChange: vi.fn() } as never,
  };

  return new Header(options);
};

/** Level the block saves after it renders. */
const savedLevel = (level: unknown, config: HeaderConfig): number => {
  const header = createHeader(level, config);

  header.render();

  return header.data.level;
};

const pastedLevel = (html: string, config: HeaderConfig): number => {
  const header = createHeader(2, config);
  const host = document.createElement('div');

  document.body.appendChild(host);
  host.appendChild(header.render());
  const source = document.createElement('div');

  source.innerHTML = html;
  header.onPaste({ detail: { data: source.firstElementChild as HTMLElement } } as never);
  host.remove();

  return header.data.level;
};

describe('Header — a level the tool does not allow maps to the nearest allowed level', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps levels like Notion maps h1-h6 onto its levels 1-4', () => {
    const levels = [1, 2, 3, 4];

    expect([1, 2, 3, 4, 5, 6].map((n) => savedLevel(n, { levels }))).toEqual([1, 2, 3, 4, 4, 4]);
  });

  it('clamps both ends when only levels 2 and 3 are allowed', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => savedLevel(n, { levels: [2, 3] }))).toEqual([2, 2, 3, 3, 3, 3]);
  });

  it('breaks a tie toward the deeper level, whatever the config order', () => {
    expect(savedLevel(2, { levels: [1, 3], defaultLevel: 1 })).toBe(3);
    expect(savedLevel(2, { levels: [3, 1], defaultLevel: 1 })).toBe(3);
  });

  it('maps pasted h1-h6 tags with the same rule', () => {
    const tags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

    expect(tags.map((t) => pastedLevel(`<${t}>x</${t}>`, { levels: [2, 3] }))).toEqual([2, 2, 3, 3, 3, 3]);
    expect(pastedLevel('<h2>x</h2>', { levels: [1, 3] })).toBe(3);
    expect(pastedLevel('<h2>x</h2>', { levels: [3, 1] })).toBe(3);
  });

  it('keeps every level 1-6 when no levels are configured', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => savedLevel(n, {}))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('sends a level outside 1-6 to the default level, never to a nearest one', () => {
    const config: HeaderConfig = { levels: [2, 3], defaultLevel: 2 };

    expect([0, -1, 7, 999, 'x'].map((n) => savedLevel(n, config))).toEqual([2, 2, 2, 2, 2]);
  });
});
