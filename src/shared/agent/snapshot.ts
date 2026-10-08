import { failure } from './errors';

import type { OutputBlockData, OutputData } from '../../../types/data-formats/output-data';
import type { PageIcon } from '../../../types/tools/page';

export interface SnapBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
  parent: string | null;
  content: string[];
  rest: Record<string, unknown>;
}

const BLOCK_KEYS = new Set(['id', 'type', 'data', 'tunes', 'parent', 'content']);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

// Snapshot payloads are JSON values, not host objects.
const copyValue = (value: unknown): unknown => {
  if (isArray(value)) {
    return value.map(copyValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]): [string, unknown] => [key, copyValue(item)]));
  }

  return value;
};

const copyRecord = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).map(([key, item]): [string, unknown] => [key, copyValue(item)]));

const copyIcon = (icon: PageIcon): PageIcon => {
  const fields = copyRecord({ ...icon });

  return icon.type === 'emoji'
    ? { ...fields, type: icon.type, value: icon.value }
    : { ...fields, type: icon.type, url: icon.url };
};

const cellPosition = (rows: unknown, member: string): { row: number; col: number } | null => {
  const grid = isArray(rows) ? rows : [];

  for (const [rowIndex, row] of grid.entries()) {
    if (!isArray(row)) {
      continue;
    }
    const col = row.findIndex(cell => isRecord(cell) && isArray(cell.blocks) && cell.blocks.includes(member));

    if (col >= 0) {
      return { row: rowIndex, col };
    }
  }

  return null;
};

export class DocSnapshot {
  public title?: string;
  public icon?: PageIcon;

  private constructor(
    private readonly blocks: Map<string, SnapBlock>,
    private readonly root: string[],
    private readonly head: Record<string, unknown>
  ) {}

  public static fromOutput(doc: OutputData): DocSnapshot {
    const blocks = new Map<string, SnapBlock>();
    const records: Array<{ block: SnapBlock; order: readonly string[] }> = [];

    for (const [index, raw] of doc.blocks.entries()) {
      const id = raw.id;

      if (typeof id !== 'string' || id === '') {
        throw failure('INVALID_ARGS', 'Every snapshot block needs a non-empty ID.', { path: `/blocks/${index}/id` });
      }
      if (blocks.has(id)) {
        throw failure('INVALID_ARGS', `Block ID "${id}" is repeated.`, { path: `/blocks/${index}/id` });
      }

      const fields: Record<string, unknown> = { ...raw };
      const rest = Object.fromEntries(Object.entries(fields).filter(([key]) => !BLOCK_KEYS.has(key)));
      const block: SnapBlock = {
        id,
        type: raw.type,
        data: copyRecord(raw.data),
        ...(raw.tunes !== undefined && { tunes: copyRecord(raw.tunes) }),
        parent: typeof raw.parent === 'string' && raw.parent !== id ? raw.parent : null,
        content: [],
        rest: copyRecord(rest),
      };

      blocks.set(id, block);
      records.push({ block, order: raw.content ?? [] });
    }

    for (const { block } of records) {
      if (block.parent !== null && !blocks.has(block.parent)) {
        block.parent = null;
      }
    }

    const checked = new Set<string>();

    records.forEach(({ block }) => {
      const chain = new Set<string>();
      const cursor: { id: string | null } = { id: block.id };

      while (cursor.id !== null && !checked.has(cursor.id)) {
        if (chain.has(cursor.id)) {
          const index = doc.blocks.findIndex(raw => raw.id === cursor.id);

          throw failure('INVALID_ARGS', `Parent cycle includes block "${cursor.id}".`, { path: `/blocks/${index}/parent` });
        }
        chain.add(cursor.id);
        cursor.id = blocks.get(cursor.id)?.parent ?? null;
      }
      chain.forEach(id => checked.add(id));
    });

    records.forEach(({ block, order }) => {
      for (const childId of order) {
        if (blocks.get(childId)?.parent === block.id && !block.content.includes(childId)) {
          block.content.push(childId);
        }
      }
    });

    const root: string[] = [];

    for (const { block } of records) {
      if (block.parent === null) {
        root.push(block.id);
        continue;
      }
      const parent = blocks.get(block.parent);

      if (parent !== undefined && !parent.content.includes(block.id)) {
        parent.content.push(block.id);
      }
    }

    const head: Record<string, unknown> = { ...doc };

    delete head.blocks;
    delete head.title;
    delete head.icon;

    const snapshot = new DocSnapshot(blocks, root, copyRecord(head));

    if (doc.title !== undefined && doc.title !== '') {
      snapshot.title = doc.title;
    }
    if (doc.icon !== undefined) {
      snapshot.icon = copyIcon(doc.icon);
    }

    return snapshot;
  }

  public toOutput(): OutputData {
    const blocks = this.readingOrder(null).map(({ id }): OutputBlockData => {
      const block = this.blocks.get(id);

      if (block === undefined) {
        throw failure('INVALID_ARGS', `Block "${id}" disappeared from the snapshot.`, { path: '/blocks' });
      }

      return {
        ...copyRecord(block.rest),
        id: block.id,
        type: block.type,
        data: copyRecord(block.data),
        ...(block.tunes !== undefined && { tunes: copyRecord(block.tunes) }),
        ...(block.parent !== null && { parent: block.parent }),
        ...(block.content.length > 0 && { content: [...block.content] }),
      };
    });

    return {
      ...copyRecord(this.head),
      ...(this.title !== undefined && { title: this.title }),
      ...(this.icon !== undefined && { icon: copyIcon(this.icon) }),
      blocks,
    };
  }

  public clone(): DocSnapshot {
    const blocks = new Map<string, SnapBlock>();

    for (const [id, block] of this.blocks) {
      blocks.set(id, {
        ...block,
        data: copyRecord(block.data),
        ...(block.tunes !== undefined && { tunes: copyRecord(block.tunes) }),
        content: [...block.content],
        rest: copyRecord(block.rest),
      });
    }

    const snapshot = new DocSnapshot(blocks, [...this.root], copyRecord(this.head));

    snapshot.title = this.title;
    snapshot.icon = this.icon === undefined ? undefined : copyIcon(this.icon);

    return snapshot;
  }

  public has(id: string): boolean {
    return this.blocks.has(id);
  }

  public get(id: string): SnapBlock | undefined {
    return this.blocks.get(id);
  }

  public ids(): string[] {
    return [...this.blocks.keys()];
  }

  public childrenOf(parentId: string | null): readonly string[] {
    return parentId === null ? this.root : this.blocks.get(parentId)?.content ?? [];
  }

  public parentOf(id: string): string | null {
    return this.blocks.get(id)?.parent ?? null;
  }

  public isUnder(id: string, ancestorId: string): boolean {
    const seen = new Set<string>([id]);
    const cursor: { id: string | null } = { id: this.parentOf(id) };

    while (cursor.id !== null && !seen.has(cursor.id)) {
      if (cursor.id === ancestorId) {
        return true;
      }
      seen.add(cursor.id);
      cursor.id = this.parentOf(cursor.id);
    }

    return false;
  }

  public subtree(id: string): string[] {
    return [id, ...this.readingOrder(id).map(block => block.id)];
  }

  public readingOrder(rootId: string | null): Array<{ id: string; depth: number }> {
    const result: Array<{ id: string; depth: number }> = [];
    const stack = this.childrenOf(rootId).map(id => ({ id, depth: 0 })).reverse();
    const seen = new Set<string>();

    while (stack.length > 0) {
      const block = stack.pop();

      if (block === undefined || seen.has(block.id) || !this.blocks.has(block.id)) {
        continue;
      }
      seen.add(block.id);
      result.push(block);
      stack.push(...this.childrenOf(block.id).map(id => ({ id, depth: block.depth + 1 })).reverse());
    }

    return result;
  }

  public cellOf(id: string): { tableId: string; row: number; col: number } | null {
    const seen = new Set<string>();
    const cursor: { id: string | null } = { id };

    while (cursor.id !== null && !seen.has(cursor.id)) {
      const member = cursor.id;

      seen.add(member);
      const parentId = this.parentOf(member);
      const parent = parentId === null ? undefined : this.blocks.get(parentId);
      const cell = cellPosition(parent?.data.content, member);

      if (parent !== undefined && cell !== null) {
        return { tableId: parent.id, ...cell };
      }
      cursor.id = parentId;
    }

    return null;
  }

  public put(block: SnapBlock): void {
    this.blocks.set(block.id, block);
  }

  public drop(id: string): void {
    this.unlink(id);
    this.blocks.delete(id);
  }

  public link(id: string, parentId: string | null, afterId: string | null): void {
    const block = this.blocks.get(id);
    const order = parentId === null ? this.root : this.blocks.get(parentId)?.content;

    if (block === undefined || order === undefined) {
      return;
    }
    order.splice(afterId === null ? 0 : order.indexOf(afterId) + 1, 0, id);
    block.parent = parentId;
  }

  public unlink(id: string): void {
    const block = this.blocks.get(id);

    if (block === undefined) {
      return;
    }
    const order = block.parent === null ? this.root : this.blocks.get(block.parent)?.content;
    const index = order?.indexOf(id) ?? -1;

    if (order !== undefined && index >= 0) {
      order.splice(index, 1);
    }
    block.parent = null;
  }
}
