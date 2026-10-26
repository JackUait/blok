import type { Edit, PlannedBlock } from '../../../types/agent';
import type { DocSnapshot, SnapBlock } from './snapshot';

export interface EditStamp {
  /** Who `createdBy`/`lastEditedBy` name; '' names no one. See agentAttribution. */
  actorId: string;
  /** The co-author `createdWith`/`lastEditedWith` name, when there is one. */
  with?: string;
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

const isAnonymousAnswer = (block: SnapBlock): boolean =>
  block.type === 'database-row' && block.data.anonymous === true;

// Same rule as DocumentStore.isInAnonymousAnswer, so both appliers save the same metadata.
export const inAnonymousAnswer = (snap: DocSnapshot, block: SnapBlock | undefined, seen = new Set<string>()): boolean => {
  if (block === undefined || seen.has(block.id)) {
    return false;
  }
  seen.add(block.id);

  return isAnonymousAnswer(block) || (block.parent !== null && inAnonymousAnswer(snap, snap.get(block.parent), seen));
};

const SIGNED_KEYS = ['createdBy', 'createdWith', 'lastEditedBy', 'lastEditedWith'] as const;

// A block moved into an anonymous answer drops the ids it was made with, as DocumentStore.applyPlacement does.
const unsignTree = (snap: DocSnapshot, id: string, seen = new Set<string>()): void => {
  const block = seen.has(id) ? undefined : snap.get(id);

  if (block === undefined) {
    return;
  }
  seen.add(id);
  for (const key of SIGNED_KEYS) {
    Reflect.deleteProperty(block.rest, key);
  }
  block.content.forEach((child) => unsignTree(snap, child, seen));
};

const unsignIfAnonymous = (snap: DocSnapshot, id: string): void => {
  if (inAnonymousAnswer(snap, snap.get(id))) {
    unsignTree(snap, id);
  }
};

const stampOn = (snap: DocSnapshot, block: SnapBlock | undefined, stamp: EditStamp | null): void => {
  if (block === undefined || stamp === null) {
    return;
  }
  // An old co-editor never outlives a later edit.
  Reflect.deleteProperty(block.rest, 'lastEditedWith');
  if (inAnonymousAnswer(snap, block)) {
    Reflect.deleteProperty(block.rest, 'lastEditedBy');
    Object.assign(block.rest, { lastEditedAt: stamp.at });

    return;
  }
  Object.assign(block.rest, {
    lastEditedAt: stamp.at,
    lastEditedBy: stamp.actorId,
    ...(stamp.with !== undefined && { lastEditedWith: stamp.with }),
  });
};

// Same rule as YjsManager.withCreationStamp: the creating actor, never inside an anonymous answer.
const stampCreation = (snap: DocSnapshot, block: SnapBlock, stamp: EditStamp | null): void => {
  if (stamp === null) {
    return;
  }
  Object.assign(block.rest, {
    createdAt: stamp.at,
    ...(stamp.actorId !== '' && !inAnonymousAnswer(snap, block) && {
      createdBy: stamp.actorId,
      ...(stamp.with !== undefined && { createdWith: stamp.with }),
    }),
  });
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

  snap.put(block);
  snap.link(block.id, parentId, afterId);
  stampCreation(snap, block, stamp);
  stampOn(snap, block, stamp);
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
    stampOn(snap, snap.get(child), stamp);

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
  stampOn(snap, block, stamp);
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
    stampOn(snap, block, stamp);
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
  stampOn(snap, block, stamp);
};

const replaceType = (snap: DocSnapshot, edit: Extract<Edit, { op: 'replaceType' }>, stamp: EditStamp | null): void => {
  const block = snap.get(edit.id);

  if (block !== undefined) {
    block.type = edit.type;
    block.data = copyRecord(edit.data);
    stampOn(snap, block, stamp);
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
        unsignIfAnonymous(snap, edit.id);
        stampOn(snap, snap.get(edit.id), stamp);
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
