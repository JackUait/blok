import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectLanguage, DETECTION_CANDIDATE_LANGUAGES } from '../../../../src/tools/code/language-detector';

// Mock prism-loader so tests don't need the actual Prism runtime
vi.mock('../../../../src/tools/code/prism-loader', () => ({
  tokenizePrism: vi.fn(),
}));

import { tokenizePrism } from '../../../../src/tools/code/prism-loader';
const mockTokenizePrism = vi.mocked(tokenizePrism);

describe('detectLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for code shorter than 20 characters', async () => {
    const result = await detectLanguage('const x = 1');
    expect(result).toBeNull();
    expect(mockTokenizePrism).not.toHaveBeenCalled();
  });

  it('returns null when tokenizePrism returns null for all languages', async () => {
    mockTokenizePrism.mockResolvedValue(null);
    const result = await detectLanguage('const x = 1;\nconst y = 2;\nfunction foo() {}');
    expect(result).toBeNull();
  });

  it('returns the language with the most diverse token types', async () => {
    mockTokenizePrism.mockImplementation(async (_code, lang) => {
      if (lang === 'javascript') {
        // Rich token diversity: keyword, string, punctuation, operator
        return '<span class="token keyword">const</span> <span class="token string">"hello"</span> <span class="token operator">=</span> <span class="token punctuation">(</span>';
      }
      if (lang === 'python') {
        // Poor token diversity: only one token type
        return '<span class="token keyword">const</span>';
      }
      return null;
    });

    const result = await detectLanguage('const x = 1;\nconst y = 2;\nfunction foo() { return x + y; }');
    expect(result).toBe('javascript');
  });

  it('returns null when no language scores significantly better than plain text', async () => {
    // All languages produce no token spans (plain text / unrecognized)
    mockTokenizePrism.mockResolvedValue('some plain text with no spans');

    const result = await detectLanguage('some ambiguous text here and more text that is long enough');
    expect(result).toBeNull();
  });

  it('returns null when a language uses fewer than 2 distinct token types (false positive guard)', async () => {
    mockTokenizePrism.mockImplementation(async (_code, lang) => {
      if (lang === 'yaml') {
        // YAML treats everything as a single token type (string) — false positive guard
        return '<span class="token string">const x = 1;</span><span class="token string">function foo() {</span><span class="token string">return x;</span>';
      }
      return null;
    });

    const result = await detectLanguage('const x = 1;\nfunction foo() {\n  return x;\n}');
    expect(result).toBeNull();
  });

  it('exports the candidate language list', () => {
    expect(DETECTION_CANDIDATE_LANGUAGES).toContain('javascript');
    expect(DETECTION_CANDIDATE_LANGUAGES).toContain('python');
    expect(DETECTION_CANDIDATE_LANGUAGES.length).toBeGreaterThanOrEqual(10);
  });
});
