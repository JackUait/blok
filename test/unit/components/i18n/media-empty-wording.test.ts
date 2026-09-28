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

describe('media empty-state Upload tab wording', () => {
  const HINT_KEY = { image: 'emptyOrDropHere', video: 'emptyOrDropHere', audio: 'emptyOrDropHere', file: 'emptyDropHint' } as const;
  const EN_CHOOSE = { image: 'Choose an image', video: 'Choose a video', audio: 'Choose audio', file: 'Choose a file' };
  const RU_CHOOSE = { image: 'Выбрать изображение', video: 'Выбрать видео', audio: 'Выбрать аудио', file: 'Выбрать файл' };

  it.each(TOOLS)('English %s: the button names the thing and the hint points back at it', (tool) => {
    const en = load('en');

    expect(en[`tools.${tool}.emptyChooseFile`]).toBe(EN_CHOOSE[tool]);
    expect(en[`tools.${tool}.${HINT_KEY[tool]}`]).toBe('or drag it here');
    expect(en[`tools.${tool}.emptyDropToUpload`]).toBe('Drop to add');
  });

  it.each(TOOLS)('Russian %s speaks the card\'s one verb', (tool) => {
    const ru = load('ru');

    expect(ru[`tools.${tool}.emptyChooseFile`]).toBe(RU_CHOOSE[tool]);
    expect(ru[`tools.${tool}.${HINT_KEY[tool]}`]).toBe('или перетащите его сюда');
    expect(ru[`tools.${tool}.emptyDropToUpload`]).toBe('Отпустите, чтобы добавить');
  });
});
