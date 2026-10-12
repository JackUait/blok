import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

import type { Blok } from '../../../../types';
import type { CollaborationParticipant } from '../../../../types/events/editor-events';
import { blokTicket } from '../../../../packages/server/src/ticket';
import { isSeed } from '../../../unit/agent/parity/corpus';
import { startDocEndpoint } from '../../../unit/server-conformance/doc-endpoint';
import { startServer } from '../../../unit/server-conformance/run-against';
import type { Observed } from '../types';
import { blocksWithMarker, createCleanup, waitForStable, waitUntil } from './live-room-helpers';
import type { OpenSurface } from './run-task';
import { MCP_ACTOR_ID, openMcpStored } from './surfaces/mcp';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    evalParticipants?: Array<{ id: string; name: string }>;
  }
}

const FIXTURE = 'http://localhost:4444/test/playwright/fixtures/test.html';
const ORIGIN = 'http://localhost:4444';
// Answered by page.route below; the fixture server has no ticket endpoint of its own.
const TICKET_URL = `${ORIGIN}/__eval-ticket`;
// 03 Task 15: the block-level agent marker; the element sits inside the block holder.
const AGENT_MARKER = '[data-blok-agent-marker]';
// The agent's row shows ~100 ms after open and its verified id up to ~800 ms later (e2e.md §8c).
const AGENT_VISIBLE_TIMEOUT_MS = 5_000;

type Participants = NonNullable<Observed['participants']>;

export const openMcpLive: OpenSurface = async (task, schema) => {
  const docId = task.docId ?? task.id;
  const secret = randomBytes(32).toString('hex');
  // Every start below registers its stop, so a failure here leaves no host, endpoint or browser behind.
  const cleanup = createCleanup();

  try {
    const endpoint = await startDocEndpoint();

    cleanup.add(() => endpoint.stop());

    endpoint.serve(docId, task.seed);

    const server = await startServer({
      args: [
        '--listen', '127.0.0.1:0', '--auth', 'ticket', '--storage-dir', '', '--rate-limit', '0',
        '--collab', '--collab-dir', mkdtempSync(join(tmpdir(), 'blok-eval-room-')),
        '--doc-endpoint', endpoint.url, '--allow-origin', ORIGIN,
      ],
      env: { BLOK_SECRET: secret },
    });

    cleanup.add(() => server.stop());
    const wsUrl = `${server.baseUrl.replace(/^http:/, 'ws:')}/sync`;
    const browser = await chromium.launch();

    cleanup.add(() => browser.close());
    const page = await browser.newPage();
    const ticket = blokTicket(secret, { user: 'human', doc: docId, write: true, ttlSeconds: 1800 });

    // The editor appends `?doc=<id>` to the ticket URL, so match on the path only.
    await page.route((url) => `${url.origin}${url.pathname}` === TICKET_URL, (route) => route.fulfill({ json: { ticket } }));
    await page.goto(FIXTURE);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.evaluate(async ({ doc, serverUrl, ticketUrl }) => {
      const holder = document.createElement('div');

      holder.id = 'blok';
      document.body.appendChild(holder);
      window.evalParticipants = [];

      // The sync URL is derived from `server` (BlokMountOptions.collaboration).
      // `user.id` stamps the human's own edits; without it lastEditedBy stays empty.
      const blok = new window.Blok({ holder: 'blok', server: serverUrl, ticket: ticketUrl, user: { id: 'human' }, collaboration: { doc, user: { name: 'Ana' } } });

      window.blokInstance = blok;
      await blok.isReady;
      // `on` exists only after isReady. The agent joins later, so no status it causes is missed.
      blok.on('collaboration:status', (status?: { participants?: CollaborationParticipant[] }) => {
        window.evalParticipants = (status?.participants ?? []).map((p) => ({ id: p.userId ?? '', name: p.user.name }));
      });
    }, { doc: docId, serverUrl: server.baseUrl, ticketUrl: TICKET_URL });

    const marker: string[][] = [];
    const sampler = setInterval(() => {
      void page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => el.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? ''), AGENT_MARKER)
        .then((ids) => marker.push(ids.filter(Boolean)))
        .catch(() => undefined);
    }, 100);
    const seen: { participants: Participants } = { participants: [] };
    const readParticipants = (): Promise<Participants> => page.evaluate(() => window.evalParticipants ?? []);
    const watcher = setInterval(() => {
      void readParticipants()
        .then((list) => {
          // Verified ids (frame 107) can land after a row first shows, so keep every id seen.
          const known = new Map(seen.participants.map((p) => [p.id, p]));

          list.filter((p) => p.id !== '').forEach((p) => known.set(p.id, p));
          seen.participants = [...known.values()];
        })
        .catch(() => undefined);
    }, 100);
    const stopSampling = (): void => {
      clearInterval(sampler);
      clearInterval(watcher);
    };

    cleanup.add(async () => stopSampling());

    // The human types while the agent works; not awaited before the agent starts.
    const typing = (async () => {
      await page.locator('[data-blok-id="p1"] [contenteditable="true"]').first().click();
      await page.keyboard.press('End');
      await page.keyboard.type(' we agreed on Friday', { delay: 80 });
    })();

    // Marked handled: on a failed open the page closes under it. finish() still awaits it and sees its error.
    typing.catch(() => undefined);

    const agent = await openMcpStored(['--sync-url', wsUrl, '--origin', ORIGIN], { BLOK_SECRET: secret })(task, schema);

    cleanup.add(() => agent.close());

    return {
      tools: agent.tools,
      execute: async (name, input) => {
        const outcome = await agent.execute(name, input);

        // Without this, a fast agent closes before peers ever see its row (agentVisible).
        if (name === 'blok_execute') {
          await waitUntil(
            // The watcher's record, not a fresh read: the grader reads `seen`, and the agent may close right after.
            () => Promise.resolve(seen.participants.some((p) => p.id === MCP_ACTOR_ID)),
            { intervalMs: 100, timeoutMs: AGENT_VISIBLE_TIMEOUT_MS }
          );
        }

        return outcome;
      },
      finish: async () => {
        await typing;

        const end = await agent.finish();
        // `time` is stamped on every save, so it is dropped or two reads never match.
        const saved = async (): Promise<unknown> => page.evaluate(async () => {
          const output = await window.blokInstance?.save();

          return output === undefined ? undefined : { ...output, time: undefined };
        });
        const final = await waitForStable(saved, { intervalMs: 250, timeoutMs: 15_000 });

        stopSampling();

        if (!isSeed(final)) {
          throw new Error('the human editor saved no document');
        }

        return {
          ...end,
          final,
          observed: {
            humanId: 'human',
            humanTyped: { blockId: 'p1', text: 'we agreed on Friday' },
            participants: seen.participants,
            peerSawAgentCursorOn: blocksWithMarker(marker),
            // Read after blok_close: the agent row must be gone.
            participantsAfterClose: await readParticipants(),
            // No journal read is reachable from a test yet; ackedOnly then checks only sequences or saved versions.
            serverAckedSequences: undefined,
          },
        };
      },
      close: () => cleanup.run(),
    };
  } catch (error) {
    await cleanup.run().catch(() => undefined);
    throw error;
  }
};
