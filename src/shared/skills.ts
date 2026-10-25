/**
 * Ask AI's built-in skills. Ask AI shows them as buttons and @bloklabs/mcp serves them as prompts,
 * so both send the same prompt text.
 */

/** Where a skill works: on selected text, or at a caret on the whole document. */
export type SkillContext = 'selection' | 'caret';

export type SkillId =
  | 'improve' | 'proofread' | 'shorter' | 'longer' | 'simplify' | 'explain'
  | 'summarize' | 'actionItems' | 'continue';

export interface AgentSkill {
  /** Ask AI's label key is `assistant.action.<id>`; the MCP prompt name is the id. */
  id: SkillId;
  /** The English label, as in the en locale. */
  label: string;
  /** The request per context the skill works in. */
  prompts: Partial<Record<SkillContext, string>>;
}

// The prompts are English, so the model would answer in English without this.
export const SKILL_LANGUAGE = 'Write in the language of the document, and reply in it too.';
// The guidance sends questions to the reply; an answer shown in the bar can then be inserted.
const ANSWER_ONLY = 'Do not edit the document.';
const REPLACE = 'Replace the selected text with the result.';

export const AGENT_SKILLS: readonly AgentSkill[] = [
  { id: 'improve', label: 'Improve writing', prompts: { selection: `Improve the writing of the selected text: clearer and smoother, with the same meaning. ${REPLACE}` } },
  {
    id: 'proofread',
    label: 'Fix spelling and grammar',
    prompts: {
      selection: `Fix spelling, grammar and punctuation in the selected text. Change nothing else. ${REPLACE}`,
      caret: 'Fix spelling, grammar and punctuation across the whole document. Change nothing else.',
    },
  },
  { id: 'shorter', label: 'Make shorter', prompts: { selection: `Make the selected text shorter. Keep its meaning. ${REPLACE}` } },
  { id: 'longer', label: 'Make longer', prompts: { selection: `Make the selected text longer, with more detail. Keep its meaning. ${REPLACE}` } },
  { id: 'simplify', label: 'Simplify language', prompts: { selection: `Rewrite the selected text in simpler words. Keep its meaning. ${REPLACE}` } },
  { id: 'explain', label: 'Explain', prompts: { selection: `Explain the selected text in your reply. ${ANSWER_ONLY}` } },
  { id: 'summarize', label: 'Summarize', prompts: { caret: `Summarize the whole document in your reply, in a few sentences. ${ANSWER_ONLY}` } },
  { id: 'actionItems', label: 'Find action items', prompts: { caret: `List the action items and next steps from the document in your reply, as a Markdown list. ${ANSWER_ONLY}` } },
  { id: 'continue', label: 'Continue writing', prompts: { caret: 'Continue writing from the user\'s place, in the same style. Add a paragraph or two.' } },
];

/** The order Ask AI shows the skills in, per context. */
const ORDER: Record<SkillContext, readonly SkillId[]> = {
  selection: ['improve', 'proofread', 'shorter', 'longer', 'simplify', 'explain'],
  caret: ['summarize', 'actionItems', 'proofread', 'continue'],
};

/** The full request a skill sends in a context: its sentence plus the language rule. */
export const skillPrompt = (skill: AgentSkill, context: SkillContext): string | undefined => {
  const prompt = skill.prompts[context];

  return prompt === undefined ? undefined : `${prompt} ${SKILL_LANGUAGE}`;
};

/** The skills for one context, in Ask AI's order, with their full requests. */
export const skillsFor = (context: SkillContext): Array<{ skill: AgentSkill; prompt: string }> =>
  ORDER[context].flatMap((id) => {
    const skill = AGENT_SKILLS.find((candidate) => candidate.id === id);
    const prompt = skill === undefined ? undefined : skillPrompt(skill, context);

    return skill === undefined || prompt === undefined ? [] : [{ skill, prompt }];
  });
