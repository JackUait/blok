import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

import { renderVideo, renderCaptionRow } from '../../../../src/tools/video/ui';

/**
 * Mutation-hardening for `src/tools/video/ui.ts`.
 *
 * One recorded mutant is PROVEN EQUIVALENT and is left alive on purpose:
 *
 * - Mutant 671, line 86: the `?? ''` fallback in
 *   `opts.onChange(caption.textContent ?? '')` replaced by `?? "Stryker was
 *   here!"`. `caption` is a `<div>` created inside `renderCaptionRow`, and the
 *   DOM spec makes `textContent` null only for Document and DocumentType
 *   nodes — on an Element it is always the descendant text, i.e. a string
 *   (verified in this jsdom: assigning `null` stores ''). So the right-hand
 *   operand is unreachable for every possible input, and no assertion can
 *   distinguish the two programs. Stryker itself recorded it as NoCoverage.
 *   Forcing it would mean redefining `textContent` to return null, which
 *   manufactures a DOM state the spec forbids.
 *
 * The `if (data.width !== undefined)` guard needed a lever: an invalid CSS
 * value is a no-op per CSSOM, so the mutated `figure.style.width =
 * 'undefined%'` leaves the same DOM as skipping the write. The write itself is
 * observable, so the tests below wrap the `width` accessor on the style
 * prototype and assert which values were pushed through it.
 */

const requireElement = (node: Element | null, what: string): HTMLElement => {
  if (!(node instanceof HTMLElement)) {
    throw new Error(`expected an HTMLElement for ${what}`);
  }

  return node;
};

/**
 * jsdom keeps the CSS longhand accessors on the prototype of an element's
 * `style` object, so wrapping `width` there sees every write any element makes
 * while `run` executes. Restoring is manual — `restoreAllMocks` does not undo
 * `defineProperty`.
 */
const captureWidthWrites = (run: () => void): string[] => {
  const proto: unknown = Object.getPrototypeOf(document.createElement('div').style);

  if (typeof proto !== 'object' || proto === null) {
    throw new Error('style object has no prototype to instrument');
  }

  const descriptor = Object.getOwnPropertyDescriptor(proto, 'width');

  if (descriptor === undefined || typeof descriptor.get !== 'function' || typeof descriptor.set !== 'function') {
    throw new Error('jsdom no longer exposes a width accessor on the style prototype');
  }

  const originalSet = descriptor.set;
  const writes: string[] = [];

  Object.defineProperty(proto, 'width', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get: descriptor.get,
    set(this: CSSStyleDeclaration, value: string): void {
      writes.push(String(value));
      originalSet.call(this, value);
    },
  });

  try {
    run();
  } finally {
    Object.defineProperty(proto, 'width', descriptor);
  }

  return writes;
};

describe('video ui — mutation hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('renderVideo figure shell', () => {
    it('stamps the figure class, zero margin and relative position', () => {
      const figure = renderVideo({ url: 'u' });

      expect(figure.className).toBe('blok-video-inner');
      expect(figure.style.margin).toBe('0px');
      expect(figure.style.position).toBe('relative');
    });

    it('names the media wrapper and positions it relatively', () => {
      const figure = renderVideo({ url: 'u' });
      const media = requireElement(figure.querySelector('[data-role="video-media"]'), 'media wrapper');

      expect(media.className).toBe('blok-video-media');
      expect(media.style.position).toBe('relative');
    });

    it('never touches the figure width when the data carries none', () => {
      // Only the player's own 100% write may reach the accessor.
      expect(captureWidthWrites(() => renderVideo({ url: 'u' }))).toEqual(['100%']);
    });

    it('writes the figure width first when the data carries one', () => {
      expect(captureWidthWrites(() => renderVideo({ url: 'u', width: 60 }))).toEqual(['60%', '100%']);
    });
  });

  describe('renderVideo player element', () => {
    it('tags the player and declares its inline playback and keyboard contract', () => {
      const figure = renderVideo({ url: 'u' });
      const video = requireElement(figure.querySelector('video'), 'player');

      expect(video.getAttribute('data-blok-testid')).toBe('video-player');
      expect(video.getAttribute('playsinline')).toBe('');
      expect(video.getAttribute('aria-keyshortcuts')).toBe(
        'Space k j l ArrowLeft ArrowRight ArrowUp ArrowDown m f Home End',
      );
    });

    it('stretches the player to the wrapper as a block', () => {
      const figure = renderVideo({ url: 'u' });
      const video = requireElement(figure.querySelector('video'), 'player');

      expect(video.style.width).toBe('100%');
      expect(video.style.display).toBe('block');
    });
  });

  describe('renderCaptionRow', () => {
    const options = (
      overrides: Partial<{ value: string; placeholder: string; readOnly: boolean; onChange: Mock<(next: string) => void> }> = {},
    ): { value: string; placeholder: string; readOnly: boolean; onChange: Mock<(next: string) => void> } => ({
      value: 'a caption',
      placeholder: 'Write a caption',
      readOnly: false,
      onChange: vi.fn<(next: string) => void>(),
      ...overrides,
    });

    it('names the row and the caption line', () => {
      const row = renderCaptionRow(options());
      const caption = requireElement(row.querySelector('[data-role="video-caption"]'), 'caption');

      expect(row.className).toBe('blok-video-caption-row');
      expect(row.getAttribute('data-role')).toBe('video-caption-row');
      expect(caption.className).toBe('blok-video-caption');
    });

    it('styles the caption with no outline and left alignment', () => {
      const row = renderCaptionRow(options());
      const caption = requireElement(row.querySelector('[data-role="video-caption"]'), 'caption');

      expect(caption.style.outline).toBe('none');
      expect(caption.style.textAlign).toBe('left');
    });

    it('declares the textbox contract only while editable', () => {
      const editable = renderCaptionRow(options({ readOnly: false }));
      const editableCaption = requireElement(
        editable.querySelector('[data-role="video-caption"]'),
        'editable caption',
      );

      expect(editableCaption.getAttribute('role')).toBe('textbox');
      expect(editableCaption.getAttribute('aria-multiline')).toBe('true');
      expect(editableCaption.getAttribute('aria-label')).toBe('Write a caption');

      const readOnly = renderCaptionRow(options({ readOnly: true }));
      const readOnlyCaption = requireElement(
        readOnly.querySelector('[data-role="video-caption"]'),
        'read-only caption',
      );

      expect(readOnlyCaption.hasAttribute('role')).toBe(false);
      expect(readOnlyCaption.hasAttribute('aria-multiline')).toBe(false);
      expect(readOnlyCaption.hasAttribute('aria-label')).toBe(false);
    });

    it('reports the edited text on blur while editable', () => {
      const opts = options({ readOnly: false });
      const row = renderCaptionRow(opts);
      const caption = requireElement(row.querySelector('[data-role="video-caption"]'), 'caption');

      caption.textContent = 'edited';
      caption.dispatchEvent(new Event('blur'));

      expect(opts.onChange).toHaveBeenCalledTimes(1);
      expect(opts.onChange).toHaveBeenCalledWith('edited');
    });

    it('wires no blur listener while read-only', () => {
      const opts = options({ readOnly: true });
      const row = renderCaptionRow(opts);
      const caption = requireElement(row.querySelector('[data-role="video-caption"]'), 'caption');

      caption.dispatchEvent(new Event('blur'));

      expect(opts.onChange).not.toHaveBeenCalled();
    });
  });
});
