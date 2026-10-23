import { IconArrowDiagonal, IconBoard, IconCalendar, IconGallery, IconListBulleted, IconListChecklist, IconMap, IconMessage, IconSelect, IconTable, IconText, IconTimeline } from '../../components/icons';
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

/** A Tags pill and a muted Created date, as a gallery card or list row shows them. */
const tagsAndCreated = (tag: string, color: Color, created: string): HTMLElement[] => [
  pill(tag, color),
  h('span', { 'data-muted': '' }, created),
];

const galleryCard = (title: string, tag: string, color: Color, created: string, isNew = false): HTMLElement =>
  h(
    'div',
    isNew ? { 'data-gallery-card': '', 'data-new': '' } : { 'data-gallery-card': '' },
    h('div', { 'data-gallery-cover': '' }, h('span', { 'data-line': 'long' }), h('span', { 'data-line': 'short' })),
    h('div', { 'data-gallery-body': '' }, h('span', { 'data-gallery-title': '' }, title), h('span', { 'data-props': '' }, ...tagsAndCreated(tag, color, created)))
  );

/** Gallery view entry: cards with a content cover, the title, Tags and Created; a new card fades in. */
export const renderGalleryViewPreview = (): HTMLElement =>
  createPreview(
    'database',
    h('div', { 'data-tabs': '' }, tab(IconGallery, 'Gallery view', true)),
    h(
      'div',
      { 'data-gallery': '' },
      galleryCard('Trip notes', 'Travel', 'green', 'Sep 3'),
      galleryCard('Reading list', 'Books', 'purple', 'Sep 9', true)
    )
  );

const listRow = (title: string, tag: string, color: Color, created: string, isNew = false): HTMLElement =>
  h(
    'div',
    isNew ? { 'data-list-row': '', 'data-new': '' } : { 'data-list-row': '' },
    h('span', { 'data-list-title': '' }, title),
    h('span', { 'data-props': '' }, ...tagsAndCreated(tag, color, created))
  );

/** List view entry: rows with the title on the left and Tags and Created on the right; a new row slides in. */
export const renderListViewPreview = (): HTMLElement =>
  createPreview(
    'database',
    h('div', { 'data-tabs': '' }, tab(IconListBulleted, 'List view', true)),
    h(
      'div',
      { 'data-list': '' },
      listRow('Weekly sync', 'Meeting', 'yellow', 'Sep 3'),
      listRow('Launch plan', 'Product', 'green', 'Sep 9'),
      listRow('Team offsite', 'Event', 'purple', 'Sep 14'),
      listRow('Design review', 'Meeting', 'yellow', 'Sep 20', true)
    )
  );

const feedCard = (title: string, author: string, time: string, body: string, isNew = false): HTMLElement =>
  h(
    'div',
    isNew ? { 'data-feed-card': '', 'data-new': '' } : { 'data-feed-card': '' },
    h('div', { 'data-feed-byline': '' }, h('span', { 'data-feed-author': '' }, author), h('span', { 'data-muted': '' }, time)),
    h('span', { 'data-feed-title': '' }, title),
    h('span', { 'data-feed-line': '' }, body)
  );

/** Feed view entry: one post card after another: byline, title, then the page body. */
export const renderFeedViewPreview = (): HTMLElement =>
  createPreview(
    'database',
    h('div', { 'data-tabs': '' }, tab(IconMessage, 'Feed view', true)),
    h(
      'div',
      { 'data-feed': '' },
      feedCard('We shipped the beta', 'Alex', '2h ago', 'Thanks to everyone who tested it.'),
      feedCard('Notes from the retro', 'Sam', 'Just now', 'Shorter standups, more demos.', true)
    )
  );

/** Three weeks of October 2026, Sun Oct 4 to Sat Oct 24; today is Tue Oct 20. */
const calendarDays = (): HTMLElement[] => Array.from({ length: 21 }, (_, index) => {
  const day = index + 4;
  const attrs: Record<string, string> = { 'data-day': '' };

  if (index % 7 === 0 || index % 7 === 6) attrs['data-weekend'] = '';
  if (day === 20) attrs['data-today'] = '';
  const events: HTMLElement[] = [];

  if (day === 8) events.push(h('span', { 'data-event': '' }, h('span', { 'data-event-title': '' }, 'Kickoff'), pill('Work', 'green')));
  if (day === 20) events.push(h('span', { 'data-event': '', 'data-new': '' }, h('span', { 'data-event-title': '' }, 'Demo day'), pill('Team', 'purple')));

  return h('div', attrs, h('span', { 'data-day-number': '' }, String(day)), ...events);
});

/** Calendar view entry: the month grid; each event shows its title and Tags; a new event lands on today. */
export const renderCalendarViewPreview = (): HTMLElement =>
  createPreview(
    'database',
    h('div', { 'data-tabs': '' }, tab(IconCalendar, 'Calendar view', true)),
    h('div', { 'data-calendar-head': '' }, h('span', { 'data-month': '' }, 'October 2026'), h('span', { 'data-muted': '' }, 'Today')),
    h(
      'div',
      { 'data-calendar': '' },
      ...['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name) => h('span', { 'data-weekday': '' }, name)),
      ...calendarDays()
    )
  );

/** Timeline view entry: the three sample cards, each five days, two days apart, with today's line. */
export const renderTimelineViewPreview = (): HTMLElement =>
  createPreview(
    'database',
    h('div', { 'data-tabs': '' }, tab(IconTimeline, 'Timeline view', true)),
    h(
      'div',
      { 'data-timeline': '' },
      h('div', { 'data-timeline-head': '' }, ...[15, 16, 17, 18, 19, 20, 21, 22, 23].map((day) =>
        h('span', day === 20 ? { 'data-timeline-day': '', 'data-today': '' } : { 'data-timeline-day': '' }, String(day)))),
      h('span', { 'data-today-line': '' }),
      h('span', { 'data-bar': '1' }, 'Card 1'),
      h('span', { 'data-bar': '2' }, 'Card 2'),
      h('span', { 'data-bar': '3', 'data-new': '' }, 'Card 3')
    )
  );

const formOption = (label: string): HTMLElement =>
  h('span', { 'data-form-option': '' }, h('span', { 'data-form-check': '' }), label);

/** Form entry: the Form builder tab with its two questions; Responses is the second tab. */
export const renderFormPreview = (): HTMLElement =>
  createPreview(
    'database',
    h('div', { 'data-tabs': '' }, tab(IconListChecklist, 'Form builder', true), tab(IconTable, 'Responses')),
    h(
      'div',
      { 'data-form': '' },
      h('div', { 'data-form-question': '' }, h('span', { 'data-form-label': '' }, 'Question 1'), h('span', { 'data-form-answer': '' })),
      h(
        'div',
        { 'data-form-question': '' },
        h('span', { 'data-form-label': '' }, 'Question 2'),
        h('span', { 'data-muted': '' }, '(Respondents can select up to 1)'),
        h('div', { 'data-form-options': '' }, formOption('Option 1'), formOption('Option 2'), formOption('Option 3'))
      )
    )
  );
