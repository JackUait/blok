import { describe, it, expect } from 'vitest';

import { getListPasteConfig } from '../../../../src/tools/list/static-configs';

describe('list paste config mutants', () => {
  // Every attribute the paste handler reads has to be whitelisted here, or the
  // sanitizer strips it before the handler ever sees it.
  it('whitelists exactly the tags and attributes the paste handler reads', () => {
    expect(getListPasteConfig()).toStrictEqual({
      tags: [
        { li: { 'style': true, 'aria-level': true, 'data-list-style': true } },
        { input: { type: true, checked: true } },
      ],
    });
  });
});
