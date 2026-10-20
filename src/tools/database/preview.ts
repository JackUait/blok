import { IconArrowDiagonal, IconBoard, IconCalendar, IconMap, IconSelect, IconTable, IconText } from '../../components/icons';
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

/** Table view entry: the one Table view it inserts (no Board tab); a new row slides in. */
export const renderTableViewPreview = (): HTMLElement =>
  createPreview(
    'database',
    h('div', { 'data-tabs': '' }, tab(IconTable, 'Table', true)),
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
      row('Plan trip', 'green', 'Done', 'Sep 3'),
      row('Book flights', 'yellow', 'Doing', 'Sep 9'),
      row('Find a hotel', 'gray', 'To do', 'Sep 14'),
      row('Pack bags', 'purple', 'Idea', 'Sep 20', true)
    )
  );

/** Map view entry: the "Map view" tab, pins on the map and the Add pin button; a new pin drops in. */
export const renderMapViewPreview = (): HTMLElement =>
  createPreview(
    'database',
    h('div', { 'data-tabs': '' }, tab(IconMap, 'Map view', true)),
    h(
      'div',
      { 'data-map': '' },
      h('span', { 'data-land': 'west' }),
      h('span', { 'data-land': 'east' }),
      h('span', { 'data-add-pin': '' }, icon(IconMap)),
      h('span', { 'data-pin': 'a' }),
      h('span', { 'data-pin': 'b' }),
      h('span', { 'data-pin': 'new' })
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

/**
 * Linked view: the same table as the database's, under the source's name
 * with a link arrow, as a linked view shows its source's title.
 */
export const renderLinkedDatabasePreview = (): HTMLElement =>
  createPreview(
    'database',
    h('div', { 'data-tabs': '' }, h('span', { 'data-linked-source': '' }, icon(IconArrowDiagonal), 'Tasks'), tab(IconTable, 'My view', true)),
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
      row('Send invites', 'purple', 'Idea', 'Oct 6')
    )
  );
