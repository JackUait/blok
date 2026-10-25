import { describe, expect, it } from 'vitest';

import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../src/shared/tool-descriptions';
import { BUILT_IN_BLOCK_SANITIZE } from '../../../src/shared/tool-descriptions/sanitize/blocks';

/** Fields a sanitize config keeps that the tool never saves. Each needs a reason. */
const NEVER_SAVED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  page: { cache: 'Legacy input from pre-release builds: the page tool ignores it on load and never saves it (src/tools/page/types.ts).' },
};

/**
 * ARCHITECTURE LAW — a field a built-in tool saves is a field the agent may write.
 *
 * A tool's sanitize config names the data fields it keeps. A field missing from its agent
 * schema (additionalProperties: false) makes every write that re-validates the whole data
 * fail: the toggle's block colour broke insert, update, block.duplicate and
 * table.duplicateRows for any subtree that held a coloured toggle.
 */
describe('agent schema covers saved fields law', () => {
  it.each(Object.keys(BUILT_IN_BLOCK_SANITIZE))('"%s" schema lists every field its sanitize config keeps', (name) => {
    const describe = BUILT_IN_BLOCK_DESCRIPTIONS[name];

    expect(describe, `${name} has no agent description`).toBeDefined();

    const schema = describe?.().data;
    const properties = typeof schema?.properties === 'object' && schema.properties !== null ? schema.properties : {};
    const kept = Object.keys(BUILT_IN_BLOCK_SANITIZE[name]()).filter((field) => NEVER_SAVED[name]?.[field] === undefined);

    expect(kept.filter((field) => !Object.hasOwn(properties, field))).toEqual([]);
  });
});
