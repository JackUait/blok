import type { AgentTurnOptions } from '../../../../types/api';
import type { HostService } from '../../../../types/tools/tool-description';
import type { ContractSource, createEditorAgentSession } from '../agent/editor-session';

export type EditorSessionOptions = NonNullable<Parameters<typeof createEditorAgentSession>[2]>;

/**
 * The session options Ask AI's begin() opens a turn with. The editor parity
 * runner uses them too, so the corpus runs the way Ask AI does.
 */
export const askAiSessionOptions = (input: {
  contractSource: ContractSource;
  services: Partial<Record<HostService, unknown>>;
  attributeTo?: AgentTurnOptions['attributeTo'];
  onPrepared?: EditorSessionOptions['onPrepared'];
  onPagePointed?: EditorSessionOptions['onPagePointed'];
}): EditorSessionOptions => ({
  contractSource: input.contractSource,
  services: input.services,
  // One native undo step per turn, for the user's Cmd+Z and Discard.
  mergeSteps: 'turn',
  attributeLastEditedBy: input.attributeTo !== 'user',
  onPrepared: input.onPrepared,
  onPagePointed: input.onPagePointed,
});
