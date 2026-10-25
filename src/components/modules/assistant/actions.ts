import type { AgentAssistantAction } from '../../../../types/api';
import {
  IconAskAiActionItems,
  IconAskAiContinue,
  IconAskAiExplain,
  IconAskAiImprove,
  IconAskAiLonger,
  IconAskAiProofread,
  IconAskAiShorter,
  IconAskAiSimplify,
  IconAskAiSummarize,
} from '../../icons';
import { skillsFor } from '../../../shared/skills';
import type { SkillId } from '../../../shared/skills';

/** Where the bar opened: over selected text, at a caret, or on a page with no text. */
export type ActionContext = 'selection' | 'caret' | 'empty';

/** A button under the prompt field: its label, the prompt it sends, and an optional icon. */
export interface AssistantAction {
  label: string;
  prompt: string;
  icon?: string;
}

const ICONS: Record<SkillId, string> = {
  improve: IconAskAiImprove,
  proofread: IconAskAiProofread,
  shorter: IconAskAiShorter,
  longer: IconAskAiLonger,
  simplify: IconAskAiSimplify,
  explain: IconAskAiExplain,
  summarize: IconAskAiSummarize,
  actionItems: IconAskAiActionItems,
  continue: IconAskAiContinue,
};

/**
 * The actions the bar offers where it opened.
 * @param context - where the bar opened
 * @param t - translates a label key
 * @param host - the host's list, which replaces the built-in one; [] shows none
 */
export const assistantActions = (
  context: ActionContext,
  t: (key: string) => string,
  host?: readonly AgentAssistantAction[]
): AssistantAction[] => {
  if (host !== undefined) {
    // A caret action fits an empty page as well: it may draft from nothing.
    const fits = (action: AgentAssistantAction): boolean => action.context === undefined
      || action.context === (context === 'selection' ? 'selection' : 'caret');

    return host.filter(fits).map(({ label, prompt, icon }) => ({ label, prompt, icon }));
  }
  if (context === 'empty') {
    return [];
  }

  return skillsFor(context).map(({ skill, prompt }) => ({ label: t(`assistant.action.${skill.id}`), icon: ICONS[skill.id], prompt }));
};
