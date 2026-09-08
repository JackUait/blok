import { describe, it, expect, vi, beforeEach } from 'vitest';

const media = vi.hoisted(() => ({ render: vi.fn((_options: unknown) => document.createElement('div')) }));

vi.mock('../../../../src/components/utils/media-empty-state', () => ({
  renderMediaEmptyState: (options: unknown) => media.render(options),
}));

import { renderEmptyState } from '../../../../src/tools/image/empty-state';
import { DEFAULT_MIME_TYPES } from '../../../../src/tools/image/constants';
import type { I18nInstance } from '../../../../src/components/utils/tools';

interface Passed {
  acceptTypes: string[];
  maxSize?: number;
  sources?: string;
  labels: Record<string, unknown>;
}

/**
 * Answers only for keys it really holds and echoes the interpolation params —
 * a stub that says yes to everything cannot tell a mutated key from the real
 * one, and one that drops params cannot see the size go missing.
 */
const echoI18n = (): I18nInstance => ({
  has: (key: string) => key.startsWith('tools.image.'),
  t: (key: string, params?: Record<string, unknown>) =>
    (params === undefined ? `i18n:${key}` : `i18n:${key}:${JSON.stringify(params)}`),
});

const passed = (): Passed => media.render.mock.calls[0][0] as Passed;

describe('image empty state mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes every label through i18n', () => {
    renderEmptyState({ onFile: vi.fn(), onUrl: vi.fn(), i18n: echoI18n() });

    expect(passed().labels).toMatchObject({
      add: 'i18n:tools.image.emptyAddImage',
      upload: 'i18n:tools.image.emptyUpload',
      embed: 'i18n:tools.image.emptyLink',
      chooseFile: 'i18n:tools.image.emptyChooseFile',
      orDropHere: 'i18n:tools.image.emptyOrDropHere',
      dropToUpload: 'i18n:tools.image.emptyDropToUpload',
      urlPlaceholder: 'i18n:tools.image.emptyUrlPlaceholder',
      urlAria: 'i18n:tools.image.emptyUrlAria',
      submit: 'i18n:tools.image.emptyInsert',
      sourceAria: 'i18n:tools.image.emptySourceAria',
    });
  });

  it('lets the caller override the four labels it may pass itself', () => {
    renderEmptyState({
      onFile: vi.fn(),
      onUrl: vi.fn(),
      i18n: echoI18n(),
      uploadLabel: 'Mine upload',
      embedLabel: 'Mine embed',
      embedPlaceholder: 'Mine placeholder',
      submitLabel: 'Mine submit',
    });

    expect(passed().labels).toMatchObject({
      upload: 'Mine upload',
      embed: 'Mine embed',
      urlPlaceholder: 'Mine placeholder',
      submit: 'Mine submit',
      add: 'i18n:tools.image.emptyAddImage',
    });
  });

  it('accepts the image mime types by default', () => {
    renderEmptyState({ onFile: vi.fn(), onUrl: vi.fn(), i18n: echoI18n() });

    expect(passed().acceptTypes).toStrictEqual([...DEFAULT_MIME_TYPES]);
  });

  it('prefers the caller\'s accept list over the default', () => {
    renderEmptyState({ onFile: vi.fn(), onUrl: vi.fn(), acceptTypes: ['image/avif'], i18n: echoI18n() });

    expect(passed().acceptTypes).toStrictEqual(['image/avif']);
  });

  it('passes the size limit and the source choice straight through', () => {
    renderEmptyState({ onFile: vi.fn(), onUrl: vi.fn(), maxSize: 1234, sources: 'url', i18n: echoI18n() });

    expect(passed().maxSize).toBe(1234);
    expect(passed().sources).toBe('url');
  });

  it('hands the callbacks on unwrapped, so the picker calls the tool directly', () => {
    const onFile = vi.fn();
    const onUrl = vi.fn();

    renderEmptyState({ onFile, onUrl, i18n: echoI18n() });

    const options = media.render.mock.calls[0][0] as { onFile: unknown; onUrl: unknown };

    expect(options.onFile).toBe(onFile);
    expect(options.onUrl).toBe(onUrl);
  });

  describe('the max-size label', () => {
    const sizeLabel = (i18n?: I18nInstance): string => {
      renderEmptyState({ onFile: vi.fn(), onUrl: vi.fn(), i18n });

      const build = passed().labels.maxSize as (size: string) => string;

      return build('2 MB');
    };

    it('goes through i18n when the host has the key, carrying the size', () => {
      expect(sizeLabel(echoI18n())).toBe('i18n:tools.image.emptyMaxSize:{"size":"2 MB"}');
    });

    it('falls back to an English phrase carrying the size', () => {
      expect(sizeLabel({ has: () => false, t: (key: string) => key })).toBe('max 2 MB');
    });

    it('falls back with no i18n instance at all', () => {
      expect(sizeLabel(undefined)).toBe('max 2 MB');
    });
  });
});
