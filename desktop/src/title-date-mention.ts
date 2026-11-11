import { localDateIso } from '../../src/shared/date-mention';
import { parseDateValue } from '../../src/shared/database/date-value';
import { formatDateDisplay } from '../../src/tools/database/cells/date-format';
import { loadSheet } from '../../src/components/utils/lazy-styles';
import type { DateDisplay, DateDisplayChange, DateEditorHandle } from '@blok/date-editor';

export const titleDateLabel = (value: string, now = new Date(), display: DateDisplay = {}): string | null =>
  formatDateDisplay(value, 'fr', { dateFormat: 'relative', ...display }, now);

export interface TitleDateMentionBinding {
  refresh(): void;
  destroy(): void;
}

/** Offers a fixed date mention when the whole page title starts with @today. */
export function bindTitleDateMention(
  title: HTMLElement,
  options: {
    getDate(): string | undefined;
    getDisplay(): DateDisplay;
    setDate(value: string | null): void;
    setDisplay(change: DateDisplayChange): void;
    i18n: { t(key: string): string };
  },
): TitleDateMentionBinding {
  let menu: HTMLElement | null = null;
  let dateEditor: DateEditorHandle | null = null;
  const listId = `desktop-title-date-${crypto.randomUUID()}`;

  const close = (): void => {
    menu?.remove();
    menu = null;
    title.removeAttribute('aria-controls');
    title.removeAttribute('aria-expanded');
    title.removeAttribute('aria-activedescendant');
  };
  const refresh = (): void => {
    const date = options.getDate();
    if (date !== undefined && parseDateValue(date) !== null) {
      title.setAttribute('data-desktop-title-date', date);
      const label = titleDateLabel(date, new Date(), options.getDisplay());
      if (label !== null && (title.textContent ?? '').startsWith(`@${label}`) &&
        title.querySelector('[data-desktop-title-date-token]') === null) {
        const suffix = (title.textContent ?? '').slice(label.length + 1);
        const token = document.createElement('span');
        const at = document.createElement('span');
        const text = document.createElement('span');
        token.setAttribute('data-desktop-title-date-token', '');
        token.setAttribute('data-blok-title-mention-token', '');
        token.setAttribute('contenteditable', 'false');
        token.setAttribute('role', 'button');
        token.setAttribute('aria-label', `Modifier la date : ${label}`);
        token.tabIndex = 0;
        at.setAttribute('data-desktop-title-date-at', '');
        at.textContent = '@';
        text.textContent = label;
        token.append(at, text);
        title.replaceChildren(token, ...(suffix ? [document.createTextNode(suffix)] : []));
      }
    } else {
      title.removeAttribute('data-desktop-title-date');
    }
  };
  const position = (): void => {
    if (!menu) return;
    const rect = title.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
    menu.style.top = `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 12))}px`;
  };
  const choose = (): void => {
    close();
    const now = new Date();
    const iso = localDateIso(now);
    options.setDate(iso);
    refresh();
    title.focus();
    window.getSelection()?.setPosition(title, title.childNodes.length);
  };
  const open = (): void => {
    if (menu) return;
    const list = document.createElement('div');
    const heading = document.createElement('div');
    const today = document.createElement('button');
    list.id = listId;
    list.setAttribute('data-desktop-title-date-menu', '');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Date');
    heading.setAttribute('data-desktop-title-date-heading', '');
    heading.textContent = 'Date';
    today.type = 'button';
    today.id = `${listId}-today`;
    today.setAttribute('role', 'option');
    today.setAttribute('aria-selected', 'true');
    today.setAttribute('data-desktop-title-date-today', '');
    today.textContent = '◷  Aujourd’hui';
    // Keep the title focused until the click commits the mention.
    today.addEventListener('pointerdown', (event) => event.preventDefault());
    today.addEventListener('click', choose);
    list.append(heading, today);
    document.body.append(list);
    menu = list;
    title.setAttribute('aria-controls', listId);
    title.setAttribute('aria-expanded', 'true');
    title.setAttribute('aria-activedescendant', today.id);
    position();
  };
  const onInput = (): void => {
    refresh();
    const match = /^@([^\s@]*)$/u.exec(title.textContent ?? '');
    const query = match?.[1]?.toLocaleLowerCase() ?? '';
    if (match && ('today'.startsWith(query) || 'aujourd’hui'.startsWith(query) || 'aujourd\'hui'.startsWith(query))) {
      open();
    } else {
      close();
    }
  };
  const onKeydown = (event: KeyboardEvent): void => {
    const token = title.querySelector('[data-desktop-title-date-token]');
    const selection = window.getSelection();
    if (token && selection?.isCollapsed && (event.key === 'Backspace' || event.key === 'Delete')) {
      const beforeOrAfterToken = selection.anchorNode === title && selection.anchorOffset <= 1;
      const atStartOfSuffix = selection.anchorNode === token.nextSibling && selection.anchorOffset === 0;
      if ((event.key === 'Backspace' && (beforeOrAfterToken || atStartOfSuffix)) ||
        (event.key === 'Delete' && selection.anchorNode === title && selection.anchorOffset === 0)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const suffix = (title.textContent ?? '').slice((token.textContent ?? '').length).trimStart();
        title.replaceChildren(...(suffix ? [document.createTextNode(suffix)] : []));
        selection.setPosition(title, 0);
        title.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: event.key === 'Delete' ? 'deleteContentForward' : 'deleteContentBackward' }));
        return;
      }
    }
    if (options.getDate() && event.key === 'End' && token) {
      event.preventDefault();
      window.getSelection()?.setPosition(title, title.childNodes.length);
      return;
    }
    if (!menu && options.getDate() && event.key === 'Enter' &&
      event.target instanceof Element && event.target.closest('[data-desktop-title-date-token]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void openDatePicker();
      return;
    }
    if (!menu || !['Enter', 'Escape', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Enter') choose();
    else if (event.key === 'Escape') close();
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Node && !title.contains(event.target) && !menu?.contains(event.target)) close();
  };
  const onFocusOut = (): void => { close(); };
  const onFocusIn = (event: FocusEvent): void => {
    if (event.target !== title || !title.querySelector('[data-desktop-title-date-token]')) return;
    const selection = window.getSelection();
    if (selection && selection.isCollapsed && (selection.anchorNode === title || selection.anchorNode === null) && selection.anchorOffset === 0) {
      selection.setPosition(title, title.childNodes.length);
    }
  };
  const openDatePicker = async (): Promise<void> => {
    if (dateEditor?.isOpen || !options.getDate()) return;
    const [{ openDateEditor }] = await Promise.all([import('@blok/date-editor'), loadSheet('database')]);
    const value = options.getDate();
    if (!title.isConnected || !value) return;
    dateEditor = openDateEditor(
      { id: 'page-title-date', name: 'Date', type: 'date', position: '0', date: { dateFormat: 'relative', ...options.getDisplay() } },
      value,
      title,
      {
        i18n: options.i18n,
        locale: 'fr',
        readOnly: false,
        onCommit: (next) => { options.setDate(typeof next === 'string' ? next : null); refresh(); },
        onDateDisplayChange: (change) => { options.setDisplay(change); refresh(); },
        onClose: () => { dateEditor = null; },
      },
    );
    document.querySelector('[data-blok-database-date-editor][aria-label="Date"]')
      ?.closest('[data-blok-popover]')?.setAttribute('data-desktop-title-date-picker', '');
  };
  const onClick = (event: MouseEvent): void => {
    if (options.getDate() && event.target instanceof Element && event.target.closest('[data-desktop-title-date-token]')) {
      void openDatePicker();
    }
  };

  if (document.activeElement === title) onInput();
  else refresh();
  title.addEventListener('input', onInput);
  title.addEventListener('keydown', onKeydown, true);
  title.addEventListener('focusout', onFocusOut);
  title.addEventListener('focusin', onFocusIn);
  title.addEventListener('click', onClick);
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('resize', position);
  document.addEventListener('scroll', position, true);
  return {
    refresh,
    destroy: () => {
      close();
      dateEditor?.close();
      title.removeEventListener('input', onInput);
      title.removeEventListener('keydown', onKeydown, true);
      title.removeEventListener('focusout', onFocusOut);
      title.removeEventListener('focusin', onFocusIn);
      title.removeEventListener('click', onClick);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
    },
  };
}
