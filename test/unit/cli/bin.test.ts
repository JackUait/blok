import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const BIN_PATH = path.resolve(__dirname, '../../../packages/cli/bin/blok-cli.mjs');
const DIST_PATH = path.resolve(__dirname, '../../../packages/cli/dist/cli.mjs');

describe('blok-cli binary', () => {
  it('bin entry point exists and is executable', () => {
    expect(existsSync(BIN_PATH)).toBe(true);
  });

  it('dist/cli.mjs exists (requires build)', () => {
    expect(existsSync(DIST_PATH)).toBe(true);
  });

  it('--help outputs usage with blok-cli name', () => {
    const output = execSync(`node ${BIN_PATH} --help`, { encoding: 'utf-8' });

    expect(output).toContain('blok-cli');
    expect(output).toContain('--convert-html');
    expect(output).toContain('--migration');
    expect(output).toContain('--output');
  });

  it('--migration outputs markdown migration guide', () => {
    const output = execSync(`node ${BIN_PATH} --migration`, { encoding: 'utf-8' });

    expect(output).toContain('# Blok Migration Guide');
    expect(output).toContain('Current Blok version:');
  });

  it('--convert-html converts piped HTML to JSON', () => {
    const output = execSync(
      `echo '<p>Hello <b>world</b></p>' | node ${BIN_PATH} --convert-html`,
      { encoding: 'utf-8' }
    );
    const result = JSON.parse(output);

    expect(result.version).toBe('2.31.0');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe('paragraph');
    expect(result.blocks[0].data.text).toBe('Hello <b>world</b>');
  });

  it('no args outputs help text', () => {
    const output = execSync(`node ${BIN_PATH}`, { encoding: 'utf-8' });

    expect(output).toContain('Usage: blok-cli');
  });
});
