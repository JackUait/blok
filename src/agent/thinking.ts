import type { AgentAssistantConfig, AgentThinkingLevel } from '../../types/api';

export const THINKING_LEVELS: readonly AgentThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

export interface ThinkingChoice {
  levels: AgentThinkingLevel[];
  initial: AgentThinkingLevel;
}

export const isThinkingLevel = (value: unknown): value is AgentThinkingLevel =>
  typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value);

/**
 * Checks `agent.assistant.thinking`. Throws TypeError on a bad config.
 * Called from editor.agent.ask(), not from module prepare: core swallows prepare errors.
 * @param thinking - the host's setting
 */
export function readThinkingConfig(thinking: AgentAssistantConfig['thinking']): ThinkingChoice | null {
  if (thinking === undefined) {
    return null;
  }

  const levels: unknown = thinking.levels;

  if (!Array.isArray(levels) || levels.length === 0) {
    throw new TypeError('agent.assistant.thinking.levels needs at least one level.');
  }

  const unknownLevels: unknown[] = levels.filter((level: unknown) => !isThinkingLevel(level));

  if (unknownLevels.length > 0) {
    throw new TypeError(`agent.assistant.thinking.levels has an unknown level: ${String(unknownLevels[0])}. Use ${THINKING_LEVELS.join(', ')}.`);
  }
  if (new Set(levels).size !== levels.length) {
    throw new TypeError('agent.assistant.thinking.levels lists a level twice.');
  }

  const valid = levels.filter(isThinkingLevel);
  const initial = thinking.default ?? valid[0];

  if (!valid.includes(initial)) {
    throw new TypeError('agent.assistant.thinking.default must be one of thinking.levels.');
  }

  return { levels: valid, initial };
}
