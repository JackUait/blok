import { describe, it, expect } from 'vitest';
import { extToPrismLang } from '../../../../src/tools/file/code-languages';

describe('extToPrismLang', () => {
  it('maps common code extensions to Prism language ids', () => {
    expect(extToPrismLang('js')).toBe('javascript');
    expect(extToPrismLang('jsx')).toBe('javascript');
    expect(extToPrismLang('ts')).toBe('typescript');
    expect(extToPrismLang('tsx')).toBe('typescript');
    expect(extToPrismLang('py')).toBe('python');
    expect(extToPrismLang('rb')).toBe('ruby');
    expect(extToPrismLang('go')).toBe('go');
    expect(extToPrismLang('rs')).toBe('rust');
    expect(extToPrismLang('cpp')).toBe('cpp');
    expect(extToPrismLang('h')).toBe('cpp');
    expect(extToPrismLang('cs')).toBe('csharp');
    expect(extToPrismLang('yml')).toBe('yaml');
    expect(extToPrismLang('sh')).toBe('bash');
    expect(extToPrismLang('json')).toBe('json');
    expect(extToPrismLang('html')).toBe('html');
  });

  it('is case-insensitive', () => {
    expect(extToPrismLang('TS')).toBe('typescript');
  });

  it('returns null for unmapped or empty extensions', () => {
    expect(extToPrismLang('xlsx')).toBeNull();
    expect(extToPrismLang('')).toBeNull();
    expect(extToPrismLang('md')).toBeNull();
  });
});
