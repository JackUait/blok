import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import './helpers/domShims';
import { buildDeck } from './helpers/buildDeck';
import { zipToBuffer } from '../docx/build-docx';
import { readZip } from '../../../../../src/tools/file/zip/read-zip';
import { openDeck } from '../../../../../src/tools/file/pptx/viewer';

/** English text the engine used to write into slides. Blok's UI is localized, so none may show. */
const ENGLISH_UI_TEXT = [
  'Missing image reference',
  'Image not found',
  'No image data',
  'Unsupported format',
  'Render Error',
  'Failed to render node',
  'Group child error',
  'Go to slide',
  'Video',
  'Audio',
];

class FakeResizeObserver {
  public observe(): void {
    // Not needed here.
  }

  public disconnect(): void {
    // Not needed here.
  }
}

/** A deck whose picture points at a media file the zip does not hold. */
const deckWithMissingPicture = async (): Promise<ArrayBuffer> => {
  const archive = readZip(await buildDeck([
    { text: 'Intro', picture: true, link: { target: 'slide2.xml', external: false } },
    { text: 'Summary' },
  ]));
  const kept = archive.entries.filter((entry) => !entry.dir && entry.name !== 'ppt/media/image1.png');

  return zipToBuffer(new Map(await Promise.all(kept.map(async (entry) => [entry.name, await archive.read(entry)] as const))));
};

describe('openDeck — no untranslated UI text in slides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a missing picture and an internal slide link add no English words', async () => {
    const container = document.createElement('div');

    document.body.appendChild(container);
    await openDeck(await deckWithMissingPicture(), container);

    const titles = Array.from(container.querySelectorAll('[title]'), (el) => el.getAttribute('title') ?? '');
    const text = container.textContent ?? '';
    const hits = ENGLISH_UI_TEXT.filter((phrase) => text.includes(phrase) || titles.some((title) => title.includes(phrase)));

    expect(hits).toEqual([]);
    expect(titles).toEqual([]);
    expect(text).toContain('Intro');
    expect(text).toContain('Summary');
    expect(container.querySelector('[style*="dashed"]')).not.toBeNull();

    const scrollIntoView = vi.fn();
    const cards = Array.from(container.children).filter((child): child is HTMLElement => child instanceof HTMLElement);

    cards[1].scrollIntoView = scrollIntoView;
    container.querySelector<HTMLElement>('[role="link"]')?.click();

    expect(scrollIntoView).toHaveBeenCalled();
  });
});
