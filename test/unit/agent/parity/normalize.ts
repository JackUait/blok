import { outputBlocksToCanonicalSegments } from '../../../../src/shared/rich-text/block-data';
import { CURRENT_RICH_TEXT_FIELDS } from '../../../../src/shared/rich-text/fields';
import { htmlToSegmentsNode } from '../../../../src/view/rich-text-parse5';
import type { OutputBlockData, OutputData } from '../../../../types';

export interface ParityDocument {
  blocks: OutputData['blocks'];
  title?: OutputData['title'];
  icon?: OutputData['icon'];
}

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !isArray(value);

/** Removes each key whose value equals the default a tool's constructor fills on load. */
const withoutLoadDefaults = (defaults: Record<string, unknown>) =>
  (data: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(data).filter(([key, value]) =>
      !Object.prototype.hasOwnProperty.call(defaults, key) || value !== defaults[key]));

export const TOOL_MINTED: Record<string, {
  reason: string;
  strip(data: Record<string, unknown>): Record<string, unknown>;
}> = {
  table: {
    reason: 'Table cell ids and row ids are random until ToolRuntime.normalize ships (06 C17). The editor also saves stretched false (src/tools/table/table-operations.ts:674) and an initialColWidth measured from layout, which jsdom reports as 0 (src/tools/table/index.ts:867-872).',
    strip: (raw) => {
      const data = withoutLoadDefaults({ stretched: false, initialColWidth: 0 })(raw);
      const content = data.content;

      if (!isArray(content)) {
        return data;
      }

      return {
        ...data,
        content: content.map((row) => isArray(row)
          ? row.map((cell) => isRecord(cell)
            ? Object.fromEntries(Object.entries(cell).filter(([key]) => key !== 'id' && key !== 'rowId'))
            : cell)
          : row),
      };
    },
  },
  code: {
    reason: 'The editor fills lineNumbers true on load and saves it (src/tools/code/index.ts:137, :594); headless appliers keep data as given. Leaves when code ships ToolRuntime.normalize (06 C17).',
    strip: withoutLoadDefaults({ lineNumbers: true }),
  },
  quote: {
    reason: 'The editor fills size "default" on load and saves it (src/tools/quote/index.ts:53, :140); headless appliers keep data as given. Leaves when quote ships ToolRuntime.normalize (06 C17).',
    strip: withoutLoadDefaults({ size: 'default' }),
  },
  callout: {
    reason: 'The editor fills textColor and backgroundColor null on load and saves them (src/tools/callout/index.ts:159-160, :338-339); headless appliers keep data as given. Leaves when callout ships ToolRuntime.normalize (06 C17).',
    strip: withoutLoadDefaults({ textColor: null, backgroundColor: null }),
  },
  list: {
    reason: 'The editor saves checked false on every checklist item that lacks it (src/tools/list/block-operations.ts:100); headless appliers keep data as given.',
    strip: withoutLoadDefaults({ checked: false }),
  },
};

const richFields = (type: string): string[] =>
  Object.prototype.hasOwnProperty.call(CURRENT_RICH_TEXT_FIELDS, type) ? CURRENT_RICH_TEXT_FIELDS[type] : [];

export const normalizeForParity = (doc: OutputData, keepIds: ReadonlySet<string>): ParityDocument => {
  const byId = new Map<string, number>();

  doc.blocks.forEach((block, index) => {
    if (block.id !== undefined) {
      byId.set(block.id, index);
    }
  });

  const ordered: Array<{ block: OutputBlockData; label: string }> = [];
  const visited = new Set<number>();
  const walk = (index: number, label: string): void => {
    const block = doc.blocks[index];

    if (block === undefined || visited.has(index)) {
      return;
    }

    visited.add(index);
    ordered.push({ block, label });

    const listed = (block.content ?? []).flatMap((id) => {
      const child = byId.get(id);

      return child === undefined ? [] : [child];
    });
    const children = listed.length > 0
      ? listed
      : doc.blocks.flatMap((child, childIndex) =>
        block.id !== undefined && child.parent === block.id ? [childIndex] : []);

    children.forEach((child, childIndex) => walk(child, `${label}.${childIndex}`));
  };

  const roots = doc.blocks.flatMap((block, index) =>
    block.parent === undefined || block.parent === null ? [index] : []);

  roots.forEach((block, index) => walk(block, `b${index}`));

  let nextRoot = roots.length;

  for (let index = 0; index < doc.blocks.length; index += 1) {
    if (!visited.has(index)) {
      walk(index, `b${nextRoot}`);
      nextRoot += 1;
    }
  }

  const names = new Map<string, string>();

  ordered.forEach(({ block, label }) => {
    if (block.id !== undefined && !keepIds.has(block.id)) {
      names.set(block.id, label);
    }
  });

  const rename = (value: string): string => names.get(value) ?? value;
  const cleaned = ordered.map(({ block }): OutputBlockData => {
    const minted = Object.prototype.hasOwnProperty.call(TOOL_MINTED, block.type) ? TOOL_MINTED[block.type] : undefined;
    let data = minted === undefined ? block.data : minted.strip(block.data);
    const content = data.content;

    if (block.type === 'table' && isArray(content)) {
      data = {
        ...data,
        content: content.map((row) => isArray(row)
          ? row.map((cell) => isRecord(cell) && isArray(cell.blocks)
            ? { ...cell, blocks: cell.blocks.map((id) => typeof id === 'string' ? rename(id) : id) }
            : cell)
          : row),
      };
    }

    const normalized: OutputBlockData = {
      ...block,
      data,
      ...(block.id !== undefined && { id: rename(block.id) }),
      ...(block.parent !== undefined && { parent: rename(block.parent) }),
      ...(block.content !== undefined && { content: block.content.map(rename) }),
    };

    delete normalized.lastEditedAt;
    delete normalized.createdAt;

    return normalized;
  });

  return {
    blocks: outputBlocksToCanonicalSegments(cleaned, richFields, htmlToSegmentsNode),
    ...(doc.title !== undefined && { title: doc.title }),
    ...(doc.icon !== undefined && { icon: doc.icon }),
  };
};

export const stableStringify = (value: unknown): string => {
  if (isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (isRecord(value)) {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
};
