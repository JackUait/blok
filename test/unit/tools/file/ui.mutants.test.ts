import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { renderCaptionRow, renderFileCard } from '../../../../src/tools/file/ui';

const SAFE_URL = 'https://files.test/report.pdf';

const card = (
  data: Parameters<typeof renderFileCard>[0],
  onPreview?: () => void,
  downloadLabel?: string,
  onRename?: (next: string) => void
): HTMLElement => {
  const wrapper = renderFileCard(data, onPreview, downloadLabel, onRename);

  document.body.appendChild(wrapper);

  return wrapper;
};

const activatorOf = (wrapper: HTMLElement): HTMLElement | null =>
  wrapper.querySelector('[data-role="file-card"]');

const nameOf = (wrapper: HTMLElement): HTMLElement | null =>
  wrapper.querySelector('[data-role="file-name"]');

const downloadLinkOf = (wrapper: HTMLElement): HTMLElement | null =>
  wrapper.querySelector('.blok-file-download');

const attributes = (el: Element | null): Record<string, string> =>
  Object.fromEntries(Array.from(el?.attributes ?? []).map((attr) => [attr.name, attr.value]));

/**
 * Both `?? ''` fallbacks read `textContent` off an element, and only a document
 * or a doctype node returns null from that property. The guard is still
 * type-required (`Node.textContent` is `string | null`), so the null read is
 * witnessed by hand instead of left to the mutant.
 */
describe('file card UI mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  describe('the activating control', () => {
    it('is a real button when previewing is possible', () => {
      const wrapper = card({ url: SAFE_URL, fileName: 'report.pdf' }, vi.fn());
      const activator = activatorOf(wrapper);

      expect(activator?.tagName).toBe('BUTTON');
      expect((activator as HTMLButtonElement).type).toBe('button');
      expect(attributes(activator)).toStrictEqual({
        type: 'button',
        'data-action': 'preview',
        'data-role': 'file-card',
        'aria-label': 'report.pdf',
        style: expect.stringContaining('position: absolute'),
      });
    });

    it('is a download anchor when previewing is not', () => {
      const wrapper = card({ url: SAFE_URL, fileName: 'report.pdf' });
      const activator = activatorOf(wrapper);

      expect(activator?.tagName).toBe('A');
      expect(activator?.getAttribute('href')).toBe(SAFE_URL);
      expect(activator?.getAttribute('target')).toBe('_blank');
      expect(activator?.getAttribute('rel')).toBe('noopener noreferrer');
      expect(activator?.getAttribute('download')).toBe('report.pdf');
    });

    it('carries no href at all for an unsafe url', () => {
      const wrapper = card({ url: 'javascript:alert(1)', fileName: 'report.pdf' });

      expect(activatorOf(wrapper)?.hasAttribute('href')).toBe(false);
      expect(downloadLinkOf(wrapper)?.hasAttribute('href')).toBe(false);
    });

    it('is stretched over the card chrome', () => {
      const wrapper = card({ url: SAFE_URL }, vi.fn());

      expect(activatorOf(wrapper)?.style.position).toBe('absolute');
      expect(wrapper.querySelector<HTMLElement>('.blok-file-card')?.style.position).toBe('relative');
    });

    it('runs the preview callback on click', () => {
      const onPreview = vi.fn();
      const wrapper = card({ url: SAFE_URL }, onPreview);

      activatorOf(wrapper)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onPreview).toHaveBeenCalledTimes(1);
    });
  });

  describe('card chrome', () => {
    it('names every part it builds', () => {
      const wrapper = card({ url: SAFE_URL, fileName: 'report.pdf', size: 2048 });

      expect(wrapper.className).toBe('blok-file-card-wrapper');
      expect(wrapper.getAttribute('data-role')).toBe('file-card-wrapper');
      expect(wrapper.querySelector('.blok-file-card')).not.toBeNull();
      expect(wrapper.querySelector('.blok-file-meta')).not.toBeNull();
      expect(nameOf(wrapper)?.className).toBe('blok-file-name');
      expect(wrapper.querySelector('[data-role="file-size"]')?.className).toBe('blok-file-size');
      expect(wrapper.querySelector('.blok-file-icon')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('falls back to the url when there is no file name', () => {
      const wrapper = card({ url: SAFE_URL });

      expect(nameOf(wrapper)?.textContent).toBe(SAFE_URL);
      expect(activatorOf(wrapper)?.getAttribute('aria-label')).toBe(SAFE_URL);
      expect(downloadLinkOf(wrapper)?.getAttribute('download')).toBe('');
    });

    it('labels the download link only when a label was supplied', () => {
      expect(downloadLinkOf(card({ url: SAFE_URL }))?.hasAttribute('aria-label')).toBe(false);
      expect(downloadLinkOf(card({ url: SAFE_URL }, undefined, 'Download'))?.getAttribute('aria-label'))
        .toBe('Download');
    });

    it('opens the download link in a new tab without leaking the opener', () => {
      const link = downloadLinkOf(card({ url: SAFE_URL, fileName: 'report.pdf' }));

      expect(link?.getAttribute('target')).toBe('_blank');
      expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link?.getAttribute('download')).toBe('report.pdf');
    });
  });

  describe('the editable file name', () => {
    const renameable = (): { wrapper: HTMLElement; name: HTMLElement; onRename: () => void } => {
      const onRename = vi.fn();
      const wrapper = card({ url: SAFE_URL, fileName: 'report.pdf' }, vi.fn(), undefined, onRename);
      const name = nameOf(wrapper);

      if (name === null) {
        throw new Error('no file name element');
      }

      return { wrapper, name, onRename };
    };

    it('declares itself a textbox and sits above the activating control', () => {
      const { name } = renameable();

      expect(name.getAttribute('contenteditable')).toBe('true');
      expect(name.getAttribute('role')).toBe('textbox');
      expect(name.getAttribute('aria-label')).toBe('report.pdf');
      expect(name.style.position).toBe('relative');
    });

    it('is inert without a rename callback', () => {
      const name = nameOf(card({ url: SAFE_URL, fileName: 'report.pdf' }, vi.fn()));

      expect(name?.hasAttribute('contenteditable')).toBe(false);
      expect(name?.hasAttribute('role')).toBe(false);
    });

    it('keeps a click on itself from reaching the card', () => {
      const { wrapper, name } = renameable();
      const onCard = vi.fn();

      wrapper.addEventListener('click', onCard);

      const event = new MouseEvent('click', { bubbles: true, cancelable: true });

      name.dispatchEvent(event);

      expect(onCard).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('commits on Enter and lets every other key through', () => {
      const { name, onRename } = renameable();

      name.focus();
      name.textContent = 'renamed.pdf';

      const other = new KeyboardEvent('keydown', { key: 'a', cancelable: true });

      name.dispatchEvent(other);

      expect(other.defaultPrevented).toBe(false);
      expect(onRename).not.toHaveBeenCalled();

      const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });

      name.dispatchEvent(enter);

      expect(enter.defaultPrevented).toBe(true);
      expect(onRename).toHaveBeenCalledWith('renamed.pdf');
    });

    it('restores the old name when the field is emptied or unchanged', () => {
      const { name, onRename } = renameable();

      name.textContent = '   ';
      name.dispatchEvent(new FocusEvent('blur'));

      expect(name.textContent).toBe('report.pdf');
      expect(onRename).not.toHaveBeenCalled();

      name.textContent = 'report.pdf';
      name.dispatchEvent(new FocusEvent('blur'));

      expect(onRename).not.toHaveBeenCalled();
    });

    it('restores the old name when the field reads a null text content', () => {
      const { name, onRename } = renameable();
      const written: string[] = [];

      // A null read falls through to the `?? ''` fallback, which must land in
      // the same restore branch an emptied field takes.
      Object.defineProperty(name, 'textContent', {
        configurable: true,
        get: () => null,
        set: (value: string): void => {
          written.push(value);
        },
      });

      name.dispatchEvent(new FocusEvent('blur'));

      expect(onRename).not.toHaveBeenCalled();
      expect(written).toEqual(['report.pdf']);
    });
  });

  describe('the caption row', () => {
    it('declares the textbox contract only while it is editable', () => {
      const row = renderCaptionRow({ value: 'hi', placeholder: 'Add a caption', readOnly: false, onChange: vi.fn() });
      const caption = row.querySelector('[data-role="file-caption"]');

      expect(row.className).toBe('blok-file-caption-row');
      expect(caption?.className).toBe('blok-file-caption');
      expect(caption?.getAttribute('contenteditable')).toBe('true');
      expect(caption?.getAttribute('role')).toBe('textbox');
      expect(caption?.getAttribute('aria-multiline')).toBe('true');
      expect(caption?.getAttribute('aria-label')).toBe('Add a caption');
      expect(caption?.getAttribute('data-placeholder')).toBe('Add a caption');
      expect(caption?.textContent).toBe('hi');
    });

    it('drops the whole contract in read-only', () => {
      const row = renderCaptionRow({ value: 'hi', placeholder: 'Add a caption', readOnly: true, onChange: vi.fn() });
      const caption = row.querySelector('[data-role="file-caption"]');

      expect(caption?.getAttribute('contenteditable')).toBe('false');
      expect(caption?.hasAttribute('role')).toBe(false);
      expect(caption?.hasAttribute('aria-multiline')).toBe(false);
      expect(caption?.hasAttribute('aria-label')).toBe(false);
    });

    it('reports the edited text on blur', () => {
      const onChange = vi.fn();
      const row = renderCaptionRow({ value: 'hi', placeholder: 'Add a caption', readOnly: false, onChange });
      const caption = row.querySelector('[data-role="file-caption"]');

      if (caption === null) {
        throw new Error('no caption');
      }
      caption.textContent = 'edited';
      caption.dispatchEvent(new FocusEvent('blur'));

      expect(onChange).toHaveBeenCalledWith('edited');
    });

    it('reports the empty string when the caption reads a null text content', () => {
      const onChange = vi.fn();
      const row = renderCaptionRow({ value: 'hi', placeholder: 'Add a caption', readOnly: false, onChange });
      const caption = row.querySelector('[data-role="file-caption"]');

      if (caption === null) {
        throw new Error('no caption');
      }

      // A null read must land on the empty string, not on a placeholder.
      Object.defineProperty(caption, 'textContent', {
        configurable: true,
        get: () => null,
      });

      caption.dispatchEvent(new FocusEvent('blur'));

      expect(onChange).toHaveBeenCalledWith('');
    });
  });
});
