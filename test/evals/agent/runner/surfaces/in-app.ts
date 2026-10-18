import { composeGuidance } from '../../../../../src/agent/guidance';
import { renderAgentTools } from '../../../../../src/agent/render-tools';
import { nodeContract, openJsonSession } from '../../../../unit/agent/harness';
import type { AgentResult, DocumentView } from '../../../../../types/agent';
import type { ExecuteResult } from '../../types';
import type { OpenSurface } from '../run-task';
import { asAnthropicTool } from '../run-task';

const EVAL_ACTOR = { id: 'agent-eval', name: 'Eval agent', kind: 'agent' } as const;

/**
 * The model's tool input is unchecked JSON. The session validates every
 * argument itself, so this view only widens the parameter types.
 */
interface UncheckedSession {
  read(args: unknown): Promise<DocumentView>;
  describe(query: unknown): unknown;
  execute(batch: unknown): Promise<AgentResult>;
}

/** In-app tasks run in Node behind the same three tools the browser renders (05 §3.3.4). */
export const openInApp: OpenSurface = async (task, schema) => {
  const session = openJsonSession(task.seed, EVAL_ACTOR);
  const unchecked: UncheckedSession = session;
  const results: ExecuteResult[] = [];
  const contract = nodeContract('node');
  const tools = renderAgentTools(contract, { format: 'anthropic', schema: schema === 'shipped' ? 'mixed' : schema })
    .map((tool) => asAnthropicTool({
      name: tool.name,
      description: tool.description,
      schema: 'input_schema' in tool ? tool.input_schema : {},
    }));

  return {
    tools,
    system: composeGuidance(contract),
    execute: async (name, input) => {
      if (name === 'blok_read') {
        return { content: JSON.stringify(await unchecked.read(input)), isError: false };
      }

      if (name === 'blok_describe') {
        return { content: JSON.stringify(unchecked.describe(input)), isError: false };
      }

      if (name === 'blok_execute') {
        const result = await unchecked.execute(input);

        results.push(result);

        return { content: JSON.stringify(result), isError: false };
      }

      return { content: `Unknown tool ${name}`, isError: true };
    },
    finish: async () => ({ final: session.output(), log: [...session.log()], results, actorId: EVAL_ACTOR.id }),
    close: async () => session.close(),
  };
};
