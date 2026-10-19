import type { ExecuteResult, Grader, Verdict } from '../types';
import { plainText } from './text';

const ok = (detail: string): Verdict => ({ pass: true, detail });
const no = (detail: string): Verdict => ({ pass: false, detail });

// The MCP answer caps changed lists at 50 ids; resultIds fills in what the cap left out.
export const agentTouched = (results?: readonly ExecuteResult[]): Set<string> =>
  new Set((results ?? []).flatMap((r) => [
    ...(r.changed === undefined ? [] : [...r.changed.created, ...r.changed.updated, ...r.changed.moved]),
    ...(r.resultIds ?? []),
  ]));

export const humanPreserved = (): Grader => ({
  name: 'humanPreserved',
  check: ({ final, observed }) => {
    const typed = observed?.humanTyped;

    if (typed === undefined) {
      return no('no record of what the human typed');
    }

    const block = final.blocks.find((b) => b.id === typed.blockId);

    return block !== undefined && plainText(block).includes(typed.text) ? ok('human text kept') : no(`"${typed.text}" missing from ${typed.blockId}`);
  },
});

export const agentVisible = (): Grader => ({
  name: 'agentVisible',
  check: ({ actorId, observed, results }) => {
    if (!(observed?.participants ?? []).some((p) => p.id === actorId)) {
      return no('agent not in the participants list');
    }

    const touched = agentTouched(results);
    const seen = (observed?.peerSawAgentCursorOn ?? []).filter((id) => touched.has(id));

    // Block-level is enough (06 §10.2).
    return seen.length > 0 ? ok(`cursor seen on ${seen.join(', ')}`) : no('peer never saw agentCursor on a block the agent touched');
  },
});

export const attributed = (): Grader => ({
  name: 'attributed',
  check: ({ final, actorId, results, observed }) => {
    const touched = agentTouched(results);
    const problems = final.blocks
      .filter((b) => b.id !== undefined && touched.has(b.id) && b.lastEditedBy !== actorId)
      .map((b) => `${b.id ?? '?'} touched by the agent but lastEditedBy=${b.lastEditedBy ?? 'none'}`);

    const human = observed?.humanTyped?.blockId;
    const humanBy = final.blocks.find((b) => b.id === human)?.lastEditedBy;

    // 06 C3: a block only the human typed in must not carry the agent's id.
    if (human !== undefined && !touched.has(human) && humanBy !== observed?.humanId) {
      problems.push(`${human} only the human typed in, but lastEditedBy=${humanBy ?? 'none'}`);
    }

    if (observed?.journalActors !== undefined && !observed.journalActors.includes(actorId)) {
      problems.push('journal actors do not name the agent');
    }

    return problems.length === 0 ? ok('attribution correct') : no(problems.join('; '));
  },
});

export const ackedOnly = (): Grader => ({
  name: 'ackedOnly',
  check: ({ results, observed }) => {
    const acked = new Set(observed?.serverAckedSequences ?? []);
    const bad = (results ?? []).filter((r) => {
      const d = r.delivery;

      return d !== undefined && d.durable && d.savedVersion === null && (d.serverSequence === null || !acked.has(d.serverSequence));
    });

    return bad.length === 0 ? ok('every durable result was acked') : no(`${bad.length} result(s) reported durable without an ack`);
  },
});

export const leftRoom = (): Grader => ({
  name: 'leftRoom',
  check: ({ actorId, observed }) => {
    const after = observed?.participantsAfterClose;

    if (after === undefined) {
      return no('participants after close were not recorded');
    }

    return after.some((p) => p.id === actorId) ? no('agent still listed after close') : ok('agent left');
  },
});
