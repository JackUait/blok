import { cleanPageField } from '../page-title-icon';
import { buildDocumentView, findBlocks } from './document-view';
import { buildPlannedBlock } from './plan-block';
import { PREPARE_PENDING } from './plan-state';
import { DocSnapshot } from './snapshot';

import type { AgentWarning, InsertSpec } from '../../../types/agent';
import type { OutputBlockData } from '../../../types/data-formats/output-data';
import type { PageIcon } from '../../../types/tools/page';
import type { PlanState } from './plan-state';
import type { SnapBlock } from './snapshot';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

const isPageIcon = (value: unknown): value is PageIcon => isRecord(value) && (
  (value.type === 'emoji' && typeof value.value === 'string') ||
  (value.type === 'image' && typeof value.url === 'string')
);

const isOutputBlock = (value: unknown): value is OutputBlockData => isRecord(value) &&
  typeof value.type === 'string' && isRecord(value.data) &&
  (value.id === undefined || typeof value.id === 'string') &&
  (value.tunes === undefined || isRecord(value.tunes)) &&
  (value.parent === undefined || typeof value.parent === 'string') &&
  (value.content === undefined || (isArray(value.content) && value.content.every(id => typeof id === 'string'))) &&
  (value.indent === undefined || typeof value.indent === 'number') &&
  (value.lastEditedAt === undefined || typeof value.lastEditedAt === 'number') &&
  (value.lastEditedBy === undefined || typeof value.lastEditedBy === 'string');

const isAgentWarning = (value: unknown): value is AgentWarning => isRecord(value) &&
  (value.code === 'SANITIZED' || value.code === 'DEMOTED' || value.code === 'LOOKS_LIKE_MARKDOWN' ||
    value.code === 'MARKDOWN_DEGRADED' || value.code === 'UNKNOWN_MARK_DROPPED') &&
  typeof value.message === 'string' &&
  (value.commandIndex === undefined || typeof value.commandIndex === 'number') &&
  (value.blockId === undefined || typeof value.blockId === 'string') &&
  (value.field === undefined || typeof value.field === 'string');

const readWarnings = (state: PlanState, value: unknown): AgentWarning[] => {
  if (!isArray(value) || !value.every(isAgentWarning)) {
    state.fail('INVALID_ARGS', 'Expected valid Markdown warnings.');
  }

  return value;
};

export const planRead = (state: PlanState, args: Record<string, unknown>): unknown => {
  const rootId = args.rootId === undefined || args.rootId === null ? null : state.resolveId(args.rootId, '/rootId');
  const ids: string[] | undefined = (() => {
    if (args.ids === undefined) {
      return undefined;
    }
    if (!isArray(args.ids)) {
      state.fail('INVALID_ARGS', 'Expected an array of block ids.', '/ids');
    }

    return args.ids.map((id, index) => state.resolveId(id, `/ids/${index}`));
  })();
  const { depth, detail, limit, cursor, textLimit } = args;

  if (depth !== undefined && typeof depth !== 'number') {
    state.fail('INVALID_ARGS', 'Expected a numeric depth.', '/depth');
  }
  if (detail !== undefined && detail !== 'outline' && detail !== 'full') {
    state.fail('INVALID_ARGS', 'Expected outline or full detail.', '/detail');
  }
  if (limit !== undefined && typeof limit !== 'number') {
    state.fail('INVALID_ARGS', 'Expected a numeric limit.', '/limit');
  }
  if (cursor !== undefined && typeof cursor !== 'string') {
    state.fail('INVALID_ARGS', 'Expected a cursor string.', '/cursor');
  }
  if (textLimit !== undefined && typeof textLimit !== 'number') {
    state.fail('INVALID_ARGS', 'Expected a numeric text limit.', '/textLimit');
  }

  return buildDocumentView(state.draft, {
    rootId,
    ...(ids !== undefined && { ids }),
    ...(depth !== undefined && { depth }),
    ...(detail !== undefined && { detail }),
    ...(limit !== undefined && { limit }),
    ...(cursor !== undefined && { cursor }),
    ...(textLimit !== undefined && { textLimit }),
  }, state.ctx, '');
};

export const planFind = (state: PlanState, args: Record<string, unknown>): unknown => {
  const rootId = args.rootId === undefined ? undefined : state.resolveId(args.rootId, '/rootId');
  const { text, type, limit } = args;

  if (text !== undefined && typeof text !== 'string') {
    state.fail('INVALID_ARGS', 'Expected search text.', '/text');
  }
  if (type !== undefined && typeof type !== 'string') {
    state.fail('INVALID_ARGS', 'Expected a block type.', '/type');
  }
  if (limit !== undefined && typeof limit !== 'number') {
    state.fail('INVALID_ARGS', 'Expected a numeric limit.', '/limit');
  }

  return findBlocks(state.draft, {
    ...(rootId !== undefined && { rootId }),
    ...(text !== undefined && { text }),
    ...(type !== undefined && { type }),
    ...(limit !== undefined && { limit }),
  }, state.ctx);
};

export const planSetTitle = (state: PlanState, args: Record<string, unknown>): unknown => {
  if (typeof args.title !== 'string') {
    state.fail('INVALID_ARGS', 'Expected a title string.', '/title');
  }
  state.emit({ op: 'setPageField', key: 'title', value: cleanPageField(args.title) });

  return {};
};

export const planSetIcon = (state: PlanState, args: Record<string, unknown>): unknown => {
  const icon = args.icon;

  if (icon !== null && !isPageIcon(icon)) {
    state.fail('INVALID_ARGS', 'Expected a PageIcon or null to clear it.', '/icon');
  }
  state.emit({ op: 'setPageField', key: 'icon', value: icon === null ? null : cleanPageField(icon) });

  return {};
};

export const planMarkdownInsert = (state: PlanState, args: Record<string, unknown>): unknown => {
  const placement = state.place(args.parentId, args.position ?? 'end');
  const prepared = state.ctx.prepared.get(state.index);

  if (prepared === PREPARE_PENDING || prepared === undefined) {
    return { ids: [] };
  }
  if (!isRecord(prepared)) {
    state.fail('INVALID_ARGS', 'Expected prepared Markdown blocks and warnings.');
  }
  const blocks = prepared.blocks;

  if (!isArray(blocks) || !blocks.every(isOutputBlock)) {
    state.fail('INVALID_ARGS', 'Expected valid converted blocks.');
  }
  const warnings = readWarnings(state, prepared.warnings);
  const occupied = new Set<string>();

  for (const block of blocks) {
    if (block.id !== undefined) {
      occupied.add(block.id);
    }
    if (block.parent !== undefined) {
      occupied.add(block.parent);
    }
    block.content?.forEach(id => occupied.add(id));
    if (block.type === 'table' && isArray(block.data.content)) {
      block.data.content.forEach(row => {
        if (!isArray(row)) {
          return;
        }
        row.forEach(cell => {
          if (!isRecord(cell) || !isArray(cell.blocks)) {
            return;
          }
          cell.blocks.forEach(id => {
            if (typeof id === 'string') {
              occupied.add(id);
            }
          });
        });
      });
    }
  }

  const temporary = { next: 0, id: '' };
  const identified = blocks.map((block): OutputBlockData => {
    if (block.id !== undefined && block.id !== '') {
      return block;
    }

    // Temporary IDs must not make stale references resolve to unnamed blocks.
    do {
      temporary.id = `markdown:${temporary.next++}`;
    } while (occupied.has(temporary.id));
    occupied.add(temporary.id);

    return { ...block, id: temporary.id };
  });
  const imported = DocSnapshot.fromOutput({ blocks: identified });
  const getBlock = (id: string): SnapBlock => imported.get(id)
    ?? state.fail('INVALID_ARGS', 'The imported block has no snapshot entry.');
  const ids = new Map<string, string>();
  const reserveIds = (id: string, path: string): void => {
    ids.set(id, state.reserveFreshId(`${path}/id`));
    getBlock(id).content.forEach((child, index) => reserveIds(child, `${path}/children/${index}`));
  };
  const roots = imported.childrenOf(null);

  roots.forEach((id, index) => reserveIds(id, `/markdown/${index}`));

  const toSpec = (id: string): InsertSpec => {
    const block = getBlock(id);
    const data = structuredClone(block.data);

    if (block.type === 'table' && isArray(data.content)) {
      data.content = data.content.map(row => !isArray(row) ? row : row.map(cell => {
        if (!isRecord(cell) || !isArray(cell.blocks)) {
          return cell;
        }

        return { ...cell, blocks: cell.blocks.map(member => typeof member === 'string' ? ids.get(member) ?? member : member) };
      }));
    }

    return {
      type: block.type,
      id: ids.get(id) ?? state.fail('INVALID_ARGS', 'The imported block has no reserved ID.'),
      data,
      ...(block.tunes !== undefined && { tunes: structuredClone(block.tunes) }),
      children: block.content.map(toSpec),
    };
  };

  warnings.forEach(item => state.warnings.push({ ...item, commandIndex: state.index }));

  const inserted = roots.map((id, index) => {
    const previous = roots[index - 1];
    const afterId = previous === undefined ? placement.afterId
      : ids.get(previous) ?? state.fail('INVALID_ARGS', 'The imported block has no reserved ID.');
    const planned = buildPlannedBlock(state, toSpec(id), { id: placement.parentId }, `/markdown/${index}`, false);

    state.emit({ op: 'insert', block: planned, parentId: placement.parentId, afterId });

    return planned.id;
  });

  return { ids: inserted };
};

export const planMarkdownExport = (state: PlanState, args: Record<string, unknown>): unknown => {
  const rootId = args.rootId === undefined ? undefined : state.resolveId(args.rootId, '/rootId');
  const doc = state.draft.toOutput();

  if (rootId !== undefined) {
    const keep = new Set(state.draft.subtree(rootId));

    doc.blocks = doc.blocks.filter(block => block.id !== undefined && keep.has(block.id)).map(block => {
      if (block.id !== rootId) {
        return block;
      }
      const root = { ...block };

      delete root.parent;

      return root;
    });
  }

  const { markdown, warnings } = state.ctx.ports.blocksToMarkdown(doc);

  readWarnings(state, warnings).forEach(item => state.warnings.push({ ...item, commandIndex: state.index }));

  return { markdown };
};
