import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf-8');

/** Every declaration of the rules whose selector matches `selector` exactly. */
const declarationsOf = (selector: string): string[] => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
    .flatMap((match) => match[1].split(';').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('/*')));
};

describe('view settings layout tile, chosen (no-blue law)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('paints the chosen tile only with the neutral selected tokens', () => {
    const declarations = declarationsOf('[data-blok-database-layout-tile][aria-checked="true"]');

    expect(declarations).toEqual([
      'background-color: var(--blok-icon-active-bg)',
      'color: var(--blok-icon-active-text)',
    ]);
  });
});
