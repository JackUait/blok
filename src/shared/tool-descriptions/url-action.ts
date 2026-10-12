import type { ToolActionDeclaration } from '../../../types/tools/tool-description';

/** A media action that takes one http(s) URL and re-hosts it through the uploader when there is one. */
export const urlSourceAction = (name: string, summary: string): ToolActionDeclaration => ({
  name,
  summary,
  guidance: 'http(s) URLs only. When the host has an uploader the file is copied to the host first.',
  target: 'block',
  uses: ['uploader'],
  args: {
    type: 'object',
    required: ['url'],
    additionalProperties: false,
    properties: { url: { type: 'string', pattern: '^https?://' } },
  },
  mirrors: [],
});
