import { EmojiPicker } from '../../../tools/callout/emoji-picker';
import { IconEmojiSmile } from '../../icons';
import { DATA_ATTR } from '../../constants/data-attributes';
import { loadEmojiGrid } from '../../utils/emoji/emoji-data';
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

  const redraw = (): void => {
    const icon = host.getIcon();
    const readOnly = host.isReadOnly();
    const { add, change } = host.labels();

    row.replaceChildren();
    row.toggleAttribute('data-has-icon', icon !== null);
    if (icon === null) {
      if (readOnly) {
        return;
      }
      const button = document.createElement('button');

      button.type = 'button';
      button.setAttribute(DATA_ATTR.pageAddIcon, '');
      button.setAttribute('data-blok-testid', 'page-header-add-icon');
      // A trusted constant from the icon module; the label goes in as text.
      button.innerHTML = IconEmojiSmile;
      const label = document.createElement('span');

      label.textContent = add;
      button.append(label);
      button.addEventListener('click', () => {
        void randomEmoji().then((native) => {
          host.setIcon({ type: 'emoji', value: native });
          const shown = row.querySelector<HTMLElement>(`[${DATA_ATTR.pageIcon}]`);

          openPicker(shown ?? button);
        }, () => openPicker(button));
      });
      row.append(button);
      // Loaded now so the click's random pick resolves at once.
      void loadEmojiGrid().catch(() => undefined);

      return;
    }
    const button = document.createElement('button');

    button.type = 'button';
    button.disabled = readOnly;
    button.setAttribute(DATA_ATTR.pageIcon, '');
    button.setAttribute('data-blok-testid', 'page-header-icon');
    button.setAttribute('aria-label', change);
    if (icon.type === 'emoji') {
      button.textContent = icon.value;
    } else {
      const img = document.createElement('img');

      img.src = icon.url;
      img.alt = '';
      button.append(img);
    }
    button.addEventListener('click', () => openPicker(button));
    row.append(button);
  };

  redraw();

  return {
    redraw,
    destroy: (): void => {
      slot.watch?.disconnect();
      slot.picker?.close();
      slot.picker?.getElement().remove();
      row.replaceChildren();
    },
  };
};
