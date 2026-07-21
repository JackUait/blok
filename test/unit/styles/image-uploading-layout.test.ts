import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

const ruleBody = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));

  if (match === null) {
    throw new Error(`no rule found for ${selector}`);
  }

  return match[1];
};

describe('image uploading status layout', () => {
  it('lets a localized status shrink without displacing the cancel control', () => {
    const body = ruleBody(
      '.blok-image-uploading__header--status-only .blok-image-uploading__label'
    );

    expect(body).toMatch(/min-width:\s*0\s*;/);
    expect(body).toMatch(/white-space:\s*nowrap\s*;/);
    expect(body).toMatch(/overflow:\s*hidden\s*;/);
    expect(body).toMatch(/text-overflow:\s*ellipsis\s*;/);
  });
});
