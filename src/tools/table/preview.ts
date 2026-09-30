import { createPreview, h } from '../../components/utils/block-preview';

const ROWS: string[][] = [
  ['Planet', 'Moons', 'Rings', 'Day'],
  ['Mars', '2', 'No', '25h'],
  ['Jupiter', '95', 'Faint', '10h'],
  ['Saturn', '146', 'Yes', '11h'],
  ['Uranus', '28', 'Yes', '17h'],
];

/** A table with a heading row; body cells fill in one by one. */
export const renderTablePreview = (): HTMLElement => {
  const width = ROWS[0].length;
  const cells = ROWS.flatMap((row, rowIndex) => row.map((text, colIndex) => (rowIndex === 0
    ? h('div', { 'data-cell': 'heading' }, text)
    : h('div', { 'data-cell': '', style: `--i: ${(rowIndex - 1) * width + colIndex + 1}` }, h('span', {}, text)))));

  return createPreview('table', h('div', { 'data-grid': '' }, ...cells));
};
