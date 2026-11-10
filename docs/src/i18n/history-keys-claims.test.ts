import { describe, expect, it } from 'vitest';
import en from './en.json';
import ru from './ru.json';

// On macOS Blok undoes with Cmd+Z and redoes with Cmd+Shift+Z; the Ctrl chords do nothing there.
describe('demo undo and redo titles name the macOS keys too', () => {
  for (const [locale, catalog] of [['en', en], ['ru', ru]] as const) {
    it(`${locale}.json`, () => {
      expect(catalog.demo.undoTitle).toContain('⌘Z');
      expect(catalog.demo.redoTitle).toContain('⌘⇧Z');
    });
  }
});
