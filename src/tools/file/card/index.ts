import type { FileConfig, FileData } from '../../../../types/tools/file';
import { whenNearViewport } from '../../../components/utils/near-viewport';
import { resolveFileIcon, showsFileSize } from '../file-icon';
import { humanFileSize } from '../format';
import { initialContent, loadCardContent, type CardCount, type LoadedCard } from './card-content';
import { buildCardObject, type BuiltObject, type CardContent } from './card-objects';
import { createSprings, kickSprings, reducedMotion, stepSprings, stopSprings, wakeSprings, type Springs } from './card-physics';

/** What a count counts. */
export type CardUnit = 'pages' | 'lines' | 'sheets' | 'slides' | 'files' | 'rows';

export interface CardObjectOptions {
  data: Pick<FileData, 'url' | 'fileName' | 'size' | 'mimeType'>;
  config: Pick<FileConfig, 'fetchPreview' | 'pdfAssetsUrl' | 'previewEndpoint'>;
  /** "14 pages" in the reader's language. It gets the number, so each language picks its plural form. */
  countLabel: (unit: CardUnit, count: number) => string;
}

/** How far below rest a freshly read object starts, so it rises into the card. */
const ENTER_FROM = 46;
/** Length of the download arrow's drop, in ms. Matches `blok-file-drop` in file.css. */
const DROP_MS = 800;

/**
 * Gives a rendered file card its object: the file's first page, an editor tab
 * with its first lines, a record, a folder. Files drawn as a container show at
 * once; the rest show when their content has been read, and a file that cannot
 * be read keeps the plain card.
 * @returns a teardown; call it before the card is thrown away
 */
export function mountCardObject(wrapper: HTMLElement, opts: CardObjectOptions): () => void {
  const card = wrapper.querySelector<HTMLElement>('.blok-file-card');
  if (card === null) {
    return () => undefined;
  }
  const { category } = resolveFileIcon(opts.data);
  const controller = new AbortController();
  const held: {
    built: BuiltObject | null;
    springs: Springs | null;
    release: (() => void) | null;
    hover: boolean;
    px: number;
    dropTimer: ReturnType<typeof setTimeout> | null;
  } = { built: null, springs: null, release: null, hover: false, px: 0.5, dropTimer: null };

  const syncHover = (): void => {
    if (held.springs === null || held.built === null) {
      return;
    }
    held.springs.hover = held.hover;
    held.springs.px = held.px;
    held.built.stage.toggleAttribute('data-hot', held.hover);
    wakeSprings(held.springs);
  };

  const show = (content: CardContent, enter: boolean): void => {
    if (held.springs !== null) {
      stopSprings(held.springs);
    }
    held.built?.stage.remove();
    const built = buildCardObject(content);
    held.built = built;
    held.springs = createSprings({
      stage: built.stage,
      top: built.top,
      unders: built.unders,
      fx: category,
      columns: built.columns,
      // With reduced motion the springs never run, so the object must start at rest.
      ...(enter && !reducedMotion() ? { enterFrom: ENTER_FROM } : {}),
    });
    // Writes the resting values before the first paint.
    stepSprings(held.springs, 0);
    card.appendChild(built.stage);
    wrapper.setAttribute('data-file-object', content.kind);
    syncHover();
  };

  const showCount = (count: CardCount): void => {
    const text = count.unit === 'plain' ? count.text : opts.countLabel(count.unit, count.value);
    if (held.built?.detail !== undefined) {
      held.built.detail.textContent = text;
    }
    const meta = wrapper.querySelector<HTMLElement>('.blok-file-meta');
    const existing = wrapper.querySelector<HTMLElement>('[data-role="file-size"]');
    const size = existing ?? document.createElement('span');
    if (existing === null) {
      size.className = 'blok-file-size';
      size.setAttribute('data-role', 'file-size');
      meta?.appendChild(size);
    }
    const weight = showsFileSize(category) ? humanFileSize(opts.data.size) : '';
    size.textContent = [text, weight].filter((part) => part !== '').join(' · ');
  };

  const apply = (loaded: LoadedCard | null): void => {
    if (loaded === null) {
      return;
    }
    if (controller.signal.aborted) {
      loaded.release?.();

      return;
    }
    held.release = loaded.release ?? null;
    const sameContainer = held.built !== null && loaded.content.kind !== 'generic';
    if (!sameContainer && (loaded.content.kind !== 'generic' || loaded.content.bytes !== null)) {
      show(loaded.content, held.built === null);
    }
    if (loaded.count !== undefined) {
      showCount(loaded.count);
    }
  };

  const at = (event: PointerEvent): void => {
    const box = wrapper.getBoundingClientRect();
    held.px = box.width > 0 ? Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) : 0.5;
  };
  const enter = (event: PointerEvent): void => {
    held.hover = true;
    at(event);
    syncHover();
  };
  const move = (event: PointerEvent): void => {
    at(event);
    syncHover();
  };
  const leave = (): void => {
    held.hover = false;
    syncHover();
  };
  const focusIn = (event: FocusEvent): void => {
    // Keyboard focus only: a click also focuses the card, and must not leave the object lifted.
    if (event.target instanceof HTMLElement && event.target.matches('[data-role="file-card"]:focus-visible')) {
      held.hover = true;
      syncHover();
    }
  };
  const download = wrapper.querySelector<HTMLElement>('.blok-file-download');
  const drop = (): void => {
    if (held.springs !== null) {
      kickSprings(held.springs);
      wakeSprings(held.springs);
    }
    if (download === null) {
      return;
    }
    if (held.dropTimer !== null) {
      clearTimeout(held.dropTimer);
    }
    download.removeAttribute('data-dropping');
    // Reading layout restarts the animation when the arrow is pressed again mid-drop.
    download.getBoundingClientRect();
    download.setAttribute('data-dropping', '');
    held.dropTimer = setTimeout(() => {
      held.dropTimer = null;
      download.removeAttribute('data-dropping');
    }, DROP_MS);
  };

  wrapper.addEventListener('pointerenter', enter);
  wrapper.addEventListener('pointermove', move);
  wrapper.addEventListener('pointerleave', leave);
  wrapper.addEventListener('focusin', focusIn);
  wrapper.addEventListener('focusout', leave);
  download?.addEventListener('click', drop);

  const first = initialContent(category, opts.data.fileName);
  if (first !== null) {
    show(first, false);
  }
  const stopWatching = whenNearViewport(wrapper, () => {
    loadCardContent(category, { data: opts.data, config: opts.config, signal: controller.signal }).then(apply, () => undefined);
  });

  return () => {
    controller.abort();
    stopWatching();
    wrapper.removeEventListener('pointerenter', enter);
    wrapper.removeEventListener('pointermove', move);
    wrapper.removeEventListener('pointerleave', leave);
    wrapper.removeEventListener('focusin', focusIn);
    wrapper.removeEventListener('focusout', leave);
    download?.removeEventListener('click', drop);
    if (held.dropTimer !== null) {
      clearTimeout(held.dropTimer);
      held.dropTimer = null;
    }
    download?.removeAttribute('data-dropping');
    if (held.springs !== null) {
      stopSprings(held.springs);
    }
    held.release?.();
    held.release = null;
    held.built?.stage.remove();
    held.built = null;
    held.springs = null;
    wrapper.removeAttribute('data-file-object');
  };
}
