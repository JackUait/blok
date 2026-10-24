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

/** Where the bar opened: over selected text, at a caret, or on a page with no text. */
export type ActionContext = 'selection' | 'caret' | 'empty';

/** A button under the prompt field: its label, the prompt it sends, and an optional icon. */
export interface AssistantAction {
  label: string;
  prompt: string;
  icon?: string;
}

// The prompts are English, so the model would answer in English without this.
const LANGUAGE = 'Write in the language of the document, and reply in it too.';
// The guidance sends questions to the reply; an answer shown in the bar can then be inserted.
const ANSWER_ONLY = 'Do not edit the document.';
const REPLACE = 'Replace the selected text with the result.';

const BUILT_IN: Record<Exclude<ActionContext, 'empty'>, Array<[labelKey: string, icon: string, prompt: string]>> = {
  selection: [
    ['assistant.action.improve', IconAskAiImprove, `Improve the writing of the selected text: clearer and smoother, with the same meaning. ${REPLACE}`],
    ['assistant.action.proofread', IconAskAiProofread, `Fix spelling, grammar and punctuation in the selected text. Change nothing else. ${REPLACE}`],
    ['assistant.action.shorter', IconAskAiShorter, `Make the selected text shorter. Keep its meaning. ${REPLACE}`],
    ['assistant.action.longer', IconAskAiLonger, `Make the selected text longer, with more detail. Keep its meaning. ${REPLACE}`],
    ['assistant.action.simplify', IconAskAiSimplify, `Rewrite the selected text in simpler words. Keep its meaning. ${REPLACE}`],
    ['assistant.action.explain', IconAskAiExplain, `Explain the selected text in your reply. ${ANSWER_ONLY}`],
  ],
  caret: [
    ['assistant.action.summarize', IconAskAiSummarize, `Summarize the whole document in your reply, in a few sentences. ${ANSWER_ONLY}`],
    ['assistant.action.actionItems', IconAskAiActionItems, `List the action items and next steps from the document in your reply, as a Markdown list. ${ANSWER_ONLY}`],
    ['assistant.action.proofread', IconAskAiProofread, 'Fix spelling, grammar and punctuation across the whole document. Change nothing else.'],
    ['assistant.action.continue', IconAskAiContinue, 'Continue writing from the user\'s place, in the same style. Add a paragraph or two.'],
  ],
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

  return BUILT_IN[context].map(([labelKey, icon, prompt]) => ({ label: t(labelKey), icon, prompt: `${prompt} ${LANGUAGE}` }));
};
