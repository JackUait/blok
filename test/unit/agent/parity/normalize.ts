import { outputBlocksToCanonicalSegments } from '../../../../src/shared/rich-text/block-data';
import { CURRENT_RICH_TEXT_FIELDS } from '../../../../src/shared/rich-text/fields';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { htmlToSegmentsNode } from '../../../../src/view/rich-text-node';
import type { OutputBlockData, OutputData } from '../../../../types';

export interface ParityDocument {
  blocks: OutputData['blocks'];
  title?: OutputData['title'];
  icon?: OutputData['icon'];
}

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !isArray(value);

// Tools whose normalize only fills load defaults. Table and embed normalizers derive data, so they stay out.
const LOAD_DEFAULT_TOOLS = new Set(['code', 'quote', 'callout', 'list', 'database']);

/**
 * Seed blocks keep their stored data in the headless engines; the editor fills each tool's
 * load defaults on load and saves them. Both sides go through the tool's own
 * ToolRuntime.normalize, then each key it would fill again with the same value is dropped.
 * Written blocks already get the defaults in every engine (agent-engine-saved-data-parity-law).
 */
const withoutLoadDefaults = (type: string, data: Record<string, unknown>): Record<string, unknown> => {
  const fill = LOAD_DEFAULT_TOOLS.has(type) ? BUILT_IN_TOOL_RUNTIMES.get(type)?.normalize : undefined;

  if (fill === undefined) {
    return data;
  }

  const filled = fill(data);

  return Object.fromEntries(Object.entries(filled).filter(([key, value]) => {
    const refilled = fill(Object.fromEntries(Object.entries(filled).filter(([other]) => other !== key)));

    return !Object.hasOwn(refilled, key) || stableStringify(refilled[key]) !== stableStringify(value);
  }));
};

/** Values only one engine mints, by tool. */
export const TOOL_MINTED: Record<string, {
  reason: string;
  strip(data: Record<string, unknown>): Record<string, unknown>;
}> = {
  table: {
    reason: 'Table cell ids and row ids are random. The editor also saves an initialColWidth measured from layout (src/tools/table/index.ts): 0 in jsdom, real pixels in a browser. Its stretched falls back to the host table config (src/tools/table/table-operations.ts), which headless appliers do not know, so it is not a load default the planner can fill.',
    strip: (raw) => {
      const { initialColWidth: _measured, stretched, ...rest } = raw;
      const data = stretched === false || stretched === undefined ? rest : { ...rest, stretched };
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

    const data = relabel(block.data, labels, ranks);

    return isRecord(data) ? { ...block, data } : block;
  });
};

const TIMESTAMP_PLACEHOLDER = 0;

/** answerRows: rows a model reads, so load defaults and the rich-text form stay as sent. */
export const normalizeForParity = (
  input: OutputData,
  keepIds: ReadonlySet<string>,
  options: { answerRows?: boolean } = {}
): ParityDocument => {
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
    const stripped = minted === undefined ? block.data : minted.strip(block.data);
    let data = options.answerRows === true ? stripped : withoutLoadDefaults(block.type, stripped);
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
    blocks: options.answerRows === true ? cleaned : outputBlocksToCanonicalSegments(cleaned, richFields, htmlToSegmentsNode),
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
