import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCALES_DIR = resolve(__dirname, '../../../../src/components/i18n/locales');
const TOOLS = ['image', 'video', 'audio', 'file'] as const;

const load = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(LOCALES_DIR, `${locale}.json`), 'utf8')) as Record<string, string>;

const EN_PLACEHOLDER = { image: 'Paste an image link…', video: 'Paste a video link…', audio: 'Paste an audio link…', file: 'Paste a file link…' };
const RU_PLACEHOLDER = { image: 'Вставьте ссылку на изображение…', video: 'Вставьте ссылку на видео…', audio: 'Вставьте ссылку на аудио…', file: 'Вставьте ссылку на файл…' };

describe('media empty-state wording', () => {
  it.each(TOOLS)('English %s: the tabs name where the file comes from, and the button adds it', (tool) => {
    const en = load('en');

    expect([en[`tools.${tool}.emptyUpload`], en[`tools.${tool}.emptyLink`]]).toEqual(['From device', 'From a link']);
    expect(en[`tools.${tool}.emptyUrlPlaceholder`]).toBe(EN_PLACEHOLDER[tool]);
    expect(en[`tools.${tool}.emptyInsert`]).toBe('Add');
  });

  it.each(TOOLS)('Russian %s reads as one sentence with the header', (tool) => {
    const ru = load('ru');

    expect([ru[`tools.${tool}.emptyUpload`], ru[`tools.${tool}.emptyLink`]]).toEqual(['С устройства', 'По ссылке']);
    expect(ru[`tools.${tool}.emptyUrlPlaceholder`]).toBe(RU_PLACEHOLDER[tool]);
    expect(ru[`tools.${tool}.emptyInsert`]).toBe('Добавить');
  });

  it('never gives the two tabs the same label, in any locale', () => {
    const clashes = readdirSync(LOCALES_DIR)
      .filter((file) => file.endsWith('.json'))
      .flatMap((file) => {
        const messages = load(file.replace('.json', ''));
        return TOOLS
          .filter((tool) => messages[`tools.${tool}.emptyUpload`] === messages[`tools.${tool}.emptyLink`])
          .map((tool) => `${file}:${tool}`);
      });

    expect(clashes).toEqual([]);
  });
});
