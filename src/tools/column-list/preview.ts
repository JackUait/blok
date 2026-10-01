import { createPreview, h } from '../../components/utils/block-preview';

const PAGES: Record<number, { title: string; columns: string[] }> = {
  2: { title: 'Move to Lisbon?', columns: ['Pros', 'Cons'] },
  3: { title: 'Roadmap', columns: ['Now', 'Next', 'Later'] },
  4: { title: 'Launch plan', columns: ['Idea', 'Plan', 'Build', 'Ship'] },
  5: { title: 'Weekly plan', columns: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
};

/** Line widths per column, so neighbours never look copy-pasted. */
const WIDTHS = [[92, 70, 84, 52], [78, 96, 58, 80], [88, 64, 90, 46], [70, 90, 76, 60], [96, 60, 82, 70]];

/**
 * A page with `count` columns of content that split apart from one block.
 * @param count - number of columns, 2..5
 */
export const renderColumnsPreview = (count: number): HTMLElement => {
  const page = PAGES[count] ?? { title: '', columns: [] };
  const columns = page.columns.map((title, index) => h(
    'div',
    { 'data-column': '', style: `--i: ${index}` },
    h('span', { 'data-dot': '' }),
    h('div', { 'data-title': '' }, title),
    ...WIDTHS[index].map(width => h('div', { 'data-line': '', style: `width: ${width}%` }))
  ));

  return createPreview(
    `columns-${count}`,
    h('div', { 'data-page-title': '' }, page.title),
    h('div', { 'data-row': '', style: `--n: ${count}` }, ...columns)
  );
};
