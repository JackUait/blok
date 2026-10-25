import { agentAttribution } from '../../../shared/agent/attribution';
import { plannerContextFrom } from '../../../shared/agent/context';
import { describeContract } from '../../../shared/agent/describe';
import { buildDocumentView } from '../../../shared/agent/document-view';
import { createPageMapBackend, pagePrepareInsert } from '../../../shared/agent/document-session';
import { checkEnvelope } from '../../../shared/agent/envelope';
import { runBatch } from '../../../shared/agent/executor';
import { validateAgainst } from '../../../shared/schema/validate';
import { StoreApplier } from './store-applier';

import type { AgentActor, AgentSession, CommandLogEntry, DocumentView, ViewArgs } from '../../../../types/agent';
import type { AgentContract } from '../../../../types/tool-manifest';
import type { AgentPorts } from '../../../shared/agent/types';
import type { ToolRuntimeRegistry } from '../../../shared/tool-actions/runtime';
import type { DocumentStore } from '../yjs/document-store';

const storeSessions = { count: 0 };

export const createStoreAgentSession = (input: {
  store: DocumentStore;
  tools: ToolRuntimeRegistry;
  contract: AgentContract;
  actor: AgentActor;
  ports: AgentPorts;
  services?: Partial<Record<string, unknown>>;
  pageTitles?: 'page-map';
  richTextFieldsFor(type: string): string[];
}): AgentSession => {
  const id = `store-session-${++storeSessions.count}`;
  const createPage = input.pageTitles === 'page-map' ? input.ports.createPageDocument : undefined;
  const applier = new StoreApplier(input.store, {
    attribution: agentAttribution(input.actor),
    richTextFieldsFor: input.richTextFieldsFor,
    htmlToSegments: input.ports.htmlToSegments,
    ...(createPage !== undefined && { prepareInsert: pagePrepareInsert(createPage, input.actor) }),
  });
  const services: Partial<Record<string, unknown>> = { ...(input.services ?? {}) };

  if (input.pageTitles === 'page-map' && input.ports.openPageDocument !== undefined) {
    services.pageBackend = createPageMapBackend(input.ports.openPageDocument, input.actor, blockId => applier.snapshot().get(blockId));
  }
  const ctx = plannerContextFrom(input.contract, input.tools, input.ports, validateAgainst, services);
  const log: CommandLogEntry[] = [];
  const state = { batchNo: 0 };

  return {
    id,
    actor: input.actor,
    read: async (args: ViewArgs = {}): Promise<DocumentView> => {
      checkEnvelope({ commands: [{ name: 'doc.read', args: { ...args } }] }, ctx.commands, ctx.validate);

      return buildDocumentView(applier.snapshot(), args, ctx, applier.revision());
    },
    describe: query => describeContract(input.contract, query),
    execute: (batch, options = {}) => runBatch({
      batch, ctx, applier, actor: input.actor, signal: options.signal, log, batchNo: ++state.batchNo,
    }),
    log: () => [...log],
    close: () => applier.dispose(),
  };
};
