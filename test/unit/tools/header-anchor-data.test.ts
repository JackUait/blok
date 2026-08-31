import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Header, type HeaderConfig, type HeaderData } from '../../../src/tools/header';
import { clean } from '../../../src/components/utils/sanitizer';
import type { API, BlockToolConstructorOptions, PasteConfig, SanitizerConfig } from '../../../types';

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

/**
 * The sanitizer config the paste module would build for one tag, read straight
 * out of the tool's own pasteConfig — so dropping the whitelist entry fails the
 * test instead of silently mirroring it.
 */
const pasteSanitizeConfigFor = (tag: string): SanitizerConfig => {
  const config: PasteConfig = Header.pasteConfig;
  const tags = config === false ? [] : (config.tags ?? []);
  const entry = tags.find(
    (candidate): candidate is SanitizerConfig => typeof candidate === 'object' && tag in candidate
  );

  return { [tag.toLowerCase()]: entry?.[tag] ?? {} };
};

const pasteEventFor = (html: string): { detail: { data: HTMLElement } } => {
  const host = document.createElement('div');

  host.innerHTML = html;

  return { detail: { data: host.firstElementChild as HTMLElement } };
};

describe('Header — anchor carried in from pasted HTML', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('whitelists id on the heading tags so a pasted anchor survives sanitization', () => {
    /**
     * Google Docs puts the bookmark on the heading itself and its table of
     * contents links to it. The paste sanitizer drops every attribute a tool
     * does not name, so without the whitelist the anchor is gone before
     * onPaste ever sees it.
     */
    const cleaned = clean(
      '<h2 id="h.2y1ok8y7pef0">КЛН территориального управляющего</h2>',
      pasteSanitizeConfigFor('H2')
    );

    expect(cleaned).toContain('id="h.2y1ok8y7pef0"');
  });

  it('keeps the pasted heading id as the block anchor', () => {
    const header = new Header(createHeaderOptions());

    header.onPaste(pasteEventFor('<h2 id="h.2y1ok8y7pef0">Раздел</h2>') as never);

    expect(header.save(header.render()).anchor).toBe('h.2y1ok8y7pef0');
  });

  it('renders the anchor as the heading element id', () => {
    const header = new Header(createHeaderOptions({ text: 'Раздел', anchor: 'h.abc' }));

    expect(header.render().id).toBe('h.abc');
  });

  it('round-trips the anchor through save and reload', () => {
    const saved = new Header(createHeaderOptions({ text: 'Раздел', anchor: 'h.abc' }));
    const data = saved.save(saved.render());

    const reloaded = new Header(createHeaderOptions(data));

    expect(reloaded.render().id).toBe('h.abc');
    expect(reloaded.save(reloaded.render()).anchor).toBe('h.abc');
  });

  it('omits the anchor from saved data when the heading has none', () => {
    const header = new Header(createHeaderOptions({ text: 'Раздел' }));

    expect(header.save(header.render()).anchor).toBeUndefined();
  });

  it('prefers the stored anchor over the text-derived anchorIds id', () => {
    /**
     * The stored anchor is the one existing links already point at, so it must
     * win over an id derived from the current text.
     */
    const header = new Header(createHeaderOptions({ text: 'Раздел', anchor: 'h.abc' }, { anchorIds: true }));

    expect(header.render().id).toBe('h.abc');
  });

  it('still derives an id from text when the heading has no stored anchor', () => {
    const header = new Header(createHeaderOptions({ text: 'Первый раздел' }, { anchorIds: true }));

    expect(header.render().id).toBe('Первый-раздел');
  });

  it('ignores an anchor that is empty or carries whitespace', () => {
    const empty = new Header(createHeaderOptions({ text: 'Раздел', anchor: '   ' }));
    const spaced = new Header(createHeaderOptions({ text: 'Раздел', anchor: 'two words' }));

    expect(empty.render().id).toBe('');
    expect(spaced.render().id).toBe('');
    expect(empty.save(empty.render()).anchor).toBeUndefined();
    expect(spaced.save(spaced.render()).anchor).toBeUndefined();
  });

  it('ignores a pasted heading with no id', () => {
    const header = new Header(createHeaderOptions());

    header.onPaste(pasteEventFor('<h2>Раздел</h2>') as never);

    expect(header.save(header.render()).anchor).toBeUndefined();
  });
});
