import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateCoverFile, openCoverPicker } from '../../../../src/tools/audio/cover-picker';
import { COVER_MAX_SIZE } from '../../../../src/tools/audio/constants';

const makeFile = (type: string, size: number): File => {
  const f = new File(['x'], 'cover', { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('validateCoverFile', () => {
  it('accepts an image within the size cap', () => {
    expect(validateCoverFile(makeFile('image/png', 1024))).toBeNull();
  });

  it('rejects a non-image file', () => {
    expect(validateCoverFile(makeFile('audio/mpeg', 1024))).not.toBeNull();
  });

  it('rejects an oversized image', () => {
    expect(validateCoverFile(makeFile('image/png', COVER_MAX_SIZE + 1))).not.toBeNull();
  });

  it('does not type-reject a file with an empty MIME type (falls through to size check)', () => {
    expect(validateCoverFile(makeFile('', 1024))).toBeNull();
  });
});

describe('openCoverPicker', () => {
  it('mounts a dialog and forwards a submitted URL, then closes on demand', () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    const onUrl = vi.fn();
    const handle = openCoverPicker({ anchor, onFile: vi.fn(), onUrl });

    const dialog = document.querySelector('[data-role="audio-cover-picker"]');
    expect(dialog).not.toBeNull();

    // Drive the Link tab: click the embed tab, type a URL, submit.
    const linkTab = dialog!.querySelector<HTMLButtonElement>('[data-tab="embed"]');
    linkTab?.click();
    const input = dialog!.querySelector<HTMLInputElement>('input[type="url"]');
    if (input) { input.value = 'https://cdn/cover.png'; }
    // The submit button uses type="button" and data-action="submit-url"
    const submit = dialog!.querySelector<HTMLButtonElement>('[data-action="submit-url"]');
    submit?.click();

    expect(onUrl).toHaveBeenCalledWith('https://cdn/cover.png');

    handle.close();
    expect(document.querySelector('[data-role="audio-cover-picker"]')).toBeNull();
  });

  it('invokes onClose when the user presses Escape', () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    const onClose = vi.fn();
    openCoverPicker({ anchor, onFile: vi.fn(), onUrl: vi.fn(), onClose });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalled();
    expect(document.querySelector('[data-role="audio-cover-picker"]')).toBeNull();
  });
});
