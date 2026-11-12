// Type only: the picker and its landings load on first open, so the bare editor bundle does not carry them.
import type { EmojiPicker } from '../../../tools/callout/emoji-picker';
import type { Landing, chooseLanding, playLanding } from '../../../tools/callout/emoji-landing';
import { IconEmojiSmile } from '../../icons';
import { DATA_ATTR } from '../../constants/data-attributes';
import { loadEmojiGrid } from '../../utils/emoji/emoji-data';
import { pageIconNode } from '../../../tools/page/icon-node';
import type { PageIcon } from '../../../../types/tools/page';

export interface IconControlHost {
  getIcon(): PageIcon | null;
  setIcon(icon: PageIcon | null): void;
  isReadOnly(): boolean;
  labels(): { add: string; change: string };
  picker(): { i18n: { t(key: string): string }; locale: string };
}

interface PickerCode {
  Picker: typeof EmojiPicker;
  landings: { chooseLanding: typeof chooseLanding; playLanding: typeof playLanding };
}

const pickerLoad: { pending: Promise<PickerCode> | null } = { pending: null };

/** One shared load; a failed one is dropped so the next click tries again. */
const loadPicker = (): Promise<PickerCode> => {
  pickerLoad.pending ??= Promise.all([
    import('../../../tools/callout/emoji-picker'),
    import('../../../tools/callout/emoji-landing'),
  ]).then(([{ EmojiPicker: Picker }, landings]) => ({ Picker, landings }), (error: unknown) => {
    pickerLoad.pending = null;
    throw error;
  });

  return pickerLoad.pending;
};

/** The ghost box that fits a glyph of this face's font size; landings size the ghost's glyph at 0.9 of its box. */
const seatSize = (face: HTMLElement): number | undefined => {
  const fontSize = parseFloat(getComputedStyle(face).fontSize);

  return fontSize > 0 ? fontSize / 0.9 : undefined;
};

const randomEmoji = async (): Promise<string> => {
  const emojis = await loadEmojiGrid();
  const emoji = emojis[Math.floor(Math.random() * emojis.length)];

  if (emoji === undefined) {
    throw new Error('No emojis to pick from');
  }

  return emoji.native;
};

const iconKey = (icon: PageIcon | null): string | null => {
  if (icon === null) {
    return null;
  }

  return icon.type === 'emoji' ? `emoji:${icon.value}` : `image:${icon.url}`;
};

/** An emoji sits in a span so a landing can hide and spring it without moving the button's hover tile. */
const faceNode = (icon: PageIcon): Node => {
  if (icon.type !== 'emoji') {
    return pageIconNode(icon);
  }
  const face = document.createElement('span');

  face.textContent = icon.value;

  return face;
};

/** `trailing` stays after the icon or Add icon, in the same row. */
export const createIconControl = (row: HTMLElement, host: IconControlHost, trailing: () => HTMLElement[] = () => []): { redraw(): void; destroy(): void } => {
  const slot: { picker: EmojiPicker | null; locale: string | null; watch: MutationObserver | null; destroyed: boolean } = {
    picker: null,
    locale: null,
    watch: null,
    destroyed: false,
  };

  // The open picker is anchored to the button and gives focus back to it, so a
  // redraw of the same kind updates that button instead of replacing it.
  const shown: { kind: 'add' | 'icon' | null; button: HTMLButtonElement | null; icon: PageIcon | null } = { kind: null, button: null, icon: null };
  const landing: { last: Landing | null; stop: (() => void) | null } = { last: null, stop: null };

  const stopLanding = (): void => {
    landing.stop?.();
    landing.stop = null;
  };

  const openPicker = (anchor: HTMLElement): void => {
    // A failed chunk opens nothing; the next click tries again.
    loadPicker().then((code) => {
      // Destroy or read-only can land while the code loads.
      if (!slot.destroyed && !host.isReadOnly()) {
        showPicker(code, anchor);
      }
    }, () => undefined);
  };

  /** Flies the picked glyph from the picker into the icon, as a callout does. */
  const land = ({ chooseLanding, playLanding }: PickerCode['landings'], previous: PageIcon | null, native: string, origin: DOMRect): void => {
    const face = shown.button?.querySelector('span');
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

    if (face === null || face === undefined || reduceMotion) {
      return;
    }
    landing.last = chooseLanding(landing.last);
    landing.stop = playLanding(landing.last, {
      from: origin,
      face,
      surface: shown.button ?? face,
      previous: previous?.type === 'emoji' ? previous.value : '',
      next: native,
      size: seatSize(face),
    });
  };

  const showPicker = ({ Picker, landings }: PickerCode, anchor: HTMLElement): void => {
    const { i18n, locale } = host.picker();

    const handlers = {
      onSelect: (native: string, origin?: DOMRect): void => {
        const previous = host.getIcon();

        stopLanding();
        host.setIcon({ type: 'emoji', value: native });
        if (origin !== undefined && native !== '') {
          land(landings, previous, native, origin);
        }
      },
      onRemove: (): void => host.setIcon(null),
    };
    const icon = host.getIcon();

    if (slot.picker === null || slot.locale !== locale) {
      slot.picker?.getElement().remove();
      slot.picker = new Picker({
        ...handlers,
        i18n,
        locale,
        curated: false,
        startInset: 0,
      });
      slot.locale = locale;
    }
    const element = slot.picker.getElement();

    if (!element.isConnected) {
      document.body.append(element);
    }
    // The picker has no close callback; it hides its root on close.
    slot.watch?.disconnect();
    slot.watch = new MutationObserver(() => {
      if (element.hidden) {
        anchor.setAttribute('aria-expanded', 'false');
        slot.watch?.disconnect();
      }
    });
    anchor.setAttribute('aria-expanded', 'true');
    slot.watch.observe(element, { attributes: true, attributeFilter: ['hidden'] });
    void slot.picker.open(anchor, undefined, { ...handlers, current: icon?.type === 'emoji' ? icon.value : '' });
  };

  const closePicker = (): void => {
    if (slot.picker?.isOpen() === true) {
      slot.picker.close();
    }
  };

  const buildAdd = (): HTMLButtonElement => {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(DATA_ATTR.pageAddIcon, '');
    button.setAttribute('data-blok-testid', 'page-header-add-icon');
    // A trusted constant from the icon module; the label goes in as text.
    button.innerHTML = IconEmojiSmile;
    button.append(document.createElement('span'));
    button.addEventListener('click', () => {
      // Read-only can engage while the emoji data loads.
      void randomEmoji().then((native) => {
        if (host.isReadOnly()) {
          return;
        }
        host.setIcon({ type: 'emoji', value: native });
        openPicker(shown.button ?? button);
      }, () => {
        if (!host.isReadOnly()) {
          openPicker(button);
        }
      });
    });
    // Loaded now so the click's random pick resolves at once.
    void loadEmojiGrid().catch(() => undefined);

    return button;
  };

  const buildIcon = (): HTMLButtonElement => {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(DATA_ATTR.pageIcon, '');
    button.setAttribute('data-blok-testid', 'page-header-icon');
    button.addEventListener('click', () => openPicker(button));

    return button;
  };

  const kindOf = (icon: PageIcon | null, readOnly: boolean): 'add' | 'icon' | null => {
    if (icon !== null) {
      return 'icon';
    }

    return readOnly ? null : 'add';
  };

  const redraw = (): void => {
    const icon = host.getIcon();
    const readOnly = host.isReadOnly();
    const { add, change } = host.labels();
    const kind = kindOf(icon, readOnly);

    if (readOnly || kind !== shown.kind) {
      closePicker();
    }
    row.toggleAttribute('data-has-icon', icon !== null);
    if (kind !== shown.kind) {
      const hadFocus = shown.button !== null && shown.button.contains(document.activeElement);

      shown.kind = kind;
      shown.button = null;
      if (kind === 'add') {
        shown.button = buildAdd();
      } else if (kind === 'icon') {
        shown.button = buildIcon();
      }
      row.replaceChildren(...(shown.button === null ? [] : [shown.button]), ...trailing());
      if (hadFocus) {
        shown.button?.focus();
      }
    }
    const button = shown.button;

    if (button === null) {
      stopLanding();
      shown.icon = null;

      return;
    }
    if (icon === null) {
      stopLanding();
      shown.icon = null;
      const label = button.querySelector('span');

      if (label !== null) {
        label.textContent = add;
      }

      return;
    }
    button.disabled = readOnly;
    button.setAttribute('aria-label', change);
    // A landing flies to the face that is on screen; replacing it for the same icon would show it early.
    if (iconKey(shown.icon) === iconKey(icon) && button.firstChild !== null) {
      return;
    }
    stopLanding();
    shown.icon = icon;
    button.replaceChildren(faceNode(icon));
  };

  redraw();
  // Loaded now, like the emoji grid, so the first open does not wait for it.
  loadPicker().catch(() => undefined);

  return {
    redraw,
    destroy: (): void => {
      slot.destroyed = true;
      stopLanding();
      slot.watch?.disconnect();
      slot.picker?.close();
      slot.picker?.getElement().remove();
      row.replaceChildren();
      shown.kind = null;
      shown.button = null;
      shown.icon = null;
    },
  };
};
