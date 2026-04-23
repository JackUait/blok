import { describe, it, expect, beforeEach } from 'vitest';
import { migrateMarkColors } from '../../../../src/components/utils/color-migration';

describe('migrateMarkColors', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  it('remaps light-preset hex color to CSS var', () => {
    container.innerHTML = '<mark style="color:#d44c47; background-color:transparent">text</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;
    expect(mark.style.getPropertyValue('color')).toBe('var(--blok-color-red-text)');
  });

  it('remaps dark-preset hex color to CSS var', () => {
    container.innerHTML = '<mark style="color:#df5452; background-color:transparent">text</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;
    expect(mark.style.getPropertyValue('color')).toBe('var(--blok-color-red-text)');
  });

  it('remaps hex background-color to CSS var', () => {
    container.innerHTML = '<mark style="background-color:#fdebec">text</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;
    expect(mark.style.getPropertyValue('background-color')).toBe('var(--blok-color-red-bg)');
  });

  it('leaves transparent background-color unchanged', () => {
    container.innerHTML = '<mark style="color:#d44c47; background-color:transparent">text</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;
    expect(mark.style.getPropertyValue('background-color')).toBe('transparent');
  });

  it('skips already-migrated CSS var values (idempotent)', () => {
    container.innerHTML = '<mark style="color:var(--blok-color-red-text); background-color:transparent">text</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;
    expect(mark.style.getPropertyValue('color')).toBe('var(--blok-color-red-text)');
  });

  it('leaves unparseable hex values unchanged', () => {
    container.innerHTML = '<mark style="color:not-a-color">text</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;
    // unparseable — should remain (or be empty if browser rejected it at parse time)
    const value = mark.style.getPropertyValue('color');
    expect(value === 'not-a-color' || value === '').toBe(true);
  });

  it('remaps both color and background-color independently', () => {
    container.innerHTML = '<mark style="color:#d44c47; background-color:#fdebec">text</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;
    expect(mark.style.getPropertyValue('color')).toBe('var(--blok-color-red-text)');
    expect(mark.style.getPropertyValue('background-color')).toBe('var(--blok-color-red-bg)');
  });

  it('handles multiple marks in container', () => {
    container.innerHTML = [
      '<p><mark style="color:#d44c47; background-color:transparent">red</mark></p>',
      '<p><mark style="color:#337ea9; background-color:transparent">blue</mark></p>',
    ].join('');
    migrateMarkColors(container);
    const marks = container.querySelectorAll<HTMLElement>('mark');
    expect(marks[0].style.getPropertyValue('color')).toBe('var(--blok-color-red-text)');
    expect(marks[1].style.getPropertyValue('color')).toBe('var(--blok-color-blue-text)');
  });

  it('does nothing when container has no marks', () => {
    container.innerHTML = '<p>no marks here</p>';
    expect(() => migrateMarkColors(container)).not.toThrow();
  });

  it('removes background-color when value is the default white page background', () => {
    container.innerHTML = '<mark style="background-color:#ffffff">x</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;

    expect(mark.style.getPropertyValue('background-color')).toBe('');
  });

  it('removes background-color when value is the dark-mode page background', () => {
    container.innerHTML = '<mark style="background-color:rgb(25, 25, 24)">x</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;

    expect(mark.style.getPropertyValue('background-color')).toBe('');
  });

  it('still migrates a genuine yellow highlight background-color (positive control)', () => {
    container.innerHTML = '<mark style="background-color:#fbf3db">x</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;

    expect(mark.style.getPropertyValue('background-color')).toBe('var(--blok-color-yellow-bg)');
  });
});
