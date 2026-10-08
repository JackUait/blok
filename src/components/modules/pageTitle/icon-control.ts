import { EmojiPicker } from '../../../tools/callout/emoji-picker';
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

const randomEmoji = async (): Promise<string> => {
  const emojis = await loadEmojiGrid();
  const emoji = emojis[Math.floor(Math.random() * emojis.length)];

  if (emoji === undefined) {
    throw new Error('No emojis to pick from');
  }

  return emoji.native;
};

export const createIconControl = (row: HTMLElement, host: IconControlHost): { redraw(): void; destroy(): void } => {
  const slot: { picker: EmojiPicker | null; locale: string | null; watch: MutationObserver | null } = {
    picker: null,
    locale: null,
    watch: null,
  };

  // The open picker is anchored to the button and gives focus back to it, so a
  // redraw of the same kind updates that button instead of replacing it.
  const shown: { kind: 'add' | 'icon' | null; button: HTMLButtonElement | null } = { kind: null, button: null };

  const openPicker = (anchor: HTMLElement): void => {
    const { i18n, locale } = host.picker();

    if (slot.picker === null || slot.locale !== locale) {
      slot.picker?.getElement().remove();
      slot.picker = new EmojiPicker({
        onSelect: (native) => host.setIcon({ type: 'emoji', value: native }),
        onRemove: () => host.setIcon(null),
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
    void slot.picker.open(anchor);
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
      void randomEmoji().then((native) => {
        host.setIcon({ type: 'emoji', value: native });
        openPicker(shown.button ?? button);
      }, () => openPicker(button));
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
      row.replaceChildren(...(shown.button === null ? [] : [shown.button]));
      if (hadFocus) {
        shown.button?.focus();
      }
    }
    const button = shown.button;

    if (button === null) {
      return;
    }
    if (icon === null) {
      const label = button.querySelector('span');

      if (label !== null) {
        label.textContent = add;
      }

      return;
    }
    button.disabled = readOnly;
    button.setAttribute('aria-label', change);
    button.replaceChildren(pageIconNode(icon));
  };

  redraw();

  return {
    redraw,
    destroy: (): void => {
      slot.watch?.disconnect();
      slot.picker?.close();
      slot.picker?.getElement().remove();
      row.replaceChildren();
      shown.kind = null;
      shown.button = null;
    },
  };
};
