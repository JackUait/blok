import type { Edit, PlannedBlock } from '../../../types/agent';
import type { DocSnapshot, SnapBlock } from './snapshot';

export interface EditStamp {
  actorId: string;
  at: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

// Edit payloads are JSON values, not host objects.
const copyValue = (value: unknown): unknown => {
  if (isArray(value)) {
    return value.map(copyValue);
  }
  if (isRecord(value)) {
    return copyRecord(value);
  }

  return value;
};

const copyRecord = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).map(([key, item]): [string, unknown] => [key, copyValue(item)]));

const stampOn = (block: SnapBlock | undefined, stamp: EditStamp | null): void => {
  if (block !== undefined && stamp !== null) {
    Object.assign(block.rest, { lastEditedAt: stamp.at, lastEditedBy: stamp.actorId });
  }
};

const insertTree = (snap: DocSnapshot, planned: PlannedBlock, parentId: string | null, afterId: string | null, stamp: EditStamp | null): void => {
  const block: SnapBlock = {
    id: planned.id,
    type: planned.type,
    data: copyRecord(planned.data),
    ...(planned.tunes !== undefined && { tunes: copyRecord(planned.tunes) }),
    parent: null,
    content: [],
    rest: {},
  };

  stampOn(block, stamp);
  snap.put(block);
  snap.link(block.id, parentId, afterId);
  planned.children.reduce<string | null>((previous, child) => {
    insertTree(snap, child, planned.id, previous, stamp);

    return child.id;
  }, null);
};

const removeBlock = (snap: DocSnapshot, edit: Extract<Edit, { op: 'remove' }>, stamp: EditStamp | null): void => {
  const block = snap.get(edit.id);

  if (block === undefined) {
    return;
  }
  if (edit.withChildren) {
    snap.subtree(edit.id).reverse().forEach(id => snap.drop(id));

    return;
  }

  const parentId = block.parent;
  const siblings = snap.childrenOf(parentId);
  const index = siblings.indexOf(edit.id);
  const previous = index > 0 ? siblings[index - 1] ?? null : null;

  [...block.content].reduce<string | null>((after, child) => {
    snap.unlink(child);
    snap.link(child, parentId, after);
    stampOn(snap.get(child), stamp);

    return child;
  }, previous);
  snap.drop(edit.id);
};

const setData = (snap: DocSnapshot, edit: Extract<Edit, { op: 'setData' }>, stamp: EditStamp | null): void => {
  const block = snap.get(edit.id);

  if (block === undefined) {
    return;
  }
  for (const [key, value] of Object.entries(edit.patch)) {
    if (value === null) {
      Reflect.deleteProperty(block.data, key);
    } else {
      Object.defineProperty(block.data, key, {
        value: copyValue(value),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  stampOn(block, stamp);
};

const setRichText = (snap: DocSnapshot, edit: Extract<Edit, { op: 'setRichText' }>, stamp: EditStamp | null): void => {
  const block = snap.get(edit.id);

  if (block !== undefined) {
    Object.defineProperty(block.data, edit.field, {
      value: copyValue(edit.value),
      enumerable: true,
      writable: true,
      configurable: true,
    });
    stampOn(block, stamp);
  }
};

const setTunes = (snap: DocSnapshot, edit: Extract<Edit, { op: 'setTunes' }>, stamp: EditStamp | null): void => {
  const block = snap.get(edit.id);

  if (block === undefined) {
    return;
  }
  const tunes: Record<string, unknown> = { ...(block.tunes ?? {}) };

  for (const [name, value] of Object.entries(edit.tunes)) {
    if (value === null) {
      Reflect.deleteProperty(tunes, name);
    } else {
      Object.defineProperty(tunes, name, {
        value: copyValue(value),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  block.tunes = Object.keys(tunes).length > 0 ? tunes : undefined;
  stampOn(block, stamp);
};

const replaceType = (snap: DocSnapshot, edit: Extract<Edit, { op: 'replaceType' }>, stamp: EditStamp | null): void => {
  const block = snap.get(edit.id);

  if (block !== undefined) {
    block.type = edit.type;
    block.data = copyRecord(edit.data);
    stampOn(block, stamp);
  }
};

const setPageField = (snap: DocSnapshot, edit: Extract<Edit, { op: 'setPageField' }>): void => {
  if (edit.key === 'title') {
    Object.assign(snap, { title: typeof edit.value === 'string' && edit.value !== '' ? edit.value : undefined });
  } else if (edit.value !== null && typeof edit.value === 'object') {
    const fields = copyRecord({ ...edit.value });
    const icon: DocSnapshot['icon'] = edit.value.type === 'emoji'
      ? { ...fields, type: edit.value.type, value: edit.value.value }
      : { ...fields, type: edit.value.type, url: edit.value.url };

    Object.assign(snap, { icon });
  } else {
    Object.assign(snap, { icon: undefined });
  }
};

export const applyEdits = (snap: DocSnapshot, edits: readonly Edit[], stamp: EditStamp | null): void => {
  for (const edit of edits) {
    switch (edit.op) {
      case 'insert':
        insertTree(snap, edit.block, edit.parentId, edit.afterId, stamp);
        break;
      case 'remove':
        removeBlock(snap, edit, stamp);
        break;
      case 'move':
        snap.unlink(edit.id);
        snap.link(edit.id, edit.parentId, edit.afterId);
        stampOn(snap.get(edit.id), stamp);
        break;
      case 'setData':
        setData(snap, edit, stamp);
        break;
      case 'setRichText':
        setRichText(snap, edit, stamp);
        break;
      case 'setTunes':
        setTunes(snap, edit, stamp);
        break;
      case 'replaceType':
        replaceType(snap, edit, stamp);
        break;
      case 'setPageField':
        setPageField(snap, edit);
        break;
    }
  }
};
