import { describe, expect, it } from 'vitest';
import * as icons from '../../../../src/components/icons';

const dots = (markup: string): number[][] =>
  [...new DOMParser().parseFromString(markup, 'image/svg+xml').querySelectorAll('circle')]
    .map((dot) => ['cx', 'cy', 'r'].map((attr) => Number(dot.getAttribute(attr))));

// Notion's row gutter grip: two columns of three stand-alone dots, kept inside the 3-17 live area.
describe('IconRowGrip', () => {
  it('is two columns of three dots, 5 apart across and 5.5 apart down, radius 1.25', () => {
    const grip = dots(icons.IconRowGrip);

    expect(grip).toHaveLength(6);
    expect(new Set(grip.map(([, , r]) => r))).toEqual(new Set([1.25]));
    expect([...new Set(grip.map(([cx]) => cx))].sort((a, b) => a - b)).toEqual([7.5, 12.5]);
    expect([...new Set(grip.map(([, cy]) => cy))].sort((a, b) => a - b)).toEqual([4.5, 10, 15.5]);
  });

  it('is taller than the editor block handle, which keeps IconMenu', () => {
    const tall = Math.max(...dots(icons.IconRowGrip).map(([, cy]) => cy)) - Math.min(...dots(icons.IconRowGrip).map(([, cy]) => cy));
    const menu = Math.max(...dots(icons.IconMenu).map(([, cy]) => cy)) - Math.min(...dots(icons.IconMenu).map(([, cy]) => cy));

    expect(tall).toBeGreaterThan(menu);
  });
});
