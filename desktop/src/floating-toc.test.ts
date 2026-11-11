import { describe, expect, it } from 'vitest';
import { closestTocHeading, collectFloatingHeadings } from './floating-toc';

describe('floating table of contents', () => {
  it('chooses the heading whose centre is nearest the upper quarter', () => {
    const headings = [
      { id: 'first', top: 80, height: 30 },
      { id: 'second', top: 210, height: 30 },
      { id: 'third', top: 430, height: 30 },
    ];
    expect(closestTocHeading(headings, 200)).toBe('second');
    expect(closestTocHeading(headings, 380)).toBe('third');
    expect(closestTocHeading([], 200)).toBeNull();
  });

  it('omits a heading inside a folded parent and restores it when expanded', () => {
    const redactor = document.createElement('div');
    const parent = document.createElement('div');
    const holder = document.createElement('div');
    const heading = document.createElement('h2');
    holder.setAttribute('data-blok-element', '');
    holder.setAttribute('data-blok-id', 'nested-heading');
    heading.setAttribute('data-blok-tool', 'header');
    heading.setAttribute('data-blok-heading-level', '2');
    heading.textContent = 'Nested heading';
    heading.getClientRects = () => ({ length: 1 }) as DOMRectList;
    holder.append(heading);
    parent.append(holder);
    redactor.append(parent);

    parent.classList.add('hidden');
    expect(collectFloatingHeadings(redactor)).toEqual([]);
    parent.classList.remove('hidden');
    expect(collectFloatingHeadings(redactor).map(({ id, text, level }) => ({ id, text, level })))
      .toEqual([{ id: 'nested-heading', text: 'Nested heading', level: 2 }]);
  });
});
