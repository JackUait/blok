import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { MarksAPI } from '../../../../../src/components/modules/api/marks';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { MarkSpec } from '../../../../../types/api/marks';

const colorSpec: MarkSpec<string> = {
  tag: 'mark',
  style: { color: (value: string): string => value },
};

const createMarksApi = (): MarksAPI => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const moduleConfig: ModuleConfig = {
    config: {},
    eventsDispatcher,
  };

  return new MarksAPI(moduleConfig);
};

describe('MarksAPI', () => {
  let marksApi: MarksAPI;
  let container: HTMLDivElement;

  const selectContentsOf = (node: Node): Range => {
    const range = document.createRange();

    range.selectNodeContents(node);

    const selection = window.getSelection();

    if (!selection) {
      throw new Error('jsdom returned no selection');
    }

    selection.removeAllRanges();
    selection.addRange(range);

    return range;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    marksApi = createMarksApi();
    container = document.createElement('div');
    container.contentEditable = 'true';
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  it('exposes the full public surface', () => {
    const methods = marksApi.methods;

    expect(typeof methods.has).toBe('function');
    expect(typeof methods.find).toBe('function');
    expect(typeof methods.read).toBe('function');
    expect(typeof methods.apply).toBe('function');
    expect(typeof methods.remove).toBe('function');
    expect(typeof methods.toggle).toBe('function');
  });

  it('defaults to the live selection when no range is passed', () => {
    container.textContent = 'live selection';
    selectContentsOf(container);

    expect(marksApi.methods.has(colorSpec)).toBe(false);

    marksApi.methods.apply(colorSpec, 'red');

    const mark = container.querySelector('mark');

    expect(mark?.style.getPropertyValue('color')).toBe('red');
    expect(marksApi.methods.has(colorSpec)).toBe(true);

    expect(marksApi.methods.toggle(colorSpec, 'red')).toBe(false);
    expect(container.querySelector('mark')).toBeNull();
  });

  it('operates on an explicit range when one is passed', () => {
    container.textContent = 'explicit';

    const range = document.createRange();

    range.selectNodeContents(container);

    expect(marksApi.methods.has(colorSpec, range)).toBe(false);

    marksApi.methods.apply(colorSpec, 'blue', range);

    expect(container.querySelector('mark')?.style.getPropertyValue('color')).toBe('blue');
  });

  it('is a safe no-op without any selection', () => {
    window.getSelection()?.removeAllRanges();

    expect(marksApi.methods.has(colorSpec)).toBe(false);
    expect(marksApi.methods.find(colorSpec)).toBeNull();
    expect(marksApi.methods.read(colorSpec)).toBeNull();
    expect(marksApi.methods.apply(colorSpec, 'red')).toEqual([]);
    expect(marksApi.methods.remove(colorSpec)).toEqual([]);
    expect(marksApi.methods.toggle(colorSpec, 'red')).toBe(false);
  });

  it('finds and reads from the live selection', () => {
    container.innerHTML = '<mark style="color: red">tinted</mark>';

    const mark = container.querySelector('mark');

    if (!mark) {
      throw new Error('fixture missing mark');
    }

    selectContentsOf(mark);

    expect(marksApi.methods.find(colorSpec)).toBe(mark);
    expect(marksApi.methods.read(colorSpec)?.style).toEqual({ color: 'red' });
  });
});
