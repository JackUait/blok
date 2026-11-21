import { describe, it, expect, vi } from 'vitest';
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

const createHeaderOptions = (
  data: Partial<HeaderData> = {},
  config: HeaderConfig = {}
): BlockToolConstructorOptions<HeaderData, HeaderConfig> => ({
  data: { text: '', level: 2, ...data },
  config,
  api: createMockAPI(),
  readOnly: false,
  block: { id: 'test-block-id', dispatchChange: vi.fn() } as never,
});

const activateLevel = (header: Header, level: number): void => {
  Reflect.set(header, 'data', { ...header.data, level });
};

describe('Header Tool - block-level color survives level change', () => {
  it('keeps textColor/backgroundColor in saved data after changing level (H2 -> H1)', () => {
    const header = new Header(createHeaderOptions({ text: 'Hi', level: 2, textColor: 'red', backgroundColor: 'blue' }));
    const element = header.render();

    // set data's level-change branch only fires for an attached element
    document.body.appendChild(element);

    activateLevel(header, 1);

    const saved = header.save(document.createElement('div'));

    expect(saved.level).toBe(1);
    expect(saved.textColor).toBe('red');
    expect(saved.backgroundColor).toBe('blue');

    document.body.innerHTML = '';
  });

  it('re-applies the color CSS vars on the rebuilt heading element after a level change', () => {
    const header = new Header(createHeaderOptions({ text: 'Hi', level: 2, textColor: 'red', backgroundColor: 'blue' }));
    const element = header.render();

    document.body.appendChild(element);

    activateLevel(header, 1);

    const heading = document.body.querySelector('h1') as HTMLElement;

    expect(heading).not.toBeNull();
    expect(heading.style.color).toBe('var(--blok-color-red-text)');
    expect(heading.style.backgroundColor).toBe('var(--blok-color-blue-bg)');

    document.body.innerHTML = '';
  });
});
