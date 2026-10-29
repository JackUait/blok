import { createStoreAgentSession } from '../../../src/components/modules/agent/store-session';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { readPageFields } from '../../../src/components/modules/yjs/page-fields';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import { COMMANDS, createDocumentAgentSession } from '../../../src/shared/agent';
import { buildBuiltInSnapshot } from '../../../src/shared/built-in-snapshot';
import { snapshotWithCustomTools } from '../../../src/shared/custom-tools-file';
import { buildAgentContract, buildToolManifest } from '../../../src/shared/tool-manifest';
import { validateAgainst } from '../../../src/shared/schema/validate';
import { createHeadlessAgentSetup, loadStoredDocument } from '../../../src/view/agent-runtime';
import { blokDocumentSchema } from '../../../src/view/document-schema';
import { htmlToSegmentsNode } from '../../../src/view/rich-text-node';
import type { AgentContract, OutputData, ToolRegistrySnapshot } from '../../../types';
import type { BlokCustomToolsFile } from '../../../types/tool-manifest';
import type { AgentActor, AgentSession } from '../../../types/agent';
import type { HostServices } from './parity/corpus';

// The editor runner boots with user human-1, the person this agent acts for.
export const TEST_ACTOR: AgentActor = { id: 'agent-test', name: 'Parity', kind: 'agent', onBehalfOf: 'human-1' };

export const nodeContract = (runtime: 'node' | 'node-live' = 'node'): AgentContract =>
  createHeadlessAgentSetup({ runtime }).contract;

const NO_SERVICES: HostServices = { names: [], impl: {} };

export const openJsonSession = (
  seed: OutputData,
  actor: AgentActor = TEST_ACTOR,
  services: HostServices = NO_SERVICES,
  customTools?: BlokCustomToolsFile,
  where: { comments?: boolean } = {}
) => {
  const setup = createHeadlessAgentSetup({ runtime: 'node', services: services.names, customTools, ...where });

  return createDocumentAgentSession({
    document: loadStoredDocument(structuredClone(seed), setup.richTextFieldsFor),
    tools: setup.tools,
    contract: setup.contract,
    actor,
    ports: setup.ports,
    services: services.impl,
  });
};

// The validator ignores $ref, so per-tool payloads are not checked here.
export const validateSaved = (doc: OutputData): string[] =>
  validateAgainst(blokDocumentSchema, doc).map(({ path, message }) => `${path}: ${message}`);

/** 05 Q14, answered by 01 D-5: toJSON maps one-to-one onto saved blocks; page fields are flat (01 D-1). */
const storeToOutput = (store: DocumentStore): OutputData => ({
  ...readPageFields(store.page),
  blocks: store.toJSON(),
});

export const openStoreSession = (
  seed: OutputData,
  actor: AgentActor = TEST_ACTOR,
  services: HostServices = NO_SERVICES,
  customTools?: BlokCustomToolsFile,
  where: { comments?: boolean } = {}
): AgentSession & { output(): OutputData } => {
  const setup = createHeadlessAgentSetup({ runtime: 'node-live', services: services.names, customTools, ...where });
  // Node has no DOM: the serializer's default HTML parser needs one.
  const store = new DocumentStore(new YBlockSerializer({
    htmlToSegments: htmlToSegmentsNode,
    richTextFieldsFor: setup.richTextFieldsFor,
  }));
  const copy = loadStoredDocument(structuredClone(seed), setup.richTextFieldsFor);

  store.fromJSON(copy.blocks);
  store.pageFromJSON({ title: copy.title, icon: copy.icon });

  const session = createStoreAgentSession({
    store,
    tools: setup.tools,
    contract: setup.contract,
    actor,
    ports: setup.ports,
    richTextFieldsFor: setup.richTextFieldsFor,
    services: services.impl,
  });

  return {
    ...session,
    close: async () => {
      try {
        await session.close();
      } finally {
        await store.destroy();
      }
    },
    output: () => storeToOutput(store),
  };
};

/**
 * In the browser a host tool class brings its action handlers; a custom tools
 * file alone brings none (snapshotWithCustomTools sets `handlers: []`).
 */
const withCustomHandlers = (snapshot: ToolRegistrySnapshot, file: BlokCustomToolsFile): ToolRegistrySnapshot => {
  const declared = new Map(file.blocks.map((block) => [block.name, (block.description.actions ?? []).map((action) => action.name)]));

  return {
    ...snapshot,
    blocks: snapshot.blocks.map((block) => ({ ...block, handlers: declared.get(block.name) ?? block.handlers })),
  };
};

// One snapshot for both runners, so only the runner and handlers differ (06 R3-1).
export const contractFor = (runtime: 'editor' | 'node', customTools?: BlokCustomToolsFile): AgentContract => {
  const snapshot = snapshotWithCustomTools(buildBuiltInSnapshot({ blokVersion: 'test' }), customTools);
  const withHandlers = runtime === 'editor' && customTools !== undefined ? withCustomHandlers(snapshot, customTools) : snapshot;

  return buildAgentContract(buildToolManifest(withHandlers), COMMANDS, { runtime, services: [] });
};
