import type { CollabSocketFactory } from '../components/modules/collaboration/types';
import type { AgentActor } from '../../types/agent';
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
import { mcpInstructions } from './instructions';
import type { Dispatch } from './sdk-server';
import type { HandleSession } from './session';
import { listMcpTools } from './tools';
import type { McpTool } from './tools';

export interface AssembledMcp {
  tools: McpTool[];
  /** Sent on initialize; built from the contract tools/list renders. */
  instructions: string;
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

// Above the slowest bounded open: 10 s authorize webhook + 30 s endpoint load (live: 10 s + 10 s ticket
// + 15 s sync). A user --authorize module has no timeout, so stop gives up waiting here.
const STOP_DRAIN_MS = 45_000;

// Work in flight can add more promises, so it looks again until nothing new is left.
const drain = async (sets: Set<Promise<unknown>>[], seen = new Set<Promise<unknown>>()): Promise<void> => {
  const pending = sets.flatMap(set => [...set]).filter(item => !seen.has(item));

  if (pending.length === 0) {
    return;
  }
  pending.forEach(item => seen.add(item));
  await Promise.allSettled(pending);
  await drain(sets, seen);
};

export const assembleMcp = (options: BlokMcpOptions, deps: AssembleDeps = {}): AssembledMcp => {
  const handleIdleMs = options.handleIdleMs ?? DEFAULTS.handleIdleMs;
  const pageMap = (options.pageTitles ?? DEFAULTS.pageTitles) === 'page-map';
  const source = createSource(options.source);
  // A sync service owns every document (spec §3.6), so only a stored-only server creates pages.
  const createsPages = pageMap && source !== null && options.sync === undefined;
  const contracts = buildMcpContracts({
    manifest: options.manifest,
    overrides: options.overrides,
    pageTitles: options.pageTitles ?? DEFAULTS.pageTitles,
    createsPages,
    richTextFields: options.richTextFields,
  });
  // page.rename / page.setIcon close their page session without waiting, so stop waits for those closes.
  const pageCloses = new Set<Promise<unknown>>();
  const trackPageClose = (closing: Promise<unknown>): void => {
    pageCloses.add(closing);
    void closing.catch(() => undefined).finally(() => pageCloses.delete(closing));
  };
  // portsFor needs the opener and the opener needs portsFor: bind the open late.
  const late: { open: DispatcherDeps['open'] | null; createPage: ((caller: Caller) => Promise<{ pageId: string }>) | null } = {
    open: null, createPage: null,
  };
  const portsFor = (caller: Caller, _actor?: AgentActor, isOpenDocument?: (pageId: string) => Promise<boolean>): AgentPorts => createHeadlessPorts({
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
        isOpenDocument,
        track: trackPageClose,
      }),
    }),
    ...(createsPages && {
      createPageDocument: () => {
        if (late.createPage === null) {
          throw new Error('blok-mcp: the opener is not ready');
        }

        return late.createPage(caller);
      },
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
  const opener = createOpener({ options, contracts, source, openLive, portsFor });

  late.open = opener.open;
  late.createPage = opener.createPage;
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
    // stdout carries the protocol, so failures go to stderr.
    void sweep
      .catch((error: unknown) => console.error('blok-mcp: closing an idle handle failed', error))
      .finally(() => sweeps.delete(sweep));
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
  // An open that lands after stop closes its session in the dispatcher, so stop must wait for it.
  const opens = new Set<Promise<unknown>>();
  const tracked: Dispatch = (name, args, caller, dispatchOptions) => {
    const outcome = dispatch(name, args, caller, dispatchOptions);

    if (name === 'blok_open') {
      opens.add(outcome);
      void outcome.catch(() => undefined).finally(() => opens.delete(outcome));
    }

    return outcome;
  };

  return {
    tools,
    instructions: mcpInstructions(contracts.stored),
    dispatch: tracked,
    handles,
    stop: () => {
      clearInterval(sweeper);
      state.stopping ??= (async () => {
        const deadline: { timer?: ReturnType<typeof setTimeout> } = {};
        const expired = new Promise<void>(resolve => {
          deadline.timer = setTimeout(resolve, STOP_DRAIN_MS);
        });
        const work = (async () => {
          await Promise.all([
            handles.closeAll(async session => {
              await session.close('closed');
            }),
            Promise.allSettled([...sweeps]),
            drain([opens, pageCloses]),
          ]);
          // An execute that closeAll waited for may have closed a page session after the first drain.
          await drain([opens, pageCloses]);
        })();

        try {
          await Promise.race([work, expired]);
        } finally {
          clearTimeout(deadline.timer);
        }
      })();

      return state.stopping;
    },
  };
};
