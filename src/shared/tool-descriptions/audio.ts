import type { BlockToolDescription, ToolActionDeclaration } from '../../../types/tools/tool-description';
import { ALIGNMENT } from './rich-text';
import { urlSourceAction } from './url-action';

export const AUDIO_DATA = {
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: {
    url: { type: 'string' },
    caption: { type: 'string' },
    captionVisible: { type: 'boolean' },
    title: { type: 'string' },
    artist: { type: 'string' },
    coverUrl: { type: 'string' },
    loop: { type: 'boolean' },
    width: { type: 'number', minimum: 10, maximum: 100 },
    alignment: { type: 'string', enum: ALIGNMENT },
    fileName: { type: 'string' },
    mimeType: { type: 'string' },
    duration: { type: 'number', description: 'Seconds.' },
    peaks: { type: 'array', items: { type: 'number' }, description: 'Precomputed waveform samples.' },
  },
};

export const AUDIO_ACTIONS: ToolActionDeclaration[] = [
  urlSourceAction('setSource', 'Set or replace the audio from a URL.'),
  urlSourceAction('setCover', 'Set the cover picture from a URL.'),
];

export const describeAudio = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'An audio player with optional title, artist and cover.',
  guidance: 'Set the source with audio.setSource and the cover with audio.setCover. Remove the cover by writing coverUrl as "". caption, title and artist are plain text.',
  data: AUDIO_DATA,
  inputFields: ['title', 'artist', 'caption'],
  summaryFields: ['title', 'artist', 'alignment'],
  actions: AUDIO_ACTIONS,
});
