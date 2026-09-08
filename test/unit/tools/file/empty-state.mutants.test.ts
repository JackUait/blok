import { describe, it, expect, vi, beforeEach } from 'vitest';

const media = vi.hoisted(() => ({ render: vi.fn((_options: unknown) => document.createElement('div')) }));

vi.mock('../../../../src/components/utils/media-empty-state', () => ({
  renderMediaEmptyState: (options: unknown) => media.render(options),
}));

import { renderEmptyState } from '../../../../src/tools/file/empty-state';
import type { I18nInstance } from '../../../../src/components/utils/tools';

interface Passed {
  acceptTypes: string[];
  maxSize?: number;
  sources?: string;
  onFile: unknown;
  onUrl: unknown;
  labels: Record<string, unknown>;
}

const echoI18n = (): I18nInstance => ({ has: () => true, t: (key: string) => `i18n:${key}` });

const passed = (): Passed => media.render.mock.calls[0][0] as Passed;

describe('file empty state mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes every label through the file tool\'s own i18n keys', () => {
    renderEmptyState({ acceptTypes: ['application/pdf'], i18n: echoI18n(), onFile: vi.fn(), onUrl: vi.fn() });

    expect(passed().labels).toStrictEqual({
      add: 'i18n:tools.file.emptyAddFile',
      upload: 'i18n:tools.file.emptyUpload',
      embed: 'i18n:tools.file.emptyLink',
      chooseFile: 'i18n:tools.file.emptyChooseFile',
      orDropHere: 'i18n:tools.file.emptyDropHint',
      dropToUpload: 'i18n:tools.file.emptyDropToUpload',
      urlPlaceholder: 'i18n:tools.file.emptyUrlPlaceholder',
      urlAria: 'i18n:tools.file.emptyUrlAria',
      submit: 'i18n:tools.file.emptyInsert',
      sourceAria: 'i18n:tools.file.emptySourceAria',
    });
  });

  it('passes the accept list, size limit and source choice straight through', () => {
    renderEmptyState({
      acceptTypes: ['application/pdf', 'text/plain'],
      maxSize: 4096,
      sources: 'file',
      i18n: echoI18n(),
      onFile: vi.fn(),
      onUrl: vi.fn(),
    });

    expect(passed().acceptTypes).toStrictEqual(['application/pdf', 'text/plain']);
    expect(passed().maxSize).toBe(4096);
    expect(passed().sources).toBe('file');
  });

  it('hands the callbacks on unwrapped', () => {
    const onFile = vi.fn();
    const onUrl = vi.fn();

    renderEmptyState({ acceptTypes: [], i18n: echoI18n(), onFile, onUrl });

    expect(passed().onFile).toBe(onFile);
    expect(passed().onUrl).toBe(onUrl);
  });

  it('returns whatever the shared empty state built', () => {
    const built = document.createElement('section');

    media.render.mockReturnValueOnce(built);

    expect(renderEmptyState({ acceptTypes: [], i18n: echoI18n(), onFile: vi.fn(), onUrl: vi.fn() })).toBe(built);
  });
});
