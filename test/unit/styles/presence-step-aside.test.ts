// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(path.resolve(__dirname, '../../../src/styles/presence.css'), 'utf8');

/** Moving the face on hover makes it jump between text and toolbar controls. */
describe('presence gutter', () => {
  it('reserves the controls gutter without moving on hover', () => {
    const gutterRules = [...CSS.matchAll(/\[data-blok-presence-gutter\][^{]*\{([^}]*)\}/g)]
      .map((match) => match[1] ?? '');

    expect(gutterRules.length).toBeGreaterThan(0);
    expect(gutterRules.join('\n')).toContain('inset-inline-end: 100%');
    expect(gutterRules.join('\n')).toContain('margin-inline-end: calc(var(--blok-presence-gap) + var(--blok-editor-gutter-start, 0px))');
    gutterRules.forEach((rule) => expect(rule).not.toContain('transform'));
    gutterRules.forEach((rule) => expect(rule).not.toContain('transition'));
  });
});
