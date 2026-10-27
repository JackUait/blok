import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const NOTICE = readFileSync(resolve(__dirname, '../../../../../NOTICE'), 'utf8');

describe('highlighter license', () => {
  // The minifier drops source comments and prismjs is no longer a bundled
  // dependency, so NOTICE is the only place the ported code's MIT notice ships.
  it('carries Prism\'s MIT notice in NOTICE', () => {
    const section = NOTICE.slice(NOTICE.indexOf('src/tools/code/highlight'));

    expect(section).toContain('Prism');
    expect(section).toContain('Copyright (c) 2012 Lea Verou');
    expect(section).toContain('Permission is hereby granted, free of charge');
    expect(section).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  });
});
