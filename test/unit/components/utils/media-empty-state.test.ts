import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  renderMediaEmptyState,
  type MediaEmptyStateOptions,
} from '../../../../src/components/utils/media-empty-state';
import { renderEmptyState as renderVideo } from '../../../../src/tools/video/empty-state';
import { renderEmptyState as renderAudio } from '../../../../src/tools/audio/empty-state';
import { renderEmptyState as renderImage } from '../../../../src/tools/image/empty-state';
import { renderEmptyState as renderFile } from '../../../../src/tools/file/empty-state';
import type { I18nInstance } from '../../../../src/components/utils/tools';

const LABELS: MediaEmptyStateOptions['labels'] = {
  add: 'Add a video',
  hint: 'Drag a video here, choose one, or paste a link.',
  hintUpload: 'Drag a video here or choose one.',
  hintLink: 'Paste a link to it below.',
  dropAnywhere: 'Let go anywhere in this block.',
  cancelLink: 'Cancel',
  embed: 'From a link',
  chooseFile: 'Choose file',
  dropToUpload: 'Drop to add',
  urlPlaceholder: 'Paste a video URL…',
  urlAria: 'Video URL',
  submit: 'Add',
};

const render = (overrides: Partial<MediaEmptyStateOptions> = {}) =>
  renderMediaEmptyState({
    acceptTypes: ['video/mp4'],
    labels: LABELS,
    onFile: vi.fn(),
    onUrl: vi.fn(),
    ...overrides,
  });

const fileDrag = (type: string, files: File[] = []): Event => {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', {
    value: { types: ['Files'], files, dropEffect: 'none' },
  });
  return ev;
};

const need = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`${selector} missing`);
  return found;
};

const card = (el: HTMLElement): HTMLElement => need<HTMLElement>(el, '.blok-media-empty__card');
const title = (el: HTMLElement): string | null => need(el, '.blok-media-empty__title').textContent;
const hint = (el: HTMLElement): string | null => need(el, '.blok-media-empty__hint-text').textContent;
const urlInput = (el: HTMLElement): HTMLInputElement => need<HTMLInputElement>(el, 'input[type="url"]');
const fromLink = (el: HTMLElement): HTMLButtonElement => need<HTMLButtonElement>(el, '[data-action="from-link"]');
const cancelLink = (el: HTMLElement): HTMLButtonElement => need<HTMLButtonElement>(el, '[data-action="cancel-link"]');
const submit = (el: HTMLElement): HTMLButtonElement => need<HTMLButtonElement>(el, '[data-action="submit-url"]');
const type = (el: HTMLElement, value: string, inputType = 'insertText'): void => {
  const input = urlInput(el);
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
};
const mount = (el: HTMLElement): HTMLElement => {
  document.body.append(el);
  return el;
};

describe('one surface', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('builds one surface: no tablist, no tabs, no header label, no inner panel', () => {
    const el = render({ preview: 'video' });

    expect(el.querySelector('[role="tablist"], [role="tab"], [role="tabpanel"], [data-tab]')).toBeNull();
    expect(el.querySelector('.blok-media-empty__header, .blok-media-empty__label, .blok-media-empty__panel')).toBeNull();
    expect(card(el).getAttribute('role')).toBe('group');
    expect(card(el).getAttribute('aria-label')).toBe('Add a video');
    expect(card(el).getAttribute('data-mode')).toBe('upload');
  });

  it('shows the title, then the sentence, then both actions', () => {
    const el = render({ preview: 'video' });

    expect(title(el)).toBe('Add a video');
    expect(hint(el)).toBe('Drag a video here, choose one, or paste a link.');
    expect(need(el, '[data-action="choose-file"]').textContent?.trim()).toBe('Choose file');
    expect(fromLink(el).textContent?.trim()).toBe('From a link');
  });

  it.each([
    ['both', 'Drag a video here, choose one, or paste a link.'],
    ['upload', 'Drag a video here or choose one.'],
    ['url', 'Paste a link to it below.'],
  ] as const)('with sources "%s" the sentence fits what is offered', (sources, sentence) => {
    expect(hint(render({ sources }))).toBe(sentence);
  });

  it('falls back to the main sentence when a block has no single-source one', () => {
    const labels = { ...LABELS, hintUpload: undefined, hintLink: undefined };

    expect(hint(render({ sources: 'upload', labels }))).toBe(LABELS.hint);
    expect(hint(render({ sources: 'url', labels }))).toBe(LABELS.hint);
  });

  it('puts the size limit after the sentence, and nothing when there is no limit', () => {
    const labels = { ...LABELS, maxSize: (size: string) => `max ${size}` };

    expect(render({ labels }).querySelector('.blok-media-empty__meta')).toBeNull();
    expect(need(render({ labels, maxSize: 10 * 1024 * 1024 }), '.blok-media-empty__hint > .blok-media-empty__meta').textContent).toBe('max 10 MB');
  });

  it('owns the keyboard of its buttons and link field, so Enter on a button is a click and not a new block', () => {
    const el = render();
    const owner = need(el, '[data-blok-keyboard-owner]');

    expect(owner.contains(fromLink(el))).toBe(true);
    expect(owner.contains(urlInput(el))).toBe(true);
    // The surface itself stays Blok's: arrows and Escape still leave the block.
    expect(card(el).hasAttribute('data-blok-keyboard-owner')).toBe(false);
  });

  it('has exactly one file input, from the first render', () => {
    const el = render();

    expect(el.querySelectorAll('input[type="file"]')).toHaveLength(1);
    expect(need<HTMLInputElement>(el, '[data-blok-testid="file-input"]').accept).toBe('video/mp4');
  });

  it('opens the file picker from the Choose button, from a click on the surface, and from Enter on it', () => {
    const el = render();
    const picker = vi.spyOn(need<HTMLInputElement>(el, 'input[type="file"]'), 'click').mockImplementation(() => undefined);

    need<HTMLButtonElement>(el, '[data-action="choose-file"]').click();
    card(el).click();
    card(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(picker).toHaveBeenCalledTimes(3);
  });
});

describe('one source only', () => {
  it('an upload-only block has no link button and no link field', () => {
    const el = render({ sources: 'upload' });

    expect(el.querySelector('[data-action="from-link"]')).toBeNull();
    expect(el.querySelector('input[type="url"]')).toBeNull();
    expect(el.querySelector('[data-action="choose-file"]')).not.toBeNull();
  });

  it('a link-only block starts on the field, with no cross, no buttons and no file input', () => {
    const el = render({ sources: 'url' });

    expect(card(el).getAttribute('data-mode')).toBe('link');
    expect(urlInput(el).closest('[inert]')).toBeNull();
    expect(el.querySelector('[data-action="cancel-link"]')).toBeNull();
    expect(el.querySelector('[data-action="choose-file"], [data-action="from-link"]')).toBeNull();
    expect(el.querySelector('input[type="file"]')).toBeNull();
  });

  it('Escape does nothing in a link-only block', () => {
    const el = render({ sources: 'url' });

    type(el, 'https://example.com/a.mp4');
    urlInput(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(card(el).getAttribute('data-mode')).toBe('link');
    expect(urlInput(el).value).toBe('https://example.com/a.mp4');
  });
});

describe('link field', () => {
  afterEach(() => document.body.replaceChildren());

  it('"From a link" switches to the field in place and focuses it', async () => {
    const el = mount(render({ preview: 'image' }));
    const input = urlInput(el);
    const actions = need(el, '.blok-media-empty__actions');

    expect(input.closest('[inert]')).not.toBeNull();
    fromLink(el).click();
    await Promise.resolve();

    expect(card(el).getAttribute('data-mode')).toBe('link');
    expect(urlInput(el)).toBe(input);
    expect(input.closest('[inert]')).toBeNull();
    expect(actions.hasAttribute('inert')).toBe(true);
    expect(actions.parentElement).toBe(input.closest('.blok-media-empty__embed-bar')?.parentElement);
    expect(input).toHaveFocus();
  });

  it('is the shared text field: the input sits directly in a data-blok-field="text" bar', () => {
    const el = render();

    expect(urlInput(el).parentElement?.getAttribute('data-blok-field')).toBe('text');
    expect(urlInput(el).placeholder).toBe('Paste a video URL…');
    expect(urlInput(el).getAttribute('aria-label')).toBe('Video URL');
  });

  it.each(['cross', 'Escape'] as const)('the %s clears the link, goes back to the buttons and focuses "From a link"', async (how) => {
    const el = mount(render());

    fromLink(el).click();
    await Promise.resolve();
    type(el, 'https://example.com/a.mp4');
    if (how === 'cross') cancelLink(el).click();
    else urlInput(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(card(el).getAttribute('data-mode')).toBe('upload');
    expect(urlInput(el).value).toBe('');
    expect(need(el, '.blok-media-empty__embed-bar').getAttribute('data-valid')).toBe('false');
    expect(fromLink(el)).toHaveFocus();
  });

  it('names the cross for assistive tech', () => {
    expect(cancelLink(render()).getAttribute('aria-label')).toBe('Cancel');
  });

  it('Add stays disabled until the link is valid, then Enter or a click adds it', () => {
    const onUrl = vi.fn();
    const el = render({ onUrl });
    const bar = need(el, '.blok-media-empty__embed-bar');

    fromLink(el).click();
    expect(bar.getAttribute('data-valid')).toBe('false');
    expect(submit(el).getAttribute('aria-disabled')).toBe('true');
    submit(el).click();
    urlInput(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(onUrl).not.toHaveBeenCalled();

    type(el, ' https://example.com/a.mp4 ');
    expect(bar.getAttribute('data-valid')).toBe('true');
    expect(submit(el).getAttribute('aria-disabled')).toBe('false');
    expect(submit(el).textContent).toContain('Add');

    urlInput(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    submit(el).click();
    expect(onUrl.mock.calls).toEqual([['https://example.com/a.mp4'], ['https://example.com/a.mp4']]);
  });

  it('a pasted link waits for Enter', () => {
    const onUrl = vi.fn();
    const el = render({ onUrl });

    fromLink(el).click();
    type(el, 'https://example.com/a.mp4', 'insertFromPaste');

    expect(onUrl).not.toHaveBeenCalled();
  });

  it('keeps the chain icon: no letter tile, no brand logo, no type badge', async () => {
    const el = render({ preview: 'image', acceptTypes: ['image/jpeg'] });
    const icon = need(el, '.blok-media-empty__embed-icon');

    fromLink(el).click();
    type(el, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await vi.dynamicImportSettled();
    type(el, 'https://images.unsplash.com/photo.jpg');

    expect(icon.querySelector('svg')).not.toBeNull();
    expect(icon.children).toHaveLength(1);
    expect(icon.hasAttribute('data-site')).toBe(false);
    expect(icon.hasAttribute('data-logo')).toBe(false);
    expect(el.querySelector('.blok-media-empty__embed-host, .blok-media-empty__embed-type, [data-brand]')).toBeNull();
  });

  it('draws the link like an address bar: faded protocol, strong domain, muted path', () => {
    const el = render();

    fromLink(el).click();
    type(el, 'https://www.youtube.com/watch?v=1');
    const part = (name: string): string | null | undefined =>
      el.querySelector(`.blok-media-empty__embed-mirror .blok-media-empty__url-${name}`)?.textContent;

    expect([part('proto'), part('www'), part('host'), part('path')]).toEqual(['https://', 'www.', 'youtube.com', '/watch?v=1']);
    expect(need(el, '.blok-media-empty__embed-mirror').getAttribute('aria-hidden')).toBe('true');
  });

  it('shows an error under the surface and marks the field, and editing clears it', () => {
    const el = render();
    const error = need<HTMLElement>(el, '[data-role="error"]');

    fromLink(el).click();
    el.setError('That link did not work');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('That link did not work');
    expect(urlInput(el).getAttribute('aria-invalid')).toBe('true');
    expect(urlInput(el).getAttribute('aria-describedby')).toBe(error.id);

    type(el, 'https://example.com/b.mp4');
    expect(error.hidden).toBe(true);
    expect(urlInput(el).hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('dragging a file over the surface', () => {
  it('swaps the title and the sentence, and puts them back on leave', () => {
    const el = render({ preview: 'video' });

    card(el).dispatchEvent(fileDrag('dragenter'));
    expect(card(el).classList.contains('is-dragover')).toBe(true);
    expect([title(el), hint(el)]).toEqual(['Drop to add', 'Let go anywhere in this block.']);

    card(el).dispatchEvent(fileDrag('dragleave'));
    expect(card(el).classList.contains('is-dragover')).toBe(false);
    expect([title(el), hint(el)]).toEqual(['Add a video', 'Drag a video here, choose one, or paste a link.']);
  });

  it('hides the size limit while dragging and restores it after the drop', () => {
    const el = render({ maxSize: 1024 * 1024, labels: { ...LABELS, maxSize: (size) => `max ${size}` } });
    const meta = need<HTMLElement>(el, '.blok-media-empty__meta');

    card(el).dispatchEvent(fileDrag('dragenter'));
    expect(meta.hidden).toBe(true);

    card(el).dispatchEvent(fileDrag('drop'));
    expect(meta.hidden).toBe(false);
    expect(title(el)).toBe('Add a video');
    expect(card(el).classList.contains('is-dragover')).toBe(false);
  });

  it('stays in the drag state until the pointer has left every nested element', () => {
    const el = render();

    card(el).dispatchEvent(fileDrag('dragenter'));
    card(el).dispatchEvent(fileDrag('dragenter'));
    card(el).dispatchEvent(fileDrag('dragleave'));
    expect(card(el).classList.contains('is-dragover')).toBe(true);

    card(el).dispatchEvent(fileDrag('dragleave'));
    expect(card(el).classList.contains('is-dragover')).toBe(false);
  });

  it('uploads a file dropped while the link field is open', () => {
    const onFile = vi.fn();
    const el = render({ onFile });
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });

    fromLink(el).click();
    type(el, 'https://example.com/half-typed');
    card(el).dispatchEvent(fileDrag('drop', [file]));

    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('ignores drags and drops on a link-only block', () => {
    const onFile = vi.fn();
    const el = render({ sources: 'url', onFile });

    card(el).dispatchEvent(fileDrag('dragenter'));
    card(el).dispatchEvent(fileDrag('drop', [new File(['x'], 'clip.mp4', { type: 'video/mp4' })]));

    expect(card(el).classList.contains('is-dragover')).toBe(false);
    expect(onFile).not.toHaveBeenCalled();
  });
});

describe('the drawing', () => {
  it.each(['video', 'audio', 'image', 'file'] as const)('draws a decorative %s drawing as the first thing on the surface', (kind) => {
    const el = render({ preview: kind });
    const preview = need(el, `.blok-media-empty__card > [data-blok-media-preview="${kind}"]`);

    expect(card(el).firstElementChild).toBe(preview);
    expect(preview.getAttribute('aria-hidden')).toBe('true');
    expect(preview.querySelector('svg')).not.toBeNull();
    expect(card(el).getAttribute('data-preview')).toBe(kind);
  });

  it('draws nothing at all when no drawing is asked for', () => {
    const el = render();

    expect(el.querySelector('[data-blok-media-preview], .blok-media-empty__tile')).toBeNull();
    expect(card(el).hasAttribute('data-preview')).toBe(false);
  });

  it('is the very same node in both modes, and the link field never puts it in upload mode', () => {
    const el = render({ preview: 'image' });
    const drawing = need<HTMLElement>(el, '[data-blok-media-preview]');

    fromLink(el).click();
    type(el, 'https://images.unsplash.com/photo.jpg');
    expect(need(el, '[data-blok-media-preview]')).toBe(drawing);
    expect(drawing.hasAttribute('data-uploading')).toBe(false);
    expect(drawing.style.getPropertyValue('--blok-media-progress')).toBe('');

    cancelLink(el).click();
    expect(need(el, '[data-blok-media-preview]')).toBe(drawing);
  });

  it('catches a pasted valid link', () => {
    const el = render({ preview: 'image' });

    fromLink(el).click();
    type(el, 'https://images.unsplash.com/photo.jpg', 'insertFromPaste');

    expect(need(el, '[data-blok-media-preview]').classList.contains('is-caught')).toBe(true);
  });
});

describe('media tools pick their own drawing', () => {
  const i18n = {
    t: (key: string) => key,
    has: () => false,
  } as unknown as I18nInstance;
  const handlers = { onFile: vi.fn(), onUrl: vi.fn() };

  it.each([
    ['video', () => renderVideo(handlers)],
    ['audio', () => renderAudio(handlers)],
    ['image', () => renderImage(handlers)],
    ['file', () => renderFile({ ...handlers, acceptTypes: [], i18n })],
  ] as const)('%s', (kind, make) => {
    expect(make().querySelector(`[data-blok-media-preview="${kind}"]`)).not.toBeNull();
  });

  it.each([
    ['video', () => renderVideo({ ...handlers, acceptTypes: ['video/mp4', 'video/webm', 'video/quicktime'] })],
    ['audio', () => renderAudio({ ...handlers, acceptTypes: ['audio/mpeg', 'audio/ogg'] })],
    ['image', () => renderImage({ ...handlers, acceptTypes: ['image/png', 'image/jpeg'] })],
    ['file', () => renderFile({ ...handlers, acceptTypes: ['application/pdf', 'application/zip'], i18n })],
  ] as const)('%s never lists the accepted formats', (_kind, make) => {
    const el = make();

    expect(el.textContent).not.toMatch(/MP4|WEBM|QUICKTIME|MPEG|MP3|OGG|PNG|JPG|JPEG|PDF|ZIP/);
    expect(el.querySelector('.blok-media-empty__meta')).toBeNull();
  });

  it.each([
    ['video', () => renderVideo(handlers), 'Drag a video here, choose one from your device, or paste a link.'],
    ['audio', () => renderAudio(handlers), 'Drag an audio file here, choose one from your device, or paste a link.'],
    ['image', () => renderImage(handlers), 'Drag a picture here, choose one from your device, or paste a link.'],
  ] as const)('%s has its own sentence', (_kind, make, sentence) => {
    expect(hint(make())).toBe(sentence);
  });
});

describe('drawing depth follows the pointer', () => {
  const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

  const setup = (): { surface: HTMLElement; preview: HTMLElement } => {
    const el = render({ preview: 'image' });
    const surface = card(el);
    const preview = need<HTMLElement>(el, '[data-blok-media-preview]');
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100));
    return { surface, preview };
  };

  const move = (target: HTMLElement, x: number, y: number): void => {
    target.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
  };

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('leans toward the pointer, from -1 at one edge to 1 at the other', async () => {
    const { surface, preview } = setup();

    move(surface, 200, 0);
    await nextFrame();

    expect(preview.style.getPropertyValue('--mx')).toBe('1');
    expect(preview.style.getPropertyValue('--my')).toBe('-1');
  });

  it('settles back to center when the pointer leaves', async () => {
    const { surface, preview } = setup();

    move(surface, 50, 75);
    await nextFrame();
    surface.dispatchEvent(new MouseEvent('pointerleave'));

    expect(preview.style.getPropertyValue('--mx')).toBe('0');
    expect(preview.style.getPropertyValue('--my')).toBe('0');
  });

  it('stays still when the user asks for reduced motion', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query.includes('reduce'), media: query }),
    });
    const { surface, preview } = setup();

    move(surface, 200, 0);
    await nextFrame();

    expect(preview.style.getPropertyValue('--mx')).toBe('');
  });
});

describe('drawing springs home when the pointer leaves', () => {
  const setup = (): { surface: HTMLElement; preview: HTMLElement } => {
    const el = render({ preview: 'video' });
    return { surface: card(el), preview: need<HTMLElement>(el, '[data-blok-media-preview]') };
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('plays the demo while the pointer is over the surface', () => {
    const { surface, preview } = setup();

    surface.dispatchEvent(new MouseEvent('pointerenter'));

    expect(preview.hasAttribute('data-hover')).toBe(true);
  });

  it('swaps the demo for an exit that clears once it has played', () => {
    const { surface, preview } = setup();
    surface.dispatchEvent(new MouseEvent('pointerenter'));

    surface.dispatchEvent(new MouseEvent('pointerleave'));

    expect(preview.hasAttribute('data-hover')).toBe(false);
    expect(preview.hasAttribute('data-leaving')).toBe(true);

    vi.advanceTimersByTime(2000);

    expect(preview.hasAttribute('data-leaving')).toBe(false);
  });

  it('drops the exit and replays the demo when the pointer comes back', () => {
    const { surface, preview } = setup();
    surface.dispatchEvent(new MouseEvent('pointerenter'));
    surface.dispatchEvent(new MouseEvent('pointerleave'));

    surface.dispatchEvent(new MouseEvent('pointerenter'));

    expect(preview.hasAttribute('data-leaving')).toBe(false);
    expect(preview.hasAttribute('data-hover')).toBe(true);

    vi.advanceTimersByTime(2000);

    expect(preview.hasAttribute('data-hover')).toBe(true);
  });

  it('skips the exit when the user asks for reduced motion', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query.includes('reduce'), media: query }),
    });
    const { surface, preview } = setup();
    surface.dispatchEvent(new MouseEvent('pointerenter'));

    surface.dispatchEvent(new MouseEvent('pointerleave'));

    expect(preview.hasAttribute('data-hover')).toBe(false);
    expect(preview.hasAttribute('data-leaving')).toBe(false);
  });
});
