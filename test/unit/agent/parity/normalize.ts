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
      !Object.prototype.hasOwnProperty.call(defaults, key) || stableStringify(value) !== stableStringify(defaults[key])));

export const TOOL_MINTED: Record<string, {
  reason: string;
  strip(data: Record<string, unknown>): Record<string, unknown>;
}> = {
  table: {
    reason: 'Table cell ids and row ids are random until ToolRuntime.normalize ships (06 C17). The editor also saves stretched false (src/tools/table/table-operations.ts:674) and an initialColWidth measured from layout (src/tools/table/index.ts:867-872): 0 in jsdom, real pixels in a browser, never set by headless appliers.',
    strip: (raw) => {
      const { initialColWidth: _measured, ...rest } = raw;
      const data = withoutLoadDefaults({ stretched: false })(rest);
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


/**
 * Database data mints ids (properties, options, views) and fractional
 * `position` keys with random tails, and no pure database `normalize` exists
 * yet (05 §3.2.1 listed fields, 06 C17). So ids are labelled `dbid<n>` in
 * first-appearance order (each property, then its options, then views), and
 * positions become their rank among siblings. Ranks use plain code-unit order,
 * as comparePositions does (src/shared/database/positions.ts).
 */
const DATABASE = 'database';
const DATABASE_ROW = 'database-row';
// The editor saves an empty automations slot on every database (src/tools/database/index.ts:888); headless appliers do not.
const DATABASE_LOAD_DEFAULTS = { automations: { version: 1, definitions: [] } };

const records = (value: unknown): Array<Record<string, unknown>> => (isArray(value) ? value.filter(isRecord) : []);

const rankPositions = (siblings: Array<Record<string, unknown>>): Map<Record<string, unknown>, string> => {
  const keys = [...new Set(siblings.map((s) => s.position).filter((p): p is string => typeof p === 'string'))]
    .sort((a, b) => Number(a > b) - Number(a < b));

  return new Map(siblings.flatMap((s) => (typeof s.position === 'string' ? [[s, `pos:${keys.indexOf(s.position)}`]] : [])));
};

const databaseIds = (blocks: OutputBlockData[]): Map<string, string> => {
  const labels = new Map<string, string>();
  const label = (id: unknown): void => {
    if (typeof id === 'string' && !labels.has(id)) {
      labels.set(id, `dbid${labels.size + 1}`);
    }
  };

  for (const block of blocks.filter((b) => b.type === DATABASE)) {
    for (const property of records(block.data.schema)) {
      label(property.id);
      records(isRecord(property.config) ? property.config.options : undefined).forEach((option) => label(option.id));
    }
    records(block.data.views).forEach((view) => label(view.id));
  }

  return labels;
};

const relabel = (value: unknown, labels: ReadonlyMap<string, string>, ranks: ReadonlyMap<Record<string, unknown>, string>): unknown => {
  if (typeof value === 'string') {
    const filters = /^(.*)-filters$/.exec(value);

    return labels.get(value) ?? (filters !== null && labels.has(filters[1]) ? `${labels.get(filters[1])}-filters` : value);
  }

  if (isArray(value)) {
    return value.map((item) => relabel(item, labels, ranks));
  }

  if (!isRecord(value)) {
    return value;
  }

  const rank = ranks.get(value);

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    labels.get(key) ?? key,
    key === 'position' && rank !== undefined ? rank : relabel(item, labels, ranks),
  ]));
};

const canonicalDatabases = (blocks: OutputBlockData[]): OutputBlockData[] => {
  const labels = databaseIds(blocks);
  const ranks = new Map<Record<string, unknown>, string>();

  for (const block of blocks.filter((b) => b.type === DATABASE)) {
    const schema = records(block.data.schema);

    [schema, records(block.data.views), ...schema.map((p) => records(isRecord(p.config) ? p.config.options : undefined))]
      .forEach((siblings) => rankPositions(siblings).forEach((r, s) => ranks.set(s, r)));
  }

  const rows = blocks.filter((b) => b.type === DATABASE_ROW);

  // Templates are their own ordered list beside the rows (tools/database/index.ts templates).
  const listOf = (row: OutputBlockData): string => `${row.parent ?? ''}\u0000${row.data.template === true ? 'template' : 'row'}`;

  for (const list of new Set(rows.map(listOf))) {
    rankPositions(rows.filter((r) => listOf(r) === list).map((r) => r.data)).forEach((r, s) => ranks.set(s, r));
  }

  return blocks.map((block) => {
    if (block.type !== DATABASE && block.type !== DATABASE_ROW) {
      return block;
    }

    const relabelled = relabel(block.data, labels, ranks);
    const data = isRecord(relabelled) && block.type === DATABASE ? withoutLoadDefaults(DATABASE_LOAD_DEFAULTS)(relabelled) : relabelled;

    return isRecord(data) ? { ...block, data } : block;
  });
};

const TIMESTAMP_PLACEHOLDER = 0;

export const normalizeForParity = (input: OutputData, keepIds: ReadonlySet<string>): ParityDocument => {
  const doc = { ...input, blocks: canonicalDatabases(input.blocks) };
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

    // Clocks differ per runner: compare that a stamp is there, not its value.
    if (normalized.lastEditedAt !== undefined) {
      normalized.lastEditedAt = TIMESTAMP_PLACEHOLDER;
    }
    if (normalized.createdAt !== undefined) {
      normalized.createdAt = TIMESTAMP_PLACEHOLDER;
    }

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
