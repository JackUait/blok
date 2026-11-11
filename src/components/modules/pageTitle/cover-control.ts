import { IconImage } from '../../icons';
import { DATA_ATTR } from '../../constants/data-attributes';
import { safeImageSrc } from '../../../shared/sanitize-url';
import { COVER_GALLERY } from '../../../shared/page-cover';
import { registerLayer } from '../../utils/dismissable-layer';
import { promoteToTopLayer, removeFromTopLayer } from '../../utils/top-layer';
import { positionAnchored, createPositionTracker } from '../../utils/popover/anchored-position';
import type { PageCover } from '../../../../types/tools/page';

export interface CoverLabels {
  add: string;
  change: string;
  changeAria: string;
  reposition: string;
  repositionAria: string;
  savePosition: string;
  cancel: string;
  dragHint: string;
  gallery: string;
  upload: string;
  link: string;
  remove: string;
  uploadFile: string;
  noUpload: string;
  linkPlaceholder: string;
  submit: string;
  linkNote: string;
  invalid: string;
  uploadFailed: string;
  pickerAria: string;
  galleryName(id: string): string;
}

export interface CoverControlHost {
  getCover(): PageCover | null;
  setCover(cover: PageCover | null): void;
  isReadOnly(): boolean;
  labels(): CoverLabels;
  /** Null: the host has no image uploader, so Upload points to Link. */
  upload(): ((file: File) => Promise<string>) | null;
}

export interface CoverControl {
  /** Goes in the row over the title, after the icon. */
  addButton: HTMLButtonElement;
  redraw(): void;
  destroy(): void;
}

type Tab = 'gallery' | 'upload' | 'link';

const DEFAULT_POSITION = 50;

const button = (label: string, attrs: Record<string, string> = {}): HTMLButtonElement => {
  const element = document.createElement('button');

  element.type = 'button';
  element.textContent = label;
  Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));

  return element;
};

const randomGalleryId = (): string => COVER_GALLERY[Math.floor(Math.random() * COVER_GALLERY.length)] ?? COVER_GALLERY[0];

const positionOf = (cover: PageCover): number => cover.position ?? DEFAULT_POSITION;

export const createCoverControl = (header: HTMLElement, host: CoverControlHost): CoverControl => {
  const strip = document.createElement('div');
  const controls = document.createElement('div');
  const changeButton = button('', { 'data-blok-testid': 'page-cover-change', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
  const repositionButton = button('', { 'data-blok-testid': 'page-cover-reposition' });
  const saveButton = button('', { 'data-blok-testid': 'page-cover-save-position' });
  const cancelButton = button('', { 'data-blok-testid': 'page-cover-cancel-position' });
  const hint = document.createElement('span');
  const addButton = document.createElement('button');
  const addLabel = document.createElement('span');

  strip.setAttribute(DATA_ATTR.pageCover, '');
  strip.setAttribute('data-blok-testid', 'page-cover');
  controls.setAttribute(DATA_ATTR.pageCoverControls, '');
  controls.setAttribute('role', 'group');
  hint.setAttribute(DATA_ATTR.pageCoverHint, '');

  addButton.type = 'button';
  addButton.setAttribute(DATA_ATTR.pageAddCover, '');
  addButton.setAttribute('data-blok-testid', 'page-header-add-cover');
  // A trusted constant from the icon module; the label goes in as text.
  addButton.innerHTML = IconImage;
  addButton.append(addLabel);

  const state: {
    picker: { close(): void } | null;
    // The position being dragged; null when not repositioning.
    draft: number | null;
    drag: { startY: number; startPosition: number; height: number } | null;
  } = { picker: null, draft: null, drag: null };

  const art = (): HTMLElement | null => strip.querySelector<HTMLElement>(`img, [${DATA_ATTR.pageCoverFill}]`);

  const paintPosition = (position: number): void => {
    const image = art();

    if (image instanceof HTMLImageElement) {
      image.style.objectPosition = `center ${position}%`;
    }
  };

  const stopRepositioning = (): void => {
    state.draft = null;
    state.drag = null;
    strip.removeAttribute(DATA_ATTR.pageCoverRepositioning);
  };

  const drawArt = (cover: PageCover): void => {
    const current = art();

    if (cover.type === 'image') {
      const src = safeImageSrc(cover.url);
      const image = current instanceof HTMLImageElement ? current : document.createElement('img');

      image.alt = '';
      image.draggable = false;
      if (src === null) {
        image.removeAttribute('src');
      } else if (image.getAttribute('src') !== src) {
        image.src = src;
      }
      image.style.objectPosition = `center ${state.draft ?? positionOf(cover)}%`;
      if (image !== current) {
        current?.remove();
        strip.prepend(image);
      }

      return;
    }
    const fill = current !== null && !(current instanceof HTMLImageElement) ? current : document.createElement('div');

    fill.setAttribute(DATA_ATTR.pageCoverFill, '');
    fill.setAttribute(DATA_ATTR.pageCoverId, cover.id);
    if (fill !== current) {
      current?.remove();
      strip.prepend(fill);
    }
  };

  const drawControls = (cover: PageCover, labels: CoverLabels): void => {
    changeButton.textContent = labels.change;
    changeButton.setAttribute('aria-label', labels.changeAria);
    repositionButton.textContent = labels.reposition;
    repositionButton.setAttribute('aria-label', labels.repositionAria);
    saveButton.textContent = labels.savePosition;
    cancelButton.textContent = labels.cancel;
    hint.textContent = labels.dragHint;
    controls.setAttribute('aria-label', labels.pickerAria);
    const repositioning = state.draft !== null;
    const wanted = repositioning
      ? [saveButton, cancelButton]
      : [changeButton, ...(cover.type === 'image' ? [repositionButton] : [])];

    if (wanted.some((element, index) => controls.children[index] !== element) || controls.children.length !== wanted.length) {
      controls.replaceChildren(...wanted);
    }
    if (repositioning && !hint.isConnected) {
      strip.append(hint);
    } else if (!repositioning) {
      hint.remove();
    }
  };

  const closePicker = (): void => {
    state.picker?.close();
  };

  const redraw = (): void => {
    const cover = host.getCover();
    const readOnly = host.isReadOnly();
    const labels = host.labels();

    addLabel.textContent = labels.add;
    addButton.hidden = cover !== null || readOnly;
    if (cover?.type !== 'image') {
      stopRepositioning();
    }
    if (readOnly) {
      closePicker();
      stopRepositioning();
    }
    if (cover === null) {
      closePicker();
      strip.remove();
      strip.replaceChildren();

      return;
    }
    drawArt(cover);
    if (readOnly) {
      controls.remove();
    } else {
      drawControls(cover, labels);
      if (!controls.isConnected) {
        strip.append(controls);
      }
    }
    if (!strip.isConnected) {
      header.prepend(strip);
    }
  };

  const openPicker = (): void => {
    if (state.picker !== null) {
      closePicker();

      return;
    }
    const labels = host.labels();
    const dialog = document.createElement('div');
    const tabs = document.createElement('div');
    const panel = document.createElement('div');
    const error = document.createElement('p');
    const removeButton = button(labels.remove, { 'data-blok-testid': 'page-cover-remove' });
    const tabButtons = new Map<Tab, HTMLButtonElement>();
    const show = { tab: 'gallery' as Tab };

    dialog.setAttribute(DATA_ATTR.pageCoverPicker, '');
    dialog.setAttribute(DATA_ATTR.interface, header.getAttribute(DATA_ATTR.interface) ?? '');
    // Non-modal: anchored to Change, which carries aria-expanded; the page stays reachable.
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', labels.pickerAria);
    dialog.setAttribute('data-blok-testid', 'page-cover-picker');
    tabs.setAttribute('role', 'tablist');
    panel.setAttribute('role', 'tabpanel');
    error.setAttribute('role', 'alert');
    error.hidden = true;

    const fail = (message: string | null): void => {
      error.textContent = message ?? '';
      error.hidden = message === null;
    };

    const pick = (cover: PageCover | null): void => {
      host.setCover(cover);
      close();
    };

    const galleryPanel = (): HTMLElement[] => {
      const grid = document.createElement('div');

      grid.setAttribute(DATA_ATTR.pageCoverGallery, '');
      COVER_GALLERY.forEach((id) => {
        const tile = button('', { 'data-blok-testid': `page-cover-gallery-${id}`, 'aria-label': labels.galleryName(id), [DATA_ATTR.pageCoverId]: id });

        tile.addEventListener('click', () => pick({ type: 'gallery', id }));
        grid.append(tile);
      });

      return [grid];
    };

    const uploadPanel = (): HTMLElement[] => {
      const upload = host.upload();

      if (upload === null) {
        const note = document.createElement('p');

        note.textContent = labels.noUpload;

        return [note];
      }
      const input = document.createElement('input');
      const choose = button(labels.uploadFile, { 'data-blok-testid': 'page-cover-upload' });

      input.type = 'file';
      input.accept = 'image/*';
      input.hidden = true;
      input.setAttribute('data-blok-testid', 'page-cover-file');
      choose.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        const file = input.files?.[0];

        if (file === undefined) {
          return;
        }
        fail(null);
        choose.disabled = true;
        upload(file).then((url) => {
          if (safeImageSrc(url) === null) {
            fail(labels.invalid);

            return;
          }
          pick({ type: 'image', url });
        }, () => fail(labels.uploadFailed)).finally(() => {
          choose.disabled = false;
        });
      });

      return [choose, input];
    };

    const linkPanel = (): HTMLElement[] => {
      const form = document.createElement('form');
      const input = document.createElement('input');
      const submit = button(labels.submit, { 'data-blok-testid': 'page-cover-link-submit' });
      const note = document.createElement('p');

      input.type = 'url';
      // The shared field look (field.css).
      input.setAttribute('data-blok-field', 'text');
      input.placeholder = labels.linkPlaceholder;
      input.setAttribute('aria-label', labels.linkPlaceholder);
      input.setAttribute('data-blok-testid', 'page-cover-link-input');
      submit.type = 'submit';
      note.textContent = labels.linkNote;
      form.append(input, submit, note);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const url = input.value.trim();

        if (url === '' || safeImageSrc(url) === null) {
          fail(labels.invalid);

          return;
        }
        pick({ type: 'image', url });
      });
      queueMicrotask(() => input.focus());

      return [form];
    };

    const select = (tab: Tab): void => {
      show.tab = tab;
      tabButtons.forEach((tabButton, name) => tabButton.setAttribute('aria-selected', String(name === tab)));
      fail(null);
      const panels: Record<Tab, () => HTMLElement[]> = { gallery: galleryPanel, upload: uploadPanel, link: linkPanel };
      const content = panels[tab]();

      panel.replaceChildren(...content, error);
    };

    ([['gallery', labels.gallery], ['upload', labels.upload], ['link', labels.link]] as const).forEach(([tab, label]) => {
      const tabButton = button(label, { role: 'tab', 'data-blok-testid': `page-cover-tab-${tab}` });

      tabButton.addEventListener('click', () => select(tab));
      tabButtons.set(tab, tabButton);
      tabs.append(tabButton);
    });
    removeButton.setAttribute(DATA_ATTR.pageCoverRemove, '');
    removeButton.addEventListener('click', () => pick(null));
    tabs.append(removeButton);
    dialog.append(tabs, panel);
    select(show.tab);

    document.body.append(dialog);
    promoteToTopLayer(dialog);
    dialog.style.position = 'absolute';
    const reposition = (): void => {
      positionAnchored(dialog, changeButton, { side: 'bottom', offset: 4, align: 'end' });
    };

    reposition();
    const tracker = createPositionTracker(dialog, reposition);

    tracker.attach();
    changeButton.setAttribute('aria-expanded', 'true');
    strip.setAttribute(DATA_ATTR.pageCoverOpen, '');

    const unregister = registerLayer({ element: dialog, anchor: changeButton, onDismiss: () => close() });

    function close(): void {
      if (state.picker === null) {
        return;
      }
      state.picker = null;
      unregister();
      tracker.detach();
      removeFromTopLayer(dialog);
      dialog.remove();
      changeButton.setAttribute('aria-expanded', 'false');
      strip.removeAttribute(DATA_ATTR.pageCoverOpen);
    }

    state.picker = { close };
  };

  const startRepositioning = (): void => {
    const cover = host.getCover();

    if (cover?.type !== 'image' || host.isReadOnly()) {
      return;
    }
    closePicker();
    state.draft = positionOf(cover);
    strip.setAttribute(DATA_ATTR.pageCoverRepositioning, '');
    redraw();
  };

  const savePosition = (): void => {
    const cover = host.getCover();
    const position = state.draft;

    stopRepositioning();
    if (cover !== null && position !== null && position !== positionOf(cover)) {
      host.setCover({ ...cover, position });
    }
    redraw();
  };

  const cancelRepositioning = (): void => {
    stopRepositioning();
    redraw();
  };

  // Dragging down shows more of the image's top, as Notion's does.
  const onPointerDown = (event: PointerEvent): void => {
    if (state.draft === null || event.button !== 0 || controls.contains(event.target as Node)) {
      return;
    }
    event.preventDefault();
    strip.setPointerCapture?.(event.pointerId);
    state.drag = { startY: event.clientY, startPosition: state.draft, height: strip.getBoundingClientRect().height || 1 };
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (state.drag === null) {
      return;
    }
    const moved = ((event.clientY - state.drag.startY) / state.drag.height) * 100;

    state.draft = Math.round(Math.min(100, Math.max(0, state.drag.startPosition - moved)));
    paintPosition(state.draft);
  };

  const onPointerUp = (): void => {
    state.drag = null;
  };

  addButton.addEventListener('click', () => {
    if (!host.isReadOnly()) {
      host.setCover({ type: 'gallery', id: randomGalleryId() });
    }
  });
  changeButton.addEventListener('click', openPicker);
  repositionButton.addEventListener('click', startRepositioning);
  saveButton.addEventListener('click', savePosition);
  cancelButton.addEventListener('click', cancelRepositioning);
  strip.addEventListener('pointerdown', onPointerDown);
  strip.addEventListener('pointermove', onPointerMove);
  strip.addEventListener('pointerup', onPointerUp);
  strip.addEventListener('pointercancel', onPointerUp);

  redraw();

  return {
    addButton,
    redraw,
    destroy: (): void => {
      closePicker();
      stopRepositioning();
      strip.remove();
      addButton.remove();
    },
  };
};
