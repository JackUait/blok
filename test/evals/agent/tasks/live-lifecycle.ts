import fixture from '../../../fixtures/agent-commands/evals/live-lifecycle.json';
import { sequence } from '../graders/structure';
import { toolSequence } from '../graders/behaviour';
import { ackedOnly, leftRoom } from '../graders/collab';
import type { EvalTask } from '../types';

export const liveLifecycle: EvalTask = {
  ...fixture,
  prompt: 'Join the room "room-y", add a heading "Wrap-up" at the end, then leave.',
  surfaces: ['mcp-live'],
  graders: [
    toolSequence(['blok_open', 'blok_execute', 'blok_close']),
    leftRoom(),
    ackedOnly(),
    sequence('heading at end', ['paragraph', 'header']),
  ],
  budget: { maxTurns: 6, maxOutputTokens: 3000 },
};
