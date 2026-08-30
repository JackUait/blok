import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const BIN_PATH = path.resolve(__dirname, '../../../packages/cli/bin/blok-cli.mjs');
const DIST_PATH = path.resolve(__dirname, '../../../packages/cli/dist/cli.mjs');
const CLI_VERSION = JSON.parse(readFileSync(path.resolve(__dirname, '../../../packages/cli/package.json'), 'utf-8')).version;

/**
 * Every case here spawns a node subprocess, and the two conversion cases load the
 * whole CLI bundle inside it. Under release-preflight load that costs 20-40x what
 * it does idle (2s -> 23s, measured at load 94), so the suite carries its own
 * ceiling rather than inheriting the global one.
 */
const SUBPROCESS_TIMEOUT_MS = 120_000;

describe('blok-cli binary', () => {
  it('bin entry point exists and is executable', () => {
    expect(existsSync(BIN_PATH)).toBe(true);
  });

  it('dist/cli.mjs exists (requires build)', () => {
    expect(existsSync(DIST_PATH)).toBe(true);
  });

  it('--help outputs usage with blok-cli name', () => {
    const output = execFileSync(process.execPath, [BIN_PATH, '--help'], { encoding: 'utf-8' });

    expect(output).toContain('blok-cli');
    expect(output).toContain('--convert-html');
    expect(output).toContain('--migration');
    expect(output).toContain('--output');
  });

  it('--migration outputs markdown migration guide', () => {
    const output = execFileSync(process.execPath, [BIN_PATH, '--migration'], { encoding: 'utf-8' });

    expect(output).toContain('# Blok Migration Guide');
    expect(output).toContain('Current Blok version:');
  });

  it('--convert-html converts piped HTML to JSON', () => {
    const output = execFileSync(process.execPath, [BIN_PATH, '--convert-html'], {
      encoding: 'utf-8',
      input: '<p>Hello <b>world</b></p>',
    });
    const result = JSON.parse(output);

    expect(result.version).toBe(CLI_VERSION);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe('paragraph');
    expect(result.blocks[0].data.text).toBe('Hello <b>world</b>');
  });

  it('--convert-gdocs converts piped Google Docs HTML to JSON', () => {
    const gdocsHtml = '<b id="docs-internal-guid-test"><p><span style="font-weight:700">Hello</span></p></b>';
    const output = execFileSync(process.execPath, [BIN_PATH, '--convert-gdocs'], {
      encoding: 'utf-8',
      input: gdocsHtml,
    });
    const result = JSON.parse(output);

    expect(result.version).toBe(CLI_VERSION);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe('paragraph');
    expect(result.blocks[0].data.text).toContain('<b>');
    expect(result.blocks[0].data.text).toContain('Hello');
  });

  it('--help lists --convert-gdocs option', () => {
    const output = execFileSync(process.execPath, [BIN_PATH, '--help'], { encoding: 'utf-8' });

    expect(output).toContain('--convert-gdocs');
  });

  it('no args outputs help text', () => {
    const output = execFileSync(process.execPath, [BIN_PATH], { encoding: 'utf-8' });

    expect(output).toContain('Usage: blok-cli');
  });
}, SUBPROCESS_TIMEOUT_MS);
