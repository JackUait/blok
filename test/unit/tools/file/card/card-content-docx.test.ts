import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { loadCardContent, type CardSource } from '../../../../../src/tools/file/card/card-content';

const PARAGRAPHS = 5_000;

vi.mock('../../../../../src/tools/file/office-loaders', () => ({
  loadPptxFirstSlide: vi.fn(),
  loadDocxRenderer: vi.fn(async () => (_data: ArrayBuffer, holder: HTMLElement): Promise<() => void> => {
    const page = document.createElement('section');
    const article = document.createElement('article');

    page.className = 'blok-docx';
    page.style.width = '612pt';
    Array.from({ length: PARAGRAPHS }, (_, index) => {
      const paragraph = document.createElement('p');

      paragraph.textContent = `para ${index}`;

      return article.appendChild(paragraph);
    });
    page.appendChild(article);
    holder.appendChild(page);

    return Promise.resolve(() => undefined);
  }),
}));

const source = (): CardSource => ({
  data: { url: 'https://cdn/long.docx', fileName: 'long.docx' },
  config: {},
  signal: new AbortController().signal,
});

describe('card content: a Word file', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(8))));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps only the top of a long first page, so the editor does not lay out the whole file', async () => {
    const loaded = await loadCardContent('document', source());

    if (loaded === null || loaded.content.kind !== 'document') {
      throw new Error('expected a document card');
    }

    const kept = loaded.content.page.querySelectorAll('p');

    expect(kept.length).toBeLessThanOrEqual(100);
    expect(kept[0]?.textContent).toBe('para 0');
    expect(loaded.count).toEqual({ unit: 'pages', value: 1 });
  });
});
