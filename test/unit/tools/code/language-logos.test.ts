import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { LANGUAGE_LOGOS } from '../../../../src/tools/code/language-logos';
import { LANGUAGES } from '../../../../src/tools/code/constants';

const NOTICE = readFileSync(resolve(__dirname, '../../../../NOTICE'), 'utf8');

describe('vendored language logos', () => {
  it('never ships a copyleft or unverified logo', () => {
    // CC-BY-SA (PHP, R, Ruby, Rust) and the unverified BSD Duke (Java).
    for (const id of ['php', 'r', 'ruby', 'rust', 'java']) {
      expect(LANGUAGE_LOGOS, id).not.toHaveProperty(id);
    }

    const source = readFileSync(resolve(__dirname, '../../../../src/tools/code/language-logos.ts'), 'utf8');

    expect(source).not.toMatch(/CC-BY-SA|BSD/);
  });

  it('carries the MIT notices its logos require', () => {
    const source = readFileSync(resolve(__dirname, '../../../../src/tools/code/language-logos.ts'), 'utf8');

    expect(source).toMatch(/"gnubash", license: MIT/);
    expect(source).toMatch(/"javascript", license: MIT/);
    expect(NOTICE).toContain('Copyright (c) 2011 Christopher Williams');
    expect(NOTICE).toContain("Copyright (c) 2016 ol' dirty bashnerds");
    expect(NOTICE).toContain('Permission is hereby granted, free of charge');
  });

  it('only keys logos by languages the code block lists', () => {
    const ids = new Set(LANGUAGES.map((lang) => lang.id));

    expect(Object.keys(LANGUAGE_LOGOS).filter((id) => !ids.has(id))).toStrictEqual([]);
  });

  it('stores each as a 24×24 path with a six-digit brand hex', () => {
    for (const [id, logo] of Object.entries(LANGUAGE_LOGOS)) {
      expect(logo.hex, id).toMatch(/^#[0-9a-f]{6}$/);
      expect(logo.path, id).toMatch(/^[Mm]/);
    }
  });

  it('fills the letter holes of the square JS and TS marks with their real second color', () => {
    expect(LANGUAGE_LOGOS.javascript.inner).toBe('#000000');
    expect(LANGUAGE_LOGOS.typescript.inner).toBe('#ffffff');
  });
});
