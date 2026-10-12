import type { CollabSocketFactory } from '../components/modules/collaboration/types';
import type { AgentPorts } from '../shared/agent/types';
import { createHeadlessPorts } from '../view/agent-runtime';

import { agentPresenceName } from './actor';
import { createTicketProvider } from './auth/tickets';
import { buildMcpContracts } from './contract';
import { createToolDispatcher } from './dispatcher';
import type { Caller, DispatcherDeps } from './dispatcher';
import { HandleRegistry } from './handles';
import { createOpenLive } from './live/open-live';
import { createOpener, createSource } from './opener';
import { createOpenPageDocument } from './page-titles';
import { DEFAULTS } from './options';
import type { BlokMcpOptions } from './options';
import type { Dispatch } from './sdk-server';
import type { HandleSession } from './session';
import { listMcpTools } from './tools';
import type { McpTool } from './tools';

export interface AssembledMcp {
  tools: McpTool[];
  dispatch: Dispatch;
  handles: HandleRegistry<HandleSession>;
  stop(): Promise<void>;
}

export interface AssembleDeps {
  open?: DispatcherDeps['open'];
  list?: DispatcherDeps['list'];
  /** Tests inject a scripted transport. */
  liveSocketFactory?: CollabSocketFactory;
  liveSyncTimeoutMs?: number;
}

export const assembleMcp = (options: BlokMcpOptions, deps: AssembleDeps = {}): AssembledMcp => {
  const handleIdleMs = options.handleIdleMs ?? DEFAULTS.handleIdleMs;
  const contracts = buildMcpContracts({
    manifest: options.manifest,
    overrides: options.overrides,
    pageTitles: options.pageTitles ?? DEFAULTS.pageTitles,
    richTextFields: options.richTextFields,
  });
  // portsFor needs the opener and the opener needs portsFor: bind the open late.
  const late: { open: DispatcherDeps['open'] | null } = { open: null };
  const pageMap = (options.pageTitles ?? DEFAULTS.pageTitles) === 'page-map';
  const portsFor = (caller: Caller): AgentPorts => createHeadlessPorts({
    sanitizeFor: (type) => contracts.runtimes.get(type)?.sanitize,
    richTextFieldsFor: contracts.richTextFieldsFor,
    ...(pageMap && {
      openPageDocument: createOpenPageDocument({
        open: (request, who) => {
          if (late.open === null) {
            throw new Error('blok-mcp: the opener is not ready');
          }

          return late.open(request, who);
        },
        caller,
      }),
    }),
  });
  const tickets = options.tickets === undefined ? undefined : createTicketProvider(options.tickets);
  const openLive = options.sync === undefined ? undefined : createOpenLive({
    sync: options.sync,
    contracts,
    pageTitles: options.pageTitles,
    socketFactory: deps.liveSocketFactory,
    syncTimeoutMs: deps.liveSyncTimeoutMs,
    portsFor,
    presenceName: (caller, actor) =>
      agentPresenceName({ customActor: options.agentActor !== undefined, clientName: caller.clientName, actor }),
    ...(tickets !== undefined && {
      ticketsFor: (request, caller, actor) => tickets({
        documentId: request.documentId,
        write: request.write,
        principal: caller.principal,
        clientName: caller.clientName,
        actorId: actor.id,
      }),
    }),
  });
  const opener = createOpener({ options, contracts, source: createSource(options.source), openLive, portsFor });

  late.open = opener.open;
  const tools = listMcpTools(contracts.stored, { schema: options.schema ?? DEFAULTS.schema, handleIdleMs });
  const handles = new HandleRegistry<HandleSession>({
    idleMs: handleIdleMs,
    maxPerPrincipal: options.maxHandlesPerPrincipal ?? DEFAULTS.maxHandlesPerPrincipal,
    onExpire: async session => {
      await session.close('expired');
    },
  });
  // A sweep removes a handle before its close settles, so stop must wait for running sweeps too.
  const sweeps = new Set<Promise<number>>();
  const sweeper = setInterval(() => {
    const sweep = handles.sweep();

    sweeps.add(sweep);
    void sweep.finally(() => sweeps.delete(sweep));
  }, Math.min(handleIdleMs, 30_000));

  sweeper.unref();

  const authorize = options.authorize;
  const dispatch = createToolDispatcher({
    handles,
    open: deps.open ?? opener.open,
    list: deps.list ?? opener.list,
    stillAllowed: async (caller, documentId, write) =>
      authorize === undefined ? true : authorize(caller.principal, documentId, write),
    handleIdleMs,
  });
  const state: { stopping?: Promise<void> } = {};

  return {
    tools,
    dispatch,
    handles,
    stop: () => {
      clearInterval(sweeper);
      state.stopping ??= Promise.all([
        handles.closeAll(async session => {
          await session.close('closed');
        }),
        Promise.allSettled([...sweeps]),
      ]).then(() => undefined);

      return state.stopping;
    },
  };
};
