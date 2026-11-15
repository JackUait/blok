// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assembleMcp, type AssembledMcp } from '../../../src/mcp/server';
import type { Caller } from '../../../src/mcp/dispatcher';
import type { DocumentView, ViewBlock } from '../../../types/agent';

const caller: Caller = { principal: 'fixture-author', clientName: 'authoring-demo', scopes: null };
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../packages/mcp/examples/authoring/blocks.json'), 'utf-8')) as {
  commands: Array<{ name: string; args: { id: string; type: string; data: Record<string, unknown>; parentId?: string; position: string } }>;
};

describe('the page authoring recipe on temporary documents', () => {
  let dir: string;
  let mcp: AssembledMcp;
  let handle: string;

  const execute = async (commands: Array<{ name: string; args: Record<string, unknown> }>) => {
    const result = await mcp.dispatch('blok_execute', { handle, commands }, caller);

    expect(result.structuredContent, JSON.stringify(result.structuredContent)).toMatchObject({ ok: true });

    return result.structuredContent;
  };

  // Deliberately small pages exercise cursor traversal, including nested toggle children.
  const readAll = async (): Promise<ViewBlock[]> => {
    const blocks: ViewBlock[] = [];
    let cursor: string | undefined;
    do {
      const result = await mcp.dispatch('blok_read', { handle, detail: 'full', depth: 8, limit: 3, textLimit: 2000, ...(cursor === undefined ? {} : { cursor }) }, caller);

      expect(result.isError).toBe(false);
      const view = result.structuredContent as unknown as DocumentView;
      blocks.push(...view.blocks);
      cursor = view.next;
    } while (cursor !== undefined);

    return blocks;
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'blok-authoring-demo-'));
    mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir } });
    const opened = await mcp.dispatch('blok_open', { documentId: 'temporary-demo', write: true }, caller);

    handle = opened.structuredContent.handle as string;
  });

  afterEach(async () => {
    await mcp.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('saves and reads back headings, visible uncertainties, toggle children, image provenance and Mermaid data', async () => {
    await execute(fixture.commands);
    const blocks = await readAll();

    expect(blocks.map(block => block.id)).toEqual(fixture.commands.map(command => command.args.id));
    expect(blocks.find(block => block.id === 'demo-child')).toMatchObject({ parentId: 'demo-details', type: 'paragraph' });
    expect(blocks.find(block => block.id === 'demo-uncertainty')?.parentId).toBeUndefined();
    expect(blocks.find(block => block.id === 'demo-source')?.text).toContain('Source : notes synthétiques');
    expect(blocks.find(block => block.id === 'demo-image')?.data).toMatchObject({ alt: expect.any(String), captionVisible: true, caption: expect.stringContaining('test uniquement') });
    expect(blocks.find(block => block.id === 'demo-diagram')?.data).toMatchObject({ language: 'mermaid', code: expect.stringContaining('flowchart LR') });
    expect(JSON.stringify(blocks.find(block => block.id === 'demo-credit')?.data)).toContain('https://example.invalid/fixture.png');
    const disk = JSON.parse(readFileSync(join(dir, 'temporary-demo.json'), 'utf-8')) as { blocks: unknown[] };
    expect(disk.blocks).toHaveLength(fixture.commands.length);
  });

  it('reconciles a lost successful response after reopening without inserting duplicates', async () => {
    await execute(fixture.commands);
    await mcp.dispatch('blok_close', { handle }, caller);
    const opened = await mcp.dispatch('blok_open', { documentId: 'temporary-demo', write: true }, caller);
    handle = opened.structuredContent.handle as string;
    const existing = await readAll();
    // The fixture owns these stable ids; in a real page also compare content before accepting a match.
    const missing = fixture.commands.filter(command => !existing.some(block => block.id === command.args.id));
    expect(missing).toHaveLength(0);
    if (missing.length > 0) {
      await execute(missing);
    }
    expect((await readAll()).map(block => block.id)).toEqual(existing.map(block => block.id));
  });

  it('creates a simple table and a distinct database with typed properties and views', async () => {
    const table = await execute([{ name: 'table.create', args: { rows: 2, cols: 2, withHeadings: true, cells: [['Critère', 'Choix'], ['Contenu stable', 'Tableau simple']] } }]);
    const database = await execute([{ name: 'database.create', args: { title: 'Questions fictives', view: 'table' } }]);
    const tableId = (table.results as Array<{ id: string }>)[0].id;
    const databaseId = (database.results as Array<{ id: string }>)[0].id;
    expect(databaseId).not.toBe(tableId);
    await execute([{ name: 'database.addProperty', args: { id: databaseId, name: 'Échéance', type: 'date' } }]);
    await execute([{ name: 'database.addView', args: { id: databaseId, type: 'board', name: 'Par statut' } }]);
    const blocks = await readAll();
    expect(blocks.find(block => block.id === tableId)?.type).toBe('table');
    const data = blocks.find(block => block.id === databaseId)?.data as { schema: Array<{ id: string; type: string }>; views: Array<{ type: string }> };
    expect(data.schema.map(property => property.type)).toEqual(expect.arrayContaining(['title', 'date']));
    expect(data.views.map(view => view.type)).toEqual(expect.arrayContaining(['table', 'board']));
    const titleProperty = data.schema.find(property => property.type === 'title');
    if (titleProperty === undefined) {
      throw new Error('The created database has no title property.');
    }
    const values = { [titleProperty.id]: 'Recueillir les questions fictives' };
    const row = await execute([{ name: 'database.addRow', args: { id: databaseId, values } }]);
    const rowId = (row.results as Array<{ rowId: string }>)[0].rowId;
    expect((await readAll()).find(block => block.id === rowId)).toMatchObject({
      type: 'database-row', parentId: databaseId, data: { properties: values },
    });
  });

  it('rejects an invented block type atomically instead of creating a misleading diagram', async () => {
    const result = await mcp.dispatch('blok_execute', { handle, commands: [fixture.commands[0], { name: 'block.insert', args: { type: 'mermaid', data: { code: 'A --> B' } } }] }, caller);
    expect(result.isError).toBe(true);
    expect(await readAll()).toEqual([]);
  });
});
