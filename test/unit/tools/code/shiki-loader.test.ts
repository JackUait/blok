import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLoadLanguage = vi.fn().mockResolvedValue(undefined);
const mockLoadTheme = vi.fn().mockResolvedValue(undefined);
const mockCodeToTokens = vi.fn().mockReturnValue({
  tokens: [[{ content: 'test', color: '#FF0000', offset: 0 }]],
  fg: '#000000',
  bg: '#FFFFFF',
});
const mockGetLoadedLanguages = vi.fn().mockReturnValue([]);
const mockDispose = vi.fn();

const mockHighlighter = {
  loadLanguage: mockLoadLanguage,
  loadTheme: mockLoadTheme,
  codeToTokens: mockCodeToTokens,
  getLoadedLanguages: mockGetLoadedLanguages,
  dispose: mockDispose,
};

const mockCreateHighlighterCore = vi.fn().mockResolvedValue(mockHighlighter);
const mockCreateJavaScriptRegexEngine = vi.fn().mockReturnValue({});

vi.mock('shiki/core', () => ({
  createHighlighterCore: mockCreateHighlighterCore,
}));

vi.mock('shiki/engine/javascript', () => ({
  createJavaScriptRegexEngine: mockCreateJavaScriptRegexEngine,
}));

vi.mock('@shikijs/themes/one-light', () => ({ default: { name: 'one-light' } }));
vi.mock('@shikijs/themes/vitesse-dark', () => ({ default: { name: 'vitesse-dark' } }));
vi.mock('@shikijs/langs/javascript', () => ({ default: [{ name: 'javascript' }] }));
vi.mock('@shikijs/langs/typescript', () => ({ default: [{ name: 'typescript' }] }));

describe('shiki-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLoadedLanguages.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe('isHighlightable()', () => {
    it('returns true for programming languages', async () => {
      const { isHighlightable } = await import('../../../../src/tools/code/shiki-loader');
      expect(isHighlightable('javascript')).toBe(true);
      expect(isHighlightable('python')).toBe(true);
      expect(isHighlightable('rust')).toBe(true);
    });

    it('returns false for plain text', async () => {
      const { isHighlightable } = await import('../../../../src/tools/code/shiki-loader');
      expect(isHighlightable('plain text')).toBe(false);
    });

    it('returns true for previewable languages', async () => {
      const { isHighlightable } = await import('../../../../src/tools/code/shiki-loader');
      expect(isHighlightable('latex')).toBe(true);
      expect(isHighlightable('mermaid')).toBe(true);
    });
  });

  describe('tokenizeCode()', () => {
    it('lazily creates the shiki highlighter on first call', async () => {
      const { tokenizeCode } = await import('../../../../src/tools/code/shiki-loader');
      expect(mockCreateHighlighterCore).not.toHaveBeenCalled();
      const result = await tokenizeCode('const x = 1', 'javascript');
      expect(mockCreateHighlighterCore).toHaveBeenCalledTimes(1);
      expect(mockCreateJavaScriptRegexEngine).toHaveBeenCalled();
      // Highlighter was initialized with the regex engine
      const initArg = mockCreateHighlighterCore.mock.calls[0][0] as { engine: unknown; themes: unknown[]; langs: unknown[] };
      expect(initArg.engine).toBeDefined();
      expect(initArg.themes).toHaveLength(2);
      expect(result).not.toBeNull();
    });

    it('reuses singleton highlighter across calls', async () => {
      const { tokenizeCode } = await import('../../../../src/tools/code/shiki-loader');
      const result1 = await tokenizeCode('const x = 1', 'javascript');
      const result2 = await tokenizeCode('let y = 2', 'javascript');
      expect(mockCreateHighlighterCore).toHaveBeenCalledTimes(1);
      // Both calls succeed (non-null), proving the singleton is shared
      expect(result1).toBeTruthy();
      expect(result2).toBeTruthy();
    });

    it('loads language on demand before tokenizing', async () => {
      const { tokenizeCode } = await import('../../../../src/tools/code/shiki-loader');
      const result = await tokenizeCode('const x = 1', 'javascript');
      expect(mockLoadLanguage).toHaveBeenCalledTimes(1);
      expect(result).toBeTruthy();
    });

    it('returns dual theme tokens mapped to HighlightToken format', async () => {
      mockCodeToTokens.mockReturnValue({
        tokens: [[{ content: 'const', color: '#A626A4', offset: 0, fontStyle: 0 }]],
        fg: '#383A42',
        bg: '#FAFAFA',
      });

      const { tokenizeCode } = await import('../../../../src/tools/code/shiki-loader');
      const result = await tokenizeCode('const', 'javascript');

      expect(result).not.toBeNull();
      expect(result!.light.tokens[0][0]).toEqual({
        content: 'const',
        color: '#A626A4',
        offset: 0,
      });
      expect(result!.light.fg).toBe('#383A42');
    });

    it('calls codeToTokens twice (once per theme)', async () => {
      const { tokenizeCode } = await import('../../../../src/tools/code/shiki-loader');
      await tokenizeCode('test', 'javascript');
      expect(mockCodeToTokens).toHaveBeenCalledTimes(2);
      expect(mockCodeToTokens).toHaveBeenCalledWith('test', expect.objectContaining({ theme: 'one-light' }));
      expect(mockCodeToTokens).toHaveBeenCalledWith('test', expect.objectContaining({ theme: 'vitesse-dark' }));
    });

    it('returns null for unhighlightable languages', async () => {
      const { tokenizeCode } = await import('../../../../src/tools/code/shiki-loader');
      const result = await tokenizeCode('text', 'plain text');
      expect(result).toBeNull();
      expect(mockCreateHighlighterCore).not.toHaveBeenCalled();
    });

    it('returns null when shiki import fails', async () => {
      mockCreateHighlighterCore.mockRejectedValueOnce(new Error('import failed'));
      const { tokenizeCode } = await import('../../../../src/tools/code/shiki-loader');
      const result = await tokenizeCode('test', 'javascript');
      expect(result).toBeNull();
    });

    it('skips loadLanguage if language is already loaded', async () => {
      mockGetLoadedLanguages.mockReturnValue(['javascript', 'js']);
      const { tokenizeCode } = await import('../../../../src/tools/code/shiki-loader');
      await tokenizeCode('test', 'javascript');
      expect(mockLoadLanguage).not.toHaveBeenCalled();
    });
  });

  describe('disposeHighlighter()', () => {
    it('disposes the singleton highlighter', async () => {
      const { tokenizeCode, disposeHighlighter } = await import('../../../../src/tools/code/shiki-loader');
      await tokenizeCode('test', 'javascript');
      disposeHighlighter();
      expect(mockDispose).toHaveBeenCalled();

      // After dispose, next tokenizeCode should create a new highlighter (proving disposal cleared state)
      const result = await tokenizeCode('test2', 'javascript');
      expect(mockCreateHighlighterCore).toHaveBeenCalledTimes(2);
      expect(result).toBeTruthy();
    });
  });
});
