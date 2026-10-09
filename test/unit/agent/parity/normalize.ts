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

export const TOOL_MINTED: Record<string, {
  reason: string;
  strip(data: Record<string, unknown>): Record<string, unknown>;
}> = {
  table: {
    reason: 'Table cell ids and row ids are random until ToolRuntime.normalize ships (06 C17).',
    strip: (data) => {
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
};

const richFields = (type: string): string[] =>
  Object.prototype.hasOwnProperty.call(CURRENT_RICH_TEXT_FIELDS, type) ? CURRENT_RICH_TEXT_FIELDS[type] : [];

const renameRecord = (value: Record<string, unknown>, names: ReadonlyMap<string, string>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renameDeep(item, names)]));

const renameDeep = (value: unknown, names: ReadonlyMap<string, string>): unknown => {
  if (typeof value === 'string') {
    return names.get(value) ?? value;
  }

  if (isArray(value)) {
    return value.map((item) => renameDeep(item, names));
  }

  return isRecord(value) ? renameRecord(value, names) : value;
};

export const normalizeForParity = (doc: OutputData, keepIds: ReadonlySet<string>): ParityDocument => {
  const byId = new Map<string, OutputBlockData>();

  doc.blocks.forEach((block) => {
    if (block.id !== undefined) {
      byId.set(block.id, block);
    }
  });

  const ordered: Array<{ block: OutputBlockData; label: string }> = [];
  const walk = (block: OutputBlockData, label: string): void => {
    ordered.push({ block, label });

    const listed = (block.content ?? []).flatMap((id) => {
      const child = byId.get(id);

      return child === undefined ? [] : [child];
    });
    const children = listed.length > 0
      ? listed
      : doc.blocks.filter((child) => block.id !== undefined && child.parent === block.id);

    children.forEach((child, index) => walk(child, `${label}.${index}`));
  };

  doc.blocks.filter((block) => block.parent === undefined || block.parent === null)
    .forEach((block, index) => walk(block, `b${index}`));

  const names = new Map<string, string>();

  ordered.forEach(({ block, label }) => {
    if (block.id !== undefined && !keepIds.has(block.id)) {
      names.set(block.id, label);
    }
  });

  const rename = (value: string): string => names.get(value) ?? value;
  const cleaned = ordered.map(({ block }): OutputBlockData => {
    const minted = Object.prototype.hasOwnProperty.call(TOOL_MINTED, block.type) ? TOOL_MINTED[block.type] : undefined;
    const data = minted === undefined ? block.data : minted.strip(block.data);
    const normalized: OutputBlockData = {
      ...block,
      type: rename(block.type),
      data: renameRecord(data, names),
      ...(block.id !== undefined && { id: rename(block.id) }),
      ...(block.parent !== undefined && { parent: rename(block.parent) }),
      ...(block.content !== undefined && { content: block.content.map(rename) }),
      ...(block.tunes !== undefined && { tunes: renameRecord(block.tunes, names) }),
      ...(block.lastEditedBy !== undefined && { lastEditedBy: rename(block.lastEditedBy) }),
      ...(block.createdBy !== undefined && { createdBy: rename(block.createdBy) }),
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
