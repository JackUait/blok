import { dateMentionLabel, localDateIso, readDateMention } from '../../src/shared/date-mention';

export const titleDateLabel = (iso: string, now = new Date()): string | null =>
  dateMentionLabel(iso, now, 'fr');

/** Offers a fixed date mention when the whole page title starts with @today. */
export function bindTitleDateMention(
  title: HTMLElement,
  options: { getDate(): string | undefined; chooseDate(iso: string, label: string): void },
): () => void {
  let menu: HTMLElement | null = null;
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
    if (date !== undefined && readDateMention(date) !== null) {
      title.setAttribute('data-desktop-title-date', date);
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
    options.chooseDate(iso, titleDateLabel(iso, now) ?? 'Aujourd’hui');
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

  if (document.activeElement === title) onInput();
  else refresh();
  title.addEventListener('input', onInput);
  title.addEventListener('keydown', onKeydown, true);
  title.addEventListener('focusout', onFocusOut);
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('resize', position);
  document.addEventListener('scroll', position, true);
  return () => {
    close();
    title.removeEventListener('input', onInput);
    title.removeEventListener('keydown', onKeydown, true);
    title.removeEventListener('focusout', onFocusOut);
    document.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('resize', position);
    document.removeEventListener('scroll', position, true);
  };
}
