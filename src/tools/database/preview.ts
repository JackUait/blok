import { IconBoard, IconCalendar, IconSelect, IconTable, IconText } from '../../components/icons';
import { createPreview, h } from '../../components/utils/block-preview';

type Color = 'gray' | 'yellow' | 'green' | 'purple';

const icon = (svg: string): HTMLElement => {
  const span = h('span', { 'data-icon': '' });

  span.innerHTML = svg;

  return span;
};

const pill = (label: string, color: Color): HTMLElement =>
  h('span', { 'data-pill': color }, h('span', { 'data-dot': '' }), label);

const tab = (svg: string, label: string, active = false): HTMLElement =>
  h('span', active ? { 'data-tab': '', 'data-active': '' } : { 'data-tab': '' }, icon(svg), label);

const row = (title: string, status: Color, statusLabel: string, date: string, isNew = false): HTMLElement =>
  h(
    'div',
    isNew ? { 'data-row': '', 'data-new': '' } : { 'data-row': '' },
    h('span', { 'data-cell': 'title' }, title),
    h('span', { 'data-cell': 'status' }, pill(statusLabel, status)),
    h('span', { 'data-cell': 'date' }, date)
  );

/** Table view: tabs, a property header, rows; a new row slides in at the end. */
export const renderDatabasePreview = (): HTMLElement =>
  createPreview(
    'database',
    h('div', { 'data-tabs': '' }, tab(IconTable, 'Table', true), tab(IconBoard, 'Board')),
    h(
      'div',
      { 'data-table': '' },
      h(
        'div',
        { 'data-head': '' },
        h('span', { 'data-cell': 'title' }, icon(IconText), 'Name'),
        h('span', { 'data-cell': 'status' }, icon(IconSelect), 'Status'),
        h('span', { 'data-cell': 'date' }, icon(IconCalendar), 'Date')
      ),
      row('Write brief', 'green', 'Done', 'Sep 12'),
      row('Pick a name', 'yellow', 'Doing', 'Sep 18'),
      row('Book venue', 'gray', 'To do', 'Oct 2'),
      row('Throw party', 'purple', 'Idea', 'Oct 9', true)
    )
  );

const card = (title: string, tag: string, color: Color, attrs: Record<string, string> = {}): HTMLElement =>
  h('div', { 'data-card': '', ...attrs }, h('span', { 'data-card-title': '' }, title), pill(tag, color));

// Counts cross-fade from `before` to `after` as the card moves.
const column = (label: string, color: Color, before: string, after: string, ...cards: HTMLElement[]): HTMLElement =>
  h(
    'div',
    { 'data-column': color },
    h('div', { 'data-column-head': '' }, pill(label, color), h(
        'span',
        { 'data-count': '' },
        h('span', { 'data-count-before': '' }, before),
        h('span', { 'data-count-after': '' }, after)
      )),
    h('div', { 'data-cards': '' }, ...cards)
  );

/** Board view: one card lifts out of "In progress" and lands in "Done". */
export const renderBoardPreview = (): HTMLElement =>
  createPreview(
    'board',
    h(
      'div',
      { 'data-board': '' },
      column(
        'In progress',
        'yellow',
        '2',
        '1',
        card('Pitch deck', 'Q4', 'purple', { 'data-moving': '' }),
        card('Hire a chef', 'Team', 'gray', { 'data-shift': 'up' })
      ),
      column('Done', 'green', '1', '2', card('Logo', 'Brand', 'purple', { 'data-shift': 'down' }))
    )
  );
