/**
 * A focus ring is a keyboard affordance: a mouse click or tap must never paint one.
 *
 * `:focus-visible` alone cannot promise that. Text fields match it on a click,
 * and so does an element that script focuses right after a click (the search
 * dialog's input). So every ring is gated on the `data-modality` attribute that
 * INPUT_MODALITY_SCRIPT writes on <html>, and text fields get no ring at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { INPUT_MODALITY_SCRIPT } from './input-modality';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs.readFileSync(path.join(SRC_ROOT, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);

    if (fs.statSync(file).isDirectory()) return walk(file);

    return file.endsWith('.tsx') && !file.includes('.test.') ? [file] : [];
  });

describe('focus rings are keyboard-only', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-modality');
  });

  it('records the last gesture on <html>', () => {
    new Function(INPUT_MODALITY_SCRIPT)();

    expect(document.documentElement.getAttribute('data-modality')).toBe('keyboard');

    document.dispatchEvent(new Event('pointerdown'));
    expect(document.documentElement.getAttribute('data-modality')).toBe('pointer');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(document.documentElement.getAttribute('data-modality')).toBe('keyboard');
  });

  it('gates every Tailwind focus-visible utility on keyboard modality', () => {
    const variant = CSS.match(/@custom-variant\s+focus-visible\s+\(([^;]+)\);/);

    expect(variant?.[1] ?? '').toContain(':focus-visible');
    expect(variant?.[1] ?? '').toContain(':not([data-modality="pointer"])');
  });

  it("drops the browser's own ring after a pointer gesture", () => {
    expect(CSS).toMatch(/:root\[data-modality="pointer"\] :focus-visible\s*\{\s*outline:\s*none;?\s*\}/);
  });

  it('paints no focus ring on a text field', () => {
    const offenders = walk(SRC_ROOT).flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');

      return [...source.matchAll(/<(input|textarea)\b/g)]
        .map((match) => source.slice(match.index, source.indexOf('/>', match.index)))
        .filter((tag) => /(focus-visible|focus):(ring|shadow|outline-(?!none|hidden))/.test(tag))
        .map((tag) => `${path.relative(SRC_ROOT, file)}: ${tag.slice(0, 60)}`);
    });

    expect(offenders).toEqual([]);
  });
});
