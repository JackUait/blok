// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { htmlToBlocks } from '../../../src/view';
import { pastedGridDirection, placementFromAlignment } from '../../../src/tools/table/table-cell-clipboard';

/** The placement /view reads from the first cell of the first table in `html`. */
const viewPlacement = (html: string): unknown => {
  const table = htmlToBlocks(html).find(block => block.type === 'table');
  const content = table?.data.content as Array<Array<Record<string, unknown>>> | undefined;

  return content?.[0]?.[0]?.placement;
};

/** The grid direction the editor's table paste reads for the first table in `html`. */
const editorDirection = (html: string): 'ltr' | 'rtl' => {
  const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table');

  if (table === null) {
    throw new Error('no table');
  }

  return pastedGridDirection(table);
};

/*
 * /view cannot import the editor's table clipboard (it is DOM and tool code),
 * so it mirrors these rules. These tests keep the two in step.
 */
describe('htmlToBlocks table placement matches the editor paste', () => {
  it.each([
    ['<table dir="rtl">'],
    ['<table dir="ltr">'],
    ['<div dir="rtl"><table dir="auto">'],
    ['<div dir="rtl"><table>'],
    ['<table dir="ltr" style="direction: rtl">'],
    ['<table dir="rtl" style="direction:ltr">'],
    ['<div style="direction: rtl"><table>'],
    ['<div dir="rtl" style="color: red"><table>'],
    ['<table dir="rtl" style="flex-direction: ltr">'],
    ['<div dir="ltr" style="flex-direction: rtl"><table>'],
    ['<table DIR=" RTL ">'],
  ])('reads the grid direction of %s the same way', (open) => {
    const html = `${open}<tr><td style="text-align: left">a</td></tr></table>`;
    const direction = editorDirection(html);

    expect(viewPlacement(html)).toBe(placementFromAlignment('left', undefined, direction));
  });

  it('ignores a cell\'s own dir in both', () => {
    const html = '<table><tr><td dir="rtl" style="text-align: left">a</td></tr></table>';

    expect(editorDirection(html)).toBe('ltr');
    expect(viewPlacement(html)).toBeUndefined();
  });

  const horizontals = ['left', 'right', 'center', 'start', 'end', 'justify', 'LEFT', '  Center ', 'match-parent'];
  const verticals = ['top', 'middle', 'bottom', 'baseline', 'MIDDLE'];
  const cases = ['ltr', 'rtl'].flatMap(dir => horizontals.flatMap(horizontal => [
    ...verticals.map(vertical => [dir, horizontal, vertical]),
    [dir, horizontal, undefined],
  ]));

  it.each(cases)('maps %s text-align %j vertical-align %j to the same placement', (dir, horizontal, vertical) => {
    const style = [`text-align: ${horizontal}`, ...(vertical === undefined ? [] : [`vertical-align: ${vertical}`])].join('; ');
    const html = `<table dir="${dir}"><tr><td style="${style}">a</td></tr></table>`;

    expect(viewPlacement(html)).toBe(placementFromAlignment(horizontal, vertical, dir === 'rtl' ? 'rtl' : 'ltr'));
  });

  /*
   * Known gap on the editor side: `blocksToHtml` writes the end side as this
   * var, and only /view reads it back. Pasting that HTML into the editor
   * loses right placement.
   */
  it('reads the end-side var blocksToHtml writes, which the editor paste does not', () => {
    const html = '<table><tr><td style="text-align: var(--_blok-end-side, right)">a</td></tr></table>';

    expect(viewPlacement(html)).toBe('top-right');
    expect(placementFromAlignment('var(--_blok-end-side, right)', undefined, 'ltr')).toBeUndefined();
  });
});
