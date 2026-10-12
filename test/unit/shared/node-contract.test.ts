// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBuiltInSnapshot } from '../../../src/shared/built-in-snapshot';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../src/shared/tool-actions';
import { buildAgentContract, buildToolManifest } from '../../../src/shared/tool-manifest';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('default contract in Node', () => {
  it('needs no DOM and lists every declared action with a handler', () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    const manifest = buildToolManifest(buildBuiltInSnapshot({ blokVersion: '1.0.0' }));
    const contract = buildAgentContract(manifest, {}, { runtime: 'node', services: [] });
    const declared = manifest.blocks.flatMap(block => block.actions.map(action => action.command));

    expect(contract.commands.map(command => command.name).sort()).toEqual([...declared].sort());
    manifest.blocks.forEach(block => block.actions.forEach((action) => {
      expect(BUILT_IN_TOOL_RUNTIMES.get(block.name)?.actions[action.name], action.command).toBeDefined();
    }));
  });

  it('every table, columns, tabs and database action exists (spec §3.8)', () => {
    const names = buildAgentContract(buildToolManifest(buildBuiltInSnapshot({ blokVersion: '1' })), {}, { runtime: 'node', services: [] })
      .commands.map(command => command.name);

    expect(names).toEqual(expect.arrayContaining([
      'table.create', 'table.insertRows', 'table.insertColumns', 'table.deleteRows', 'table.deleteColumns', 'table.moveRow', 'table.moveColumn',
      'table.duplicateRows', 'table.duplicateColumns', 'table.clearCells', 'table.styleCells', 'table.mergeCells', 'table.splitCell', 'table.fillCells',
      'column_list.create', 'column_list.addColumn', 'column_list.removeColumn', 'column_list.setWidths',
      'tabs.create', 'tabs.addTab', 'tabs.deleteTab',
      'database.create', 'database.addView', 'database.renameView', 'database.duplicateView', 'database.deleteView', 'database.moveView',
      'database.addProperty', 'database.addOption', 'database.renameOption', 'database.moveOption', 'database.deleteOption',
      'database.addRow', 'database.moveRow', 'database.setRowValues',
      'image.setSource', 'video.setSource', 'audio.setSource', 'file.setSource', 'audio.setCover',
      'image.crop', 'image.rotate', 'image.flip', 'image.straighten', 'image.addMarkup', 'image.updateMarkup', 'image.removeMarkup',
      'embed.setUrl', 'bookmark.create', 'page.rename', 'page.setIcon',
    ]));
  });
});
