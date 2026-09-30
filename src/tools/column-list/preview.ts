import { createPreview, h } from '../../components/utils/block-preview';

const TITLES: Record<number, string[]> = {
  2: ['Pros', 'Cons'],
  3: ['Now', 'Next', 'Later'],
  4: ['Idea', 'Plan', 'Build', 'Ship'],
  5: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
};

/** Line widths per column, so neighbours never look copy-pasted. */
const WIDTHS = [[92, 70, 84, 52], [78, 96, 58, 80], [88, 64, 90, 46], [70, 90, 76, 60], [96, 60, 82, 70]];

/**
 * A page with `count` columns of content that split apart from one block.
 * @param count - number of columns, 2..5
 */
export const renderColumnsPreview = (count: number): HTMLElement => {
  const titles = TITLES[count] ?? [];
  const columns = titles.map((title, index) => h(
    'div',
    { 'data-column': '', style: `--i: ${index}` },
    h('span', { 'data-dot': '' }),
    h('div', { 'data-title': '' }, title),
    ...WIDTHS[index].map(width => h('div', { 'data-line': '', style: `width: ${width}%` }))
  ));

  return createPreview(
    `columns-${count}`,
    h('div', { 'data-page-title': '' }, 'Weekly plan'),
    h('div', { 'data-row': '', style: `--n: ${count}` }, ...columns)
  );
};
