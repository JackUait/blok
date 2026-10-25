import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';

import type { GetPromptResult, Prompt } from '@modelcontextprotocol/server';

import { AGENT_SKILLS, skillPrompt } from '../shared/skills';
import type { AgentSkill, SkillContext } from '../shared/skills';

/** What an MCP client's model does on top of a skill's request; Ask AI's editor does this for its model. */
export const MCP_SKILL_STEPS = 'Use the Blok tools: open the document with blok_open (pass write: true if you will edit it), '
  + 'read it with blok_read, find the text the request is about with the doc.find command in blok_execute, '
  + 'and make every edit with blok_execute.';

const argumentsOf = (skill: AgentSkill): NonNullable<Prompt['arguments']> => [
  { name: 'documentId', description: 'The Blok document to work on. Without it, blok_open lists the documents to choose from.', required: false },
  ...(skill.prompts.selection === undefined ? [] : [{
    name: 'selection',
    description: 'The selected text, word for word.',
    // A skill that also works at a caret runs on the whole document without one.
    required: skill.prompts.caret === undefined,
  }]),
  { name: 'blockId', description: skill.prompts.selection === undefined ? 'The block where the user is.' : 'The block the selected text is in.', required: false },
];

/** Every Ask AI skill as an MCP prompt, named by its id. */
export const listMcpPrompts = (): Prompt[] => AGENT_SKILLS.map(skill => ({
  name: skill.id,
  description: skill.label,
  arguments: argumentsOf(skill),
}));

// The MCP form of Ask AI's "(Editor context: ...)" line.
const contextLine = (context: SkillContext, selection: string | undefined, blockId: string | undefined): string | undefined => {
  const block = blockId === undefined ? '' : ` in block ${blockId}`;

  if (context === 'selection') {
    return `(Context: the user selected this text${block}: ${JSON.stringify(selection)}. "This" in the request means that text.)`;
  }

  return blockId === undefined
    ? undefined
    : `(Context: the user's place is block ${blockId}.) Write new content right after this block unless the request names another place.`;
};

/** The messages for one skill, from the prompt arguments the client sent. */
export const getMcpPrompt = (name: string, args: Record<string, string> = {}): GetPromptResult => {
  const skill = AGENT_SKILLS.find(candidate => candidate.id === name);

  if (skill === undefined) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown prompt: ${name}`);
  }
  const selection = args.selection === '' ? undefined : args.selection;
  const context: SkillContext = selection !== undefined && skill.prompts.selection !== undefined ? 'selection' : 'caret';
  const request = skillPrompt(skill, context);

  if (request === undefined) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Prompt ${name} needs the selection argument.`);
  }
  const documentId = args.documentId === '' ? undefined : args.documentId;
  const text = [
    request,
    contextLine(context, selection, args.blockId === '' ? undefined : args.blockId),
    documentId === undefined ? undefined : `Work in the Blok document with documentId ${JSON.stringify(documentId)}.`,
    MCP_SKILL_STEPS,
  ].filter(line => line !== undefined).join('\n\n');

  return {
    description: skill.label,
    messages: [{ role: 'user', content: { type: 'text', text } }],
  };
};
