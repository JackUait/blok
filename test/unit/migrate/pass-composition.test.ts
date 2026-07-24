import { describe, it, expect } from 'vitest';
import { migrate, migrateLegacyBlocks, migrateBlocks } from '../../../src/migrate';

const ids = (): (() => string) => {
  let n = 0;

  return () => `g-${n++}`;
};

describe('composition semantics', () => {
  it('data rules feed the grammar its INPUT (repairing a legacy field works)', () => {
    const doc = {
      time: 1,
      version: '1.0.0',
      // A host whose export wrote the url under `href` instead of `link`, so the
      // built-in linkTool rule cannot detect it as-is.
      blocks: [{ id: 'lt', type: 'linkTool', data: { href: 'https://example.com', meta: { title: 'T' } } }],
    };

    const { data } = migrate(doc, {
      migrations: {
        linkTool: (d) => ({ ...d, link: (d as { href?: string }).href }),
      },
      generateId: ids(),
    });

    expect(data.blocks[0].type).toBe('bookmark');
    expect(data.blocks[0].data.url).toBe('https://example.com');
  });

  it('grammar-first: the same rule never fires, and the block stays unmigrated', () => {
    const doc = {
      blocks: [{ id: 'lt', type: 'linkTool', data: { href: 'https://example.com', meta: { title: 'T' } } }],
    };

    const expanded = migrateLegacyBlocks(doc.blocks, { generateId: ids() });
    const late = migrateBlocks(expanded, {
      linkTool: (d) => ({ ...d, link: (d as { href?: string }).href }),
    });

    // The grammar never recognized it (no `link`), so it passed through as a
    // linkTool — and by the time the data rule could repair it, the pass is over.
    expect(late[0].type).toBe('linkTool');
    expect(late[0].data.url).toBeUndefined();
  });

  it('the grammar owns the OUTPUT data for types it rewrites', () => {
    const doc = {
      time: 1,
      version: '1.0.0',
      blocks: [{ id: 'lt', type: 'linkTool', data: { link: 'https://example.com', meta: { title: 'T' } } }],
    };

    const { data } = migrate(doc, {
      migrations: { linkTool: (d) => ({ ...d, custom: 'kept?' }) },
      generateId: ids(),
    });

    // Fields the target shape has no slot for do not survive — the expander
    // builds the bookmark data, it does not merge into it.
    expect(data.blocks[0].data.custom).toBeUndefined();
    expect(data.blocks[0].data.title).toBe('T');
  });
});
