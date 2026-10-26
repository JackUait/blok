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

/** A create action that sends one file's bytes through the host's file uploader. */
export const fileUploadAction = (what: string): ToolActionDeclaration => ({
  name: 'uploadFile',
  summary: `Upload a file and insert it as ${what}, as a person's upload does.`,
  guidance: 'Pass the bytes as base64 data with a fileName, or a path when the host reads local files. '
    + 'The file name\'s extension sets the type. The host\'s type and size limits apply. '
    + 'To replace a block\'s file, upload a new block and delete the old one.',
  target: 'create',
  effects: 'host',
  uses: ['uploader'],
  preconditions: ['Send it alone in its batch.'],
  args: {
    type: 'object',
    additionalProperties: false,
    properties: {
      data: { type: 'string', description: 'The file\'s bytes as standard base64. Not with path.' },
      path: { type: 'string', minLength: 1, maxLength: 4096, description: 'A file the host lets the agent read, relative to its upload folder. Not with data.' },
      fileName: { type: 'string', minLength: 1, maxLength: 255, description: 'Needed with data. Defaults to the path\'s name.' },
      mimeType: { type: 'string', description: 'Optional. Must match the type the file name\'s extension gives.' },
    },
  },
  result: {
    type: 'object',
    required: ['id', 'childIds'],
    properties: { id: { type: 'string' }, childIds: { type: 'array', items: { type: 'string' } } },
  },
  mirrors: [],
});
