import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { historyKeyOf } from '../../../../src/components/utils/history-keys';
import type * as BrowserModule from '../../../../src/components/utils/browser';

const platform = vi.hoisted(() => ({ mac: false }));

vi.mock('../../../../src/components/utils/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof BrowserModule>();

  return {
    ...actual,
    getUserOS: () => ({ win: !platform.mac, mac: platform.mac, x11: false, linux: false }),
  };
});

const os = (mac: boolean): void => {
  platform.mac = mac;
};

const key = (letter: string, init: KeyboardEventInit = {}): KeyboardEvent =>
  new KeyboardEvent('keydown', { key: letter, ...init });

describe('historyKeyOf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('on macOS (Notion keys)', () => {
    beforeEach(() => {
      os(true);
    });

    it.each([
      ['Cmd+Z', key('z', { metaKey: true }), 'undo'],
      ['Cmd+Shift+Z', key('z', { metaKey: true, shiftKey: true }), 'redo'],
      ['Cmd+Y', key('y', { metaKey: true }), 'redo'],
      ['Ctrl+Z', key('z', { ctrlKey: true }), 'blocked'],
      ['Ctrl+Shift+Z', key('z', { ctrlKey: true, shiftKey: true }), 'blocked'],
      ['Ctrl+Cmd+Z', key('z', { ctrlKey: true, metaKey: true }), 'blocked'],
      ['Ctrl+Y', key('y', { ctrlKey: true }), 'blocked'],
      ['Cmd+Shift+Y', key('y', { metaKey: true, shiftKey: true }), null],
      ['Ctrl+Shift+Y', key('y', { ctrlKey: true, shiftKey: true }), null],
      ['plain z', key('z'), null],
    ] as const)('%s → %s', (_name, event, expected) => {
      expect(historyKeyOf(event, event.key)).toBe(expected);
    });
  });

  describe('on Windows and Linux (unchanged)', () => {
    beforeEach(() => {
      os(false);
    });

    it.each([
      ['Ctrl+Z', key('z', { ctrlKey: true }), 'undo'],
      ['Ctrl+Shift+Z', key('z', { ctrlKey: true, shiftKey: true }), 'redo'],
      ['Ctrl+Y', key('y', { ctrlKey: true }), 'redo'],
      ['Meta+Z', key('z', { metaKey: true }), 'undo'],
      ['Meta+Y', key('y', { metaKey: true }), null],
      ['Ctrl+Shift+Y', key('y', { ctrlKey: true, shiftKey: true }), null],
      ['plain y', key('y'), null],
    ] as const)('%s → %s', (_name, event, expected) => {
      expect(historyKeyOf(event, event.key)).toBe(expected);
    });
  });

  it('reads the letter it is given, so a caller can map a non-Latin key', () => {
    os(true);

    expect(historyKeyOf(key('н', { metaKey: true }), 'Y')).toBe('redo');
  });
});
