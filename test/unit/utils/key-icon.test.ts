import { describe, it, expect } from 'vitest';

import { shortcutToReadable } from '../../../src/components/utils/key-icon';

describe('shortcutToReadable', () => {
  it('expands ⌘ to Command', () => {
    expect(shortcutToReadable('⌘')).toBe('Command');
  });

  it('expands ⇧ to Shift', () => {
    expect(shortcutToReadable('⇧')).toBe('Shift');
  });

  it('expands ⌥ to Option', () => {
    expect(shortcutToReadable('⌥')).toBe('Option');
  });

  it('expands ⌃ to Control', () => {
    expect(shortcutToReadable('⌃')).toBe('Control');
  });

  it('expands ⌫ to Backspace', () => {
    expect(shortcutToReadable('⌫')).toBe('Backspace');
  });

  it('expands ⌦ to Delete', () => {
    expect(shortcutToReadable('⌦')).toBe('Delete');
  });

  it('expands ⎋ to Escape', () => {
    expect(shortcutToReadable('⎋')).toBe('Escape');
  });

  it('expands ⇥ to Tab', () => {
    expect(shortcutToReadable('⇥')).toBe('Tab');
  });

  it('expands ↵ to Return', () => {
    expect(shortcutToReadable('↵')).toBe('Return');
  });

  it('handles concatenated modifiers and letter: ⌃⌘L → Control+Command+L', () => {
    expect(shortcutToReadable('⌃⌘L')).toBe('Control+Command+L');
  });

  it('handles beautified shortcut with + separator: ⌘ + C → Command+C', () => {
    expect(shortcutToReadable('⌘ + C')).toBe('Command+C');
  });

  it('handles multiple modifiers: ⌘⇧P → Command+Shift+P', () => {
    expect(shortcutToReadable('⌘⇧P')).toBe('Command+Shift+P');
  });

  it('uppercases plain letter tokens', () => {
    expect(shortcutToReadable('⌘b')).toBe('Command+B');
  });

  it('passes through plain text like Del unchanged', () => {
    expect(shortcutToReadable('Del')).toBe('Delete');
  });

  it('passes through Ins as Insert', () => {
    expect(shortcutToReadable('Ins')).toBe('Insert');
  });

  it('handles a plain letter alone', () => {
    expect(shortcutToReadable('A')).toBe('A');
  });
});
