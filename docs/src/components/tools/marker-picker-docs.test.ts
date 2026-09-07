import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import editorEnglish from '../../../../src/components/i18n/locales/en.json';
import editorRussian from '../../../../src/components/i18n/locales/ru.json';
import english from '../../i18n/en.json';
import russian from '../../i18n/ru.json';
import { TOOL_SECTIONS } from './tools-data';

const cases = [
  {
    name: 'fallback',
    description: TOOL_SECTIONS.find(section => section.id === 'marker')?.description ?? '',
    messages: editorEnglish,
    tab: /tab/,
  },
  { name: 'English', description: english.tools.docs.marker.description, messages: editorEnglish, tab: /tab/ },
  { name: 'Russian', description: russian.tools.docs.marker.description, messages: editorRussian, tab: /вкладк/ },
];

describe('Marker picker instructions', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it.each(cases)('$name describes the tabs using the displayed labels', ({ description, messages, tab }) => {
    expect(description).toMatch(tab);
    expect(description).toContain(messages['tools.marker.textColor']);
    expect(description).toContain(messages['tools.marker.background']);
    expect(description).toContain(messages['tools.marker.default']);
  });
});
