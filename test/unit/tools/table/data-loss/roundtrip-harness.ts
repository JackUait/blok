import { vi } from 'vitest';
import Blok from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { ListItem } from '../../../../../src/tools/list';
import { Table } from '../../../../../src/tools/table';
import { ToggleItem } from '../../../../../src/tools/toggle';
import { CalloutTool } from '../../../../../src/tools/callout';
import type { API, OutputBlockData, OutputData } from '../../../../../types';
import { blockTextAsHtml, type HtmlReadOptions } from '../../../helpers/saved-as-html';

export interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData | undefined>;
  destroy: () => void;
  blocks: API['blocks'];
  readOnly: { set: (state: boolean) => Promise<unknown>; toggle: (state?: boolean) => Promise<boolean> };
}

export const nextFrame = (): Promise<void> => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

export const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {
    await nextFrame();
    await Promise.resolve();
  }
};

export interface BootOptions {
  readOnly?: boolean;
  dataModel?: 'auto' | 'legacy' | 'flat' | 'hierarchical';
  detached?: boolean;
  tools?: Record<string, unknown>;
}

export interface Booted {
  editor: TestEditor;
  holder: HTMLDivElement;
  onError: ReturnType<typeof vi.fn>;
}

export const boot = async (data: OutputData, options: BootOptions = {}): Promise<Booted> => {
  const holder = document.createElement('div');

  if (options.detached !== true) {
    document.body.appendChild(holder);
  }

  const onError = vi.fn();
  const editor = new Blok({
    holder,
    readOnly: options.readOnly ?? false,
    dataModel: options.dataModel,
    tools: { table: Table, paragraph: Paragraph, list: ListItem, toggle: ToggleItem, callout: CalloutTool, ...options.tools },
    data,
    onError,
  } as never) as unknown as TestEditor;

  await editor.isReady;
  await settle();

  if (options.detached === true) {
    document.body.appendChild(holder);
    await settle();
  }

  return { editor, holder, onError };
};

/** One cell, described without ids. */
export interface CellView {
  texts: string[];
  colspan?: number;
  rowspan?: number;
  mergedInto?: [number, number];
  color?: string;
  textColor?: string;
  placement?: string;
}

export interface TableView {
  withHeadings: unknown;
  withHeadingColumn: unknown;
  stretched: unknown;
  colWidths: unknown;
  initialColWidth: unknown;
  textSize: unknown;
  grid: CellView[][];
  rootTexts: string[];
}

const textOf = (block: OutputBlockData | undefined, options: HtmlReadOptions): string => {
  if (block === undefined) {
    return '<missing>';
  }
  const data = block.data;
  const text = blockTextAsHtml(block, options);

  return `${block.type}:${typeof text === 'string' ? text : JSON.stringify(data)}`;
};

/**
 * Id-free projection of the first table in a document. Legacy string cells
 * project to their string so a string input can be compared too.
 * @param output - a host save, or (with `allowHtml`) an input document or HTML output
 * @param tableIndex - which table
 * @param options - see {@link HtmlReadOptions}
 */
export const viewTable = (output: OutputData | undefined, tableIndex = 0, options: HtmlReadOptions = {}): TableView | null => {
  if (output === undefined) {
    return null;
  }
  const byId = new Map(output.blocks.map(b => [b.id, b]));
  const tables = output.blocks.filter(b => b.type === 'table');
  const table = tables[tableIndex];

  if (table === undefined) {
    return null;
  }
  const data = table.data;
  const content = (data.content ?? []) as unknown[][];
  const grid = content.map(row => row.map((cell): CellView => {
    if (typeof cell === 'string') {
      return { texts: cell === '' ? [] : [`paragraph:${cell}`] };
    }
    const c = cell as Record<string, unknown>;
    const ids = (c.blocks ?? []) as string[];
    const view: CellView = { texts: ids.map(id => textOf(byId.get(id), options)) };

    for (const key of ['colspan', 'rowspan', 'mergedInto', 'color', 'textColor', 'placement'] as const) {
      if (c[key] !== undefined) {
        (view as unknown as Record<string, unknown>)[key] = c[key];
      }
    }

    return view;
  }));
  const rootTexts = output.blocks
    .filter(b => b.type !== 'table' && (b.parent === undefined || b.parent === null))
    .map(b => textOf(b, options));

  return {
    withHeadings: data.withHeadings,
    withHeadingColumn: data.withHeadingColumn,
    stretched: data.stretched,
    colWidths: data.colWidths,
    initialColWidth: data.initialColWidth,
    textSize: data.textSize,
    grid,
    rootTexts,
  };
};

export const allTexts = (output: OutputData | undefined, options: HtmlReadOptions = {}): string[] =>
  (output?.blocks ?? []).filter(b => b.type !== 'table').map(b => textOf(b, options)).sort();
