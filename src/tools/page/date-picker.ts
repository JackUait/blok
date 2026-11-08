import { localDateIso, readDateMention } from '../../shared/date-mention';
import { PopoverDesktop, PopoverItemType } from '../../components/utils/popover';
import { PopoverEvent } from '../../../types/utils/popover/popover-event';

/** A compact calendar for editing an inline date mention. */
export class DateMentionPicker {
  private popover: PopoverDesktop | null = null;
  private content: HTMLElement | null = null;
  private anchor: HTMLTimeElement | null = null;

  public open(anchor: HTMLTimeElement, locale: string | undefined, onPick: (iso: string) => void): void {
    this.close();
    const initial = readDateMention(anchor.getAttribute('datetime')) ?? new Date();
    let month = new Date(initial.getFullYear(), initial.getMonth(), 1);
    const content = document.createElement('div');
    const field = document.createElement('input');
    const caption = document.createElement('div');
    const grid = document.createElement('div');
    const previous = document.createElement('button');
    const next = document.createElement('button');
    const today = document.createElement('button');
    const title = document.createElement('span');
    const french = locale?.startsWith('fr') === true;

    content.setAttribute('data-blok-date-picker', '');
    content.setAttribute('role', 'dialog');
    content.setAttribute('aria-label', french ? 'Choisir une date' : 'Choose date');
    field.type = 'date';
    field.value = localDateIso(initial);
    field.setAttribute('aria-label', 'Date');
    field.addEventListener('change', () => {
      if (readDateMention(field.value) !== null) {
        onPick(field.value);
        this.close();
        anchor.focus();
      }
    });
    previous.type = 'button';
    previous.textContent = '‹';
    previous.setAttribute('aria-label', french ? 'Mois précédent' : 'Previous month');
    next.type = 'button';
    next.textContent = '›';
    next.setAttribute('aria-label', french ? 'Mois suivant' : 'Next month');
    today.type = 'button';
    today.textContent = french ? 'Aujourd’hui' : 'Today';
    today.setAttribute('data-blok-date-picker-today', '');
    today.addEventListener('click', () => { onPick(localDateIso(new Date())); this.close(); anchor.focus(); });
    previous.addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); render(); });
    next.addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); render(); });
    caption.setAttribute('data-blok-date-picker-caption', '');
    caption.append(today, previous, title, next);
    grid.setAttribute('data-blok-date-picker-grid', '');
    content.append(field, caption, grid);

    const render = (): void => {
      title.textContent = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(month);
      const weekdays = Array.from({ length: 7 }, (_, index) => {
        const label = document.createElement('span');
        const day = new Date(2024, 0, 1 + index); // 1 January 2024 was a Monday.

        label.textContent = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(day);
        label.setAttribute('aria-hidden', 'true');
        return label;
      });
      const firstWeekday = (month.getDay() + 6) % 7;
      const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      const cells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
      const days = Array.from({ length: cells }, (_, index) => {
        const date = new Date(month.getFullYear(), month.getMonth(), index - firstWeekday + 1);
        const iso = localDateIso(date);
        const button = document.createElement('button');

        button.type = 'button';
        button.textContent = String(date.getDate());
        button.setAttribute('aria-label', new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(date));
        button.toggleAttribute('data-outside-month', date.getMonth() !== month.getMonth());
        button.setAttribute('aria-pressed', String(iso === anchor.getAttribute('datetime')));
        button.addEventListener('click', () => { onPick(iso); this.close(); anchor.focus(); });
        return button;
      });

      grid.replaceChildren(...weekdays, ...days);
    };

    render();
    this.anchor = anchor;
    this.content = content;
    const popover = new PopoverDesktop({
      items: [{ type: PopoverItemType.Html, element: content }],
      trigger: anchor,
      minWidth: '280px',
      flippable: true,
    });

    this.popover = popover;
    popover.on(PopoverEvent.Closed, () => this.close());
    popover.show();
    document.addEventListener('pointerdown', this.onOutsidePointer, true);
    document.addEventListener('keydown', this.onEscape, true);
    field.focus();
  }

  public close(): void {
    const popover = this.popover;

    this.popover = null;
    this.content = null;
    this.anchor = null;
    document.removeEventListener('pointerdown', this.onOutsidePointer, true);
    document.removeEventListener('keydown', this.onEscape, true);
    popover?.destroy();
  }

  private readonly onOutsidePointer = (event: Event): void => {
    if (event.target instanceof Node && !this.content?.contains(event.target) && !this.anchor?.contains(event.target)) {
      this.close();
    }
  };

  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      const anchor = this.anchor;

      this.close();
      anchor?.focus();
    }
  };
}
