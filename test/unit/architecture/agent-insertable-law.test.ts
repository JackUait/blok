// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMANDS } from '../../../src/shared/agent';
import { buildAgentContract, buildToolManifest, PREPARES_INSERT } from '../../../src/shared/tool-manifest';
import { buildBuiltInSnapshot } from '../../../src/shared/built-in-snapshot';
import { snapshotWithCustomTools } from '../../../src/shared/custom-tools-file';
import { createHeadlessAgentSetup } from '../../../src/view/agent-runtime';
import { openJsonSession, openStoreSession } from '../agent/harness';
import { insertOutcome, PREPARED_CUSTOM_TOOLS } from './agent-insertable-fixtures';

import type { HostService } from '../../../types';

/**
 * The contract never says a block inserts when the runtime cannot insert it,
 * and never hides one it can: every type listed insertable inserts with
 * block.insert, every other one fails with COMMAND_UNAVAILABLE.
 */

const SERVICE_SETS: HostService[][] = [[], ['pageBackend']];
const RUNTIMES = ['node', 'node-live'] as const;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(RUNTIMES)('runtime %s', (runtime) => {
  describe.each(SERVICE_SETS.map(services => ({ services, label: services.join(',') || 'none' })))('services $label', ({ services }) => {
    const { contract } = createHeadlessAgentSetup({ runtime, services, customTools: PREPARED_CUSTOM_TOOLS });

    it.each(contract.manifest.blocks.map(block => ({ name: block.name, insertable: block.insertable })))(
      '$name (insertable: $insertable) inserts exactly when the contract says so',
      async ({ name, insertable }) => {
        const open = runtime === 'node' ? openJsonSession : openStoreSession;
        const session = open({ blocks: [] }, undefined, { names: services, impl: {} }, PREPARED_CUSTOM_TOOLS);

        try {
          const outcome = await insertOutcome(session, name);

          expect(outcome, `${name} in ${runtime} with [${services.join(', ')}]`).toBe(insertable ? 'ok' : 'COMMAND_UNAVAILABLE');
        } finally {
          await session.close();
        }
      }
    );
  });
});

describe('the runtime flag matches the applier', () => {
  it('only the editor applier prepares inserts', async () => {
    const { EditorApplier } = await import('../../../src/components/modules/agent/editor-applier');
    const { StoreApplier } = await import('../../../src/components/modules/agent/store-applier');

    expect(typeof EditorApplier.prototype.prepareInsert === 'function').toBe(PREPARES_INSERT.editor);
    expect(typeof Reflect.get(StoreApplier.prototype, 'prepareInsert') === 'function').toBe(PREPARES_INSERT['node-live']);
    expect(PREPARES_INSERT.node).toBe(false);
  });

  it('the editor contract keeps a prepared tool insertable, headless contracts do not', () => {
    const snapshot = snapshotWithCustomTools(buildBuiltInSnapshot({ blokVersion: 'test' }), PREPARED_CUSTOM_TOOLS);
    const manifest = buildToolManifest(snapshot);
    const insertable = (where: Parameters<typeof buildAgentContract>[2]): Record<string, boolean> => Object.fromEntries(
      buildAgentContract(manifest, COMMANDS, where).manifest.blocks
        .filter(block => (block.insertRequires?.length ?? 0) > 0)
        .map(block => [block.name, block.insertable])
    );

    expect(insertable({ runtime: 'editor', services: [] })).toEqual({ page: true, prepared: true });
    expect(insertable({ runtime: 'node', services: ['pageBackend'] })).toEqual({ page: false, prepared: false });
  });
});
