import type { AgentActor, AgentSession, CommandLogEntry, DocumentView, ViewArgs } from '../../../../types/agent';
import type { AgentContract, ManifestOverrides } from '../../../../types/tool-manifest';
import type { HostService } from '../../../../types/tools/tool-description';
import { COMMANDS } from '../../../shared/agent/commands';
import { plannerContextFrom } from '../../../shared/agent/context';
import { describeContract } from '../../../shared/agent/describe';
import { buildDocumentView } from '../../../shared/agent/document-view';
import { checkEnvelope } from '../../../shared/agent/envelope';
import { runBatch } from '../../../shared/agent/executor';
import { validateAgainst } from '../../../shared/schema/validate';
import type { ToolRuntimeRegistry } from '../../../shared/tool-actions/runtime';
import { buildAgentContract, buildToolManifest } from '../../../shared/tool-manifest';
import type { BlokModules } from '../../../types-internal/blok-modules';
import { runtimesFromTools, snapshotFromTools } from '../../tools/registry-snapshot';
import { getBlokVersion } from '../../utils/version';
import { EditorApplier } from './editor-applier';
import { createEditorPorts } from './editor-ports';

export type InternalEditorHandle = BlokModules;

export interface ContractSource {
  contract(): AgentContract;
  runtimes(contract: AgentContract): ToolRuntimeRegistry;
}

export const liveContractSource = (
  Blok: BlokModules,
  options: { services?: HostService[]; overrides?: ManifestOverrides } = {}
): ContractSource => {
  const services = options.services ?? [];
  const snapshot = () => snapshotFromTools(Blok.Tools, {
    blokVersion: getBlokVersion(),
    readOnly: Blok.ReadOnly.isEnabled,
    defaultBlock: Blok.Tools.defaultTool.name,
    services,
    i18n: Blok.I18n,
  });

  return {
    contract: () => buildAgentContract(buildToolManifest(snapshot(), options.overrides), COMMANDS, { runtime: 'editor', services }),
    runtimes: () => runtimesFromTools(Blok.Tools),
  };
};

const editorSessions = { count: 0 };

export const createEditorAgentSession = (
  editor: InternalEditorHandle,
  actor: AgentActor,
  options: {
    contractSource?: ContractSource;
    turnId?: string;
    mergeSteps?: 'batch' | 'turn';
    attributeLastEditedBy?: boolean;
    services?: Partial<Record<HostService, unknown>>;
    onPrepared?(type: string, data: Record<string, unknown>): void;
    onPagePointed?(pageId: string): void;
  } = {}
): AgentSession & { sealSteps(): void } => {
  const id = `editor-session-${++editorSessions.count}`;
  const services: Partial<Record<HostService, unknown>> = options.services ?? {};
  const serviceNames = Object.keys(services).filter((name): name is HostService =>
    (name === 'uploader' || name === 'linkMetadata' || name === 'pageBackend' || name === 'host' || name === 'versionHistory')
    && services[name] !== undefined
  );
  const source = options.contractSource ?? liveContractSource(editor, { services: serviceNames });
  const ports = createEditorPorts(editor);
  const applier = new EditorApplier(editor, {
    actor, sessionId: id, turnId: options.turnId ?? id, attributeLastEditedBy: options.attributeLastEditedBy,
    mergeSteps: options.mergeSteps ?? 'batch',
    onPrepared: options.onPrepared,
    onPagePointed: options.onPagePointed,
  });
  const log: CommandLogEntry[] = [];
  const state: {
    cached: { revision: string; runtimes: ToolRuntimeRegistry } | null;
    batchNo: number;
  } = { cached: null, batchNo: 0 };

  const context = () => {
    const contract = source.contract();

    if (state.cached === null || state.cached.revision !== contract.revision) {
      state.cached = { revision: contract.revision, runtimes: source.runtimes(contract) };
    }

    return plannerContextFrom(contract, state.cached.runtimes, ports, validateAgainst, services);
  };

  return {
    id,
    actor,
    read: async (args: ViewArgs = {}): Promise<DocumentView> => {
      const ctx = context();

      checkEnvelope({ commands: [{ name: 'doc.read', args: { ...args } }] }, ctx.commands, ctx.validate);
      await applier.settle();

      return buildDocumentView(applier.snapshot(), args, ctx, applier.revision());
    },
    describe: query => describeContract(source.contract(), query),
    execute: (batch, opts = {}) => runBatch({
      batch, ctx: context(), applier, actor, signal: opts.signal, log, batchNo: ++state.batchNo,
    }),
    log: () => [...log],
    // mergeSteps 'turn': join this turn's batch steps into one native step now.
    sealSteps: () => applier.seal(),
    close: () => applier.dispose(),
  };
};
