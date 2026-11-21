import { describe, it, expect } from 'vitest';
import { joinTouchingMarks } from '../../../../src/components/utils/mark-joins';

const FILL = (color: string, text: string): string => `<mark style="background-color: var(--blok-color-${color}-bg);">${text}</mark>`;

const render = (html: string): HTMLElement => {
  const root = document.createElement('div');

  root.innerHTML = html;
  joinTouchingMarks(root);

  return root;
};

const joins = (root: HTMLElement): Array<string | null> => {
  return [...root.querySelectorAll('mark')].map((mark) => mark.getAttribute('data-blok-mark-joined'));
};

describe('joinTouchingMarks', () => {
  it('joins the facing sides of two fills with nothing between them', () => {
    expect(joins(render(`a ${FILL('gray', 'Notion sub-')}${FILL('blue', 'page')}.`))).toEqual(['end', 'start']);
  });

  it('joins both sides of a fill between two fills', () => {
    expect(joins(render(`${FILL('gray', 'a')}${FILL('blue', 'b')}${FILL('red', 'c')}`))).toEqual(['end', 'start end', 'start']);
  });

  it('leaves fills with text between them apart, even one space', () => {
    expect(joins(render(`${FILL('gray', 'single')} ${FILL('blue', 'words')}`))).toEqual([null, null]);
  });

  it('leaves a fill next to a mark that only colors the text apart', () => {
    const textOnly = '<mark style="color: var(--blok-color-red-text); background-color: transparent;">red</mark>';

    expect(joins(render(`${FILL('gray', 'a')}${textOnly}`))).toEqual([null, null]);
  });

  it('sees a fill through bold and other inline wrappers', () => {
    expect(joins(render(`<b>${FILL('gray', 'a')}</b><i><u>${FILL('blue', 'b')}</u></i>`))).toEqual(['end', 'start']);
  });

  it('does not join across a line break or another block', () => {
    expect(joins(render(`${FILL('gray', 'a')}<br>${FILL('blue', 'b')}`))).toEqual([null, null]);
    expect(joins(render(`<div>${FILL('gray', 'a')}</div><div>${FILL('blue', 'b')}</div>`))).toEqual([null, null]);
  });

  it('takes the join away when text comes between the fills', () => {
    const root = render(`${FILL('gray', 'a')}${FILL('blue', 'b')}`);

    root.querySelector('mark')?.after(' ');
    joinTouchingMarks(root);

    expect(joins(root)).toEqual([null, null]);
  });

  it('writes nothing when the joins are already right', () => {
    const root = render(`${FILL('gray', 'a')}${FILL('blue', 'b')} ${FILL('red', 'c')}`);
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));

    observer.observe(root, { attributes: true, subtree: true });
    joinTouchingMarks(root);
    records.push(...observer.takeRecords());
    observer.disconnect();

    expect(records).toHaveLength(0);
  });
});
