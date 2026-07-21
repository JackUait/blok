import { describe, it, expect } from 'vitest';
import {
  EMBED_SERVICES,
  matchEmbedService,
  resolveEmbedServiceTitle,
} from '../../../../src/tools/link/registry';

/**
 * The closed set of link-type categories a registry service may declare.
 * Mirrored here (instead of imported) so the test pins the contract.
 */
const KNOWN_TYPES = [
  'video',
  'audio',
  'image',
  'social',
  'document',
  'table',
  'form',
  'code',
  'design',
  'chart',
  'map',
  'calendar',
];

describe('embed service display metadata', () => {
  it('gives every service a non-empty display title', () => {
    Object.entries(EMBED_SERVICES).forEach(([key, service]) => {
      expect(service.title, `service "${key}" has no title`).toBeTypeOf('string');
      expect(service.title.trim().length, `service "${key}" has a blank title`).toBeGreaterThan(0);
    });
  });

  it('gives every service a type from the known category set', () => {
    Object.entries(EMBED_SERVICES).forEach(([key, service]) => {
      expect(KNOWN_TYPES, `service "${key}" has unknown type "${service.type}"`).toContain(service.type);
    });
  });

  it('exposes the YouTube title and video type on a match', () => {
    const match = matchEmbedService('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(match?.title).toBe('YouTube');
    expect(match?.type).toBe('video');
  });

  it('exposes the Spotify title and audio type on a match', () => {
    const match = matchEmbedService('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');

    expect(match?.title).toBe('Spotify');
    expect(match?.type).toBe('audio');
  });

  it('exposes the Figma title and design type on a match', () => {
    const match = matchEmbedService('https://www.figma.com/design/KEY123/My-File');

    expect(match?.title).toBe('Figma');
    expect(match?.type).toBe('design');
  });

  it('exposes the CodePen title and code type on a match', () => {
    const match = matchEmbedService('https://codepen.io/team/pen/AbCdEf');

    expect(match?.title).toBe('CodePen');
    expect(match?.type).toBe('code');
  });

  it.each([
    ['googledrive', 'Google ドライブ'],
    ['googledrivefolder', 'Google ドライブ'],
    ['googledocspublished', 'Google ドキュメント'],
    ['googledocs', 'Google ドキュメント'],
    ['googlesheets', 'Google スプレッドシート'],
    ['googleslides', 'Google スライド'],
    ['googleforms', 'Google フォーム'],
  ])('resolves the official Japanese title for %s', (serviceId, expected) => {
    expect(resolveEmbedServiceTitle(EMBED_SERVICES[serviceId], 'ja')).toBe(expected);
  });

  it('keeps canonical titles when no localized title is available', () => {
    expect(resolveEmbedServiceTitle(EMBED_SERVICES.googledrive)).toBe('Google Drive');
    expect(resolveEmbedServiceTitle(EMBED_SERVICES.googledrive, 'en')).toBe('Google Drive');
    expect(resolveEmbedServiceTitle(EMBED_SERVICES.youtube, 'ja')).toBe('YouTube');
  });
});
