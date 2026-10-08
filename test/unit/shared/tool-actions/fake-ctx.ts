import type { BlockPosition, ToolActionContext } from '../../../../types';
import type { InsertSpec, RichTextHelpers } from '../../../../types/agent';

export interface FakeBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  parentId: string | null;
  children: string[];
}

export type FakeDoc = Map<string, FakeBlock>;
export type FakeEdit =
  | { op: 'insert'; id: string; type: string; parentId: string | null }
  | { op: 'update'; id: string; patch: Record<string, unknown> }
  | { op: 'setRichText'; id: string; field: string }
  | { op: 'move'; id: string; parentId: string | null }
  | { op: 'remove'; id: string; withChildren: boolean };
export type FakeCtx = ToolActionContext & { edits: FakeEdit[]; doc: FakeDoc };

export class FakeFailure extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export const docOf = (blocks: Array<{ id: string; type: string; data: Record<string, unknown>; parentId?: string }>): FakeDoc => {
  const doc: FakeDoc = new Map(blocks.map(block => [block.id, { ...block, parentId: block.parentId ?? null, children: [] }]));

  for (const block of blocks) {
    if (block.parentId !== undefined) {
      doc.get(block.parentId)?.children.push(block.id);
    }
  }

  return doc;
};

const unsupportedRichText = (): never => {
  throw new Error('Fake context does not support rich-text helpers');
};

const richText: RichTextHelpers = {
  plainText: unsupportedRichText,
  length: unsupportedRichText,
  resolve: unsupportedRichText,
  slice: unsupportedRichText,
  insert: unsupportedRichText,
  remove: unsupportedRichText,
  format: unsupportedRichText,
  canonicalize: unsupportedRichText,
};

const idsByDoc = new WeakMap<FakeDoc, { counter: number; used: Set<string> }>();

const place = (list: string[], id: string, position?: BlockPosition): void => {
  if (position === 'start') {
    list.unshift(id);
  } else if (typeof position === 'object' && 'before' in position) {
    list.splice(Math.max(0, list.indexOf(position.before)), 0, id);
  } else if (typeof position === 'object' && 'after' in position) {
    list.splice(list.indexOf(position.after) + 1, 0, id);
  } else {
    list.push(id);
  }
};

export const createFakeCtx = (doc: FakeDoc, blockId?: string, tool?: string): FakeCtx => {
  const edits: FakeEdit[] = [];
  const ids = idsByDoc.get(doc) ?? { counter: 0, used: new Set(doc.keys()) };

  idsByDoc.set(doc, ids);
  const newId = (): string => {
    let id: string;

    do {
      ids.counter += 1;
      id = `n${ids.counter}`;
    } while (ids.used.has(id) || doc.has(id));

    return id;
  };
  const siblings = (parentId: string | null): string[] => parentId === null
    ? [...doc.values()].filter(block => block.parentId === null).map(block => block.id)
    : [...(doc.get(parentId)?.children ?? [])];
  const order = (parentId: string | null, ids: string[]): void => {
    if (parentId !== null) {
      const parent = doc.get(parentId);

      if (parent !== undefined) {
        parent.children = ids;
      }

      return;
    }

    // Root order lives in Map iteration, not a second document model.
    const previous = new Map(doc);

    doc.clear();
    for (const id of ids) {
      const block = previous.get(id);

      if (block !== undefined) {
        doc.set(id, block);
      }
    }
    for (const [id, block] of previous) {
      if (block.parentId !== null) {
        doc.set(id, block);
      }
    }
  };
  const parentFor = (parentId: string | null | undefined, position?: BlockPosition): string | null => {
    if (parentId !== undefined) {
      return parentId;
    }
    if (typeof position === 'object') {
      const refId = 'before' in position ? position.before : position.after;

      return doc.get(refId)?.parentId ?? null;
    }

    return null;
  };

  const insertTree = (input: InsertSpec, parentId: string | null, position?: BlockPosition): string => {
    const id = input.id ?? newId();

    if (ids.used.has(id) || doc.has(id)) {
      throw new FakeFailure('INVALID_ARGS', `Block id "${id}" is already used`);
    }
    ids.used.add(id);
    doc.set(id, { id, type: input.type, data: { ...input.data }, parentId, children: [] });
    const list = siblings(parentId).filter(sibling => sibling !== id);

    place(list, id, position);
    order(parentId, list);
    edits.push({ op: 'insert', id, type: input.type, parentId });
    for (const child of input.children ?? []) {
      insertTree(child, id);
    }

    return id;
  };

  const ctx: FakeCtx = {
    edits,
    doc,
    tool: tool ?? (blockId === undefined ? '' : doc.get(blockId)?.type ?? ''),
    get block() {
      const block = blockId === undefined ? undefined : doc.get(blockId);

      return block === undefined ? undefined : { id: block.id, type: block.type, data: block.data, children: [...block.children] };
    },
    read: id => {
      const block = doc.get(id);

      return block === undefined ? null : { ...block, children: [...block.children] };
    },
    insert: input => insertTree(input, parentFor(input.parentId, input.position), input.position),
    update: (id, patch) => {
      const block = doc.get(id);
      const recorded = Object.fromEntries(Object.entries(patch)
        .map(([key, value]): [string, unknown] => [key, value === undefined ? null : value]));

      if (block !== undefined) {
        block.data = Object.fromEntries(Object.entries({ ...block.data, ...recorded })
          .filter(([key]) => recorded[key] !== null));
      }
      edits.push({ op: 'update', id, patch: recorded });
    },
    setRichText: (id, field, value) => {
      const block = doc.get(id);

      if (block !== undefined) {
        block.data = { ...block.data, [field]: value };
      }
      edits.push({ op: 'setRichText', id, field });
    },
    move: (id, to) => {
      const block = doc.get(id);

      if (block === undefined) {
        return;
      }
      const parentId = parentFor(to.parentId, to.position);

      if (block.parentId !== null) {
        order(block.parentId, siblings(block.parentId).filter(sibling => sibling !== id));
      }
      block.parentId = parentId;
      const list = siblings(parentId).filter(sibling => sibling !== id);

      place(list, id, to.position);
      order(parentId, list);
      edits.push({ op: 'move', id, parentId });
    },
    remove: (id, opts = {}) => {
      const block = doc.get(id);

      if (block === undefined) {
        return;
      }
      if (opts.withChildren === true) {
        for (const child of [...block.children]) {
          ctx.remove(child, { withChildren: true });
        }
      }
      const list = siblings(block.parentId);
      const at = list.indexOf(id);
      const promoted = opts.withChildren === true ? [] : [...block.children];

      for (const childId of promoted) {
        const child = doc.get(childId);

        if (child !== undefined) {
          child.parentId = block.parentId;
        }
      }
      doc.delete(id);
      if (at >= 0) {
        list.splice(at, 1, ...promoted);
      }
      order(block.parentId, list);
      edits.push({ op: 'remove', id, withChildren: opts.withChildren === true });
    },
    newId,
    richText,
    fail: (code, message) => {
      throw new FakeFailure(code, message);
    },
  };

  return ctx;
};
