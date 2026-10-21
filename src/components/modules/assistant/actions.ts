import type { AgentAssistantAction } from '../../../../types/api';

/** Where the bar opened: over selected text, at a caret, or on a page with no text. */
export type ActionContext = 'selection' | 'caret' | 'empty';

/** A button under the prompt field: its label, and the prompt it sends. */
export interface AssistantAction {
  label: string;
  prompt: string;
}

// The prompts are English, so the model would answer in English without this.
const LANGUAGE = 'Write in the language of the document, and reply in it too.';
// The guidance sends questions to the reply; an answer shown in the bar can then be inserted.
const ANSWER_ONLY = 'Do not edit the document.';
const REPLACE = 'Replace the selected text with the result.';

const BUILT_IN: Record<Exclude<ActionContext, 'empty'>, Array<[labelKey: string, prompt: string]>> = {
  selection: [
    ['assistant.action.improve', `Improve the writing of the selected text: clearer and smoother, with the same meaning. ${REPLACE}`],
    ['assistant.action.proofread', `Fix spelling, grammar and punctuation in the selected text. Change nothing else. ${REPLACE}`],
    ['assistant.action.shorter', `Make the selected text shorter. Keep its meaning. ${REPLACE}`],
    ['assistant.action.longer', `Make the selected text longer, with more detail. Keep its meaning. ${REPLACE}`],
    ['assistant.action.simplify', `Rewrite the selected text in simpler words. Keep its meaning. ${REPLACE}`],
    ['assistant.action.explain', `Explain the selected text in your reply. ${ANSWER_ONLY}`],
  ],
  caret: [
    ['assistant.action.summarize', `Summarize the whole document in your reply, in a few sentences. ${ANSWER_ONLY}`],
    ['assistant.action.actionItems', `List the action items and next steps from the document in your reply, as a Markdown list. ${ANSWER_ONLY}`],
    ['assistant.action.proofread', 'Fix spelling, grammar and punctuation across the whole document. Change nothing else.'],
    ['assistant.action.continue', 'Continue writing from the user\'s place, in the same style. Add a paragraph or two.'],
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

    return host.filter(fits).map(({ label, prompt }) => ({ label, prompt }));
  }
  if (context === 'empty') {
    return [];
  }

  return BUILT_IN[context].map(([labelKey, prompt]) => ({ label: t(labelKey), prompt: `${prompt} ${LANGUAGE}` }));
};
