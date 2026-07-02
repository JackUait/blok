import { describe, it, expect } from 'vitest';

import { shortcutToAriaKeyshortcuts, shortcutToReadable } from '../../../src/components/utils/key-icon';

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

describe('shortcutToAriaKeyshortcuts', () => {
  it('maps ⌘ to Meta', () => {
    expect(shortcutToAriaKeyshortcuts('⌘C')).toBe('Meta+C');
  });

  it('maps ⌃ to Control', () => {
    expect(shortcutToAriaKeyshortcuts('⌃⌘L')).toBe('Control+Meta+L');
  });

  it('maps ⌥ to Alt and ⇧ to Shift', () => {
    expect(shortcutToAriaKeyshortcuts('⌥⇧P')).toBe('Alt+Shift+P');
  });

  it('maps Ctrl text token to Control', () => {
    expect(shortcutToAriaKeyshortcuts('Ctrl + D')).toBe('Control+D');
  });

  it('maps Win token to Meta', () => {
    expect(shortcutToAriaKeyshortcuts('Ctrl + Win + L')).toBe('Control+Meta+L');
  });

  it('maps Del to Delete and Ins to Insert', () => {
    expect(shortcutToAriaKeyshortcuts('Del')).toBe('Delete');
    expect(shortcutToAriaKeyshortcuts('Ins')).toBe('Insert');
  });

  it('maps arrow glyphs to UI-Events arrow key names', () => {
    expect(shortcutToAriaKeyshortcuts('⌘↑')).toBe('Meta+ArrowUp');
    expect(shortcutToAriaKeyshortcuts('⌘↓')).toBe('Meta+ArrowDown');
    expect(shortcutToAriaKeyshortcuts('⌘←')).toBe('Meta+ArrowLeft');
    expect(shortcutToAriaKeyshortcuts('⌘→')).toBe('Meta+ArrowRight');
  });

  it('maps special key glyphs to UI-Events key names', () => {
    expect(shortcutToAriaKeyshortcuts('⌫')).toBe('Backspace');
    expect(shortcutToAriaKeyshortcuts('⎋')).toBe('Escape');
    expect(shortcutToAriaKeyshortcuts('⇥')).toBe('Tab');
    expect(shortcutToAriaKeyshortcuts('⏎')).toBe('Enter');
  });

  it('uppercases plain letter keys', () => {
    expect(shortcutToAriaKeyshortcuts('⌘b')).toBe('Meta+B');
  });
});
