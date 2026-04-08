import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectLanguage, DETECTION_CANDIDATE_LANGUAGES } from '../../../../src/tools/code/language-detector';

// Mock shiki-loader so tests don't need the actual shiki runtime
vi.mock('../../../../src/tools/code/shiki-loader', () => ({
  tokenizeCode: vi.fn(),
}));

import { tokenizeCode } from '../../../../src/tools/code/shiki-loader';
const mockTokenizeCode = vi.mocked(tokenizeCode);

describe('detectLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for code shorter than 20 characters', async () => {
    const result = await detectLanguage('const x = 1');
    expect(result).toBeNull();
    expect(mockTokenizeCode).not.toHaveBeenCalled();
  });

  it('returns null when tokenizeCode returns null for all languages', async () => {
    mockTokenizeCode.mockResolvedValue(null);
    const result = await detectLanguage('const x = 1;\nconst y = 2;\nfunction foo() {}');
    expect(result).toBeNull();
  });

  it('returns the language with the lowest fg-token ratio', async () => {
    const FG_COLOR = '#383a42';
    const KEYWORD_COLOR = '#a626a4';

    mockTokenizeCode.mockImplementation(async (_code, lang) => {
      if (lang === 'javascript') {
        return {
          light: {
            fg: FG_COLOR,
            tokens: [[
              { content: 'const', color: KEYWORD_COLOR, offset: 0 },
              { content: ' x ', color: FG_COLOR, offset: 5 },
              { content: '=', color: KEYWORD_COLOR, offset: 8 },
              { content: ' 1', color: '#986801', offset: 10 },
            ]],
          },
          dark: { fg: '#dbd7ca', tokens: [] },
        };
      }
      if (lang === 'python') {
        return {
          light: {
            fg: FG_COLOR,
            tokens: [[
              { content: 'const x = 1', color: FG_COLOR, offset: 0 },
            ]],
          },
          dark: { fg: '#dbd7ca', tokens: [] },
        };
      }
      return null;
    });

    const result = await detectLanguage('const x = 1;\nconst y = 2;\nfunction foo() { return x + y; }');
    expect(result).toBe('javascript');
  });

  it('returns null when no language scores significantly better than plain text', async () => {
    const FG_COLOR = '#383a42';
    mockTokenizeCode.mockResolvedValue({
      light: {
        fg: FG_COLOR,
        tokens: [[{ content: 'some ambiguous text here and more text', color: FG_COLOR, offset: 0 }]],
      },
      dark: { fg: '#dbd7ca', tokens: [] },
    });

    const result = await detectLanguage('some ambiguous text here and more text that is long enough');
    expect(result).toBeNull();
  });

  it('returns null when a language uses fewer than 2 distinct non-fg colors (false positive guard)', async () => {
    const FG_COLOR = '#383a42';
    const STRING_COLOR = '#50a14f'; // YAML-like: colorizes everything as one type

    mockTokenizeCode.mockImplementation(async (_code, lang) => {
      if (lang === 'yaml') {
        // Simulates YAML treating code as block scalars — low fg-ratio but only 1 non-fg color
        return {
          light: {
            fg: FG_COLOR,
            tokens: [[
              { content: 'const x = 1;', color: STRING_COLOR, offset: 0 },
              { content: 'function foo() {', color: STRING_COLOR, offset: 13 },
              { content: '  ', color: FG_COLOR, offset: 30 },
              { content: 'return x;', color: STRING_COLOR, offset: 32 },
              { content: '}', color: FG_COLOR, offset: 42 },
            ]],
          },
          dark: { fg: '#dbd7ca', tokens: [] },
        };
      }
      return null;
    });

    // YAML would win on raw fg-ratio (0.075) but should be rejected due to only 1 non-fg color
    const result = await detectLanguage('const x = 1;\nfunction foo() {\n  return x;\n}');
    expect(result).toBeNull();
  });

  it('exports the candidate language list', () => {
    expect(DETECTION_CANDIDATE_LANGUAGES).toContain('javascript');
    expect(DETECTION_CANDIDATE_LANGUAGES).toContain('python');
    expect(DETECTION_CANDIDATE_LANGUAGES.length).toBeGreaterThanOrEqual(10);
  });
});
