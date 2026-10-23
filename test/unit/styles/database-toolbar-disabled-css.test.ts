/**
 * A disabled toolbar button (⚡ or ✦ on a locked database) must not look
 * clickable: no hover or pressed fill, no pointer.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

describe('disabled database toolbar button', () => {
  it('keeps no fill and a default cursor, after the hover and pressed rules', () => {
    const disabled = database.indexOf('[data-blok-database-view-toolbar] > button:disabled {');
    const body = database.slice(disabled, database.indexOf('}', disabled));

    expect(disabled).toBeGreaterThan(database.indexOf('[data-blok-database-view-toolbar] > button:active {'));
    expect(disabled).toBeGreaterThan(database.indexOf('[data-blok-database-view-toolbar] > button:hover,'));
    expect(body).toContain('background-color: transparent');
    expect(body).toContain('cursor: default');
  });
});
