import { IconCheck } from '../../components/icons';
import { createPreview, h } from '../../components/utils/block-preview';

/**
 * One list row: marker + text. `depth` indents like the real list does.
 * @param marker - bullet or number glyph
 * @param text - row text
 * @param depth - nesting level
 */
const row = (marker: string, text: string, depth = 0): HTMLElement =>
  h(
    'div',
    { 'data-row': '', 'data-depth': String(depth) },
    h('span', { 'data-marker': '' }, marker),
    h('span', { 'data-text': '' }, text)
  );

/**
 * A checkbox drawn like Blok's checklist control.
 * @param checked - draw the tick and fill
 */
const checkbox = (checked: boolean): HTMLElement => {
  const box = h('span', { 'data-checkbox': checked ? 'checked' : 'unchecked' });

  if (checked) {
    const tick = h('span', { 'data-tick': '' });

    tick.innerHTML = IconCheck;
    // pathLength=1 lets the stylesheet draw the tick with one dash.
    tick.querySelector('path')?.setAttribute('pathLength', '1');
    box.append(tick);
  }

  return box;
};

/**
 * One to-do row.
 * @param text - row text
 * @param checked - whether it is done
 */
const todo = (text: string, checked = false): HTMLElement =>
  h(
    'div',
    { 'data-row': '', 'data-checked': String(checked) },
    checkbox(checked),
    h('span', { 'data-text': '' }, text)
  );

/** Bulleted list: a packing list with one nested item. */
export const renderBulletedListPreview = (): HTMLElement =>
  createPreview(
    'bulleted-list',
    row('•', 'Passport and tickets'),
    row('•', 'Sunscreen'),
    row('◦', 'SPF 50, not the sad one', 1),
    row('•', 'A book I will not finish'),
    row('•', 'Snacks for the airport')
  );

/** Numbered list: a recipe with one lettered sub-step. */
export const renderNumberedListPreview = (): HTMLElement =>
  createPreview(
    'numbered-list',
    row('1.', 'Preheat the oven to 220°'),
    row('2.', 'Knead the dough'),
    row('a.', 'Ten minutes by hand', 1),
    row('3.', 'Let it rise for an hour'),
    row('4.', 'Bake until golden')
  );

/** To-do list: the first task gets ticked off. */
export const renderTodoListPreview = (): HTMLElement =>
  createPreview(
    'check-list',
    todo('Book the flights', true),
    todo('Water the plants'),
    todo('Call grandma back'),
    todo('Pack the charger')
  );
