/**
 * Architectural enforcement: media tools must be wired to the editor's asset
 * uploader, and must route assets by ASSET KIND rather than by tool.
 *
 * Background — the bug this law exists to prevent. Blok's uploader contract was
 * originally keyed to the TOOL: each media tool read its own
 * `config.uploader`. That holds only while every tool owns exactly one asset
 * kind, and it stopped holding when the audio block grew cover art. Cover art
 * is an IMAGE living inside an AUDIO block, and the audio tool posted it to
 * `tools.audio.config.uploader` — the host's audio endpoint, which mirrors the
 * tool's own documented `types: ['audio/*']` contract and answers 415. Covers
 * were therefore broken in every real application while looking perfect in the
 * playground, where no uploader is configured and the `blob:` fallback always
 * succeeds. The same shape appeared once before as a hand-rolled workaround:
 * `src/tools/image/converted-uploader.ts` reaches into the VIDEO tool's config
 * because a converted GIF is a video.
 *
 * The law has two halves:
 *
 * 1. Every tool that owns an `uploader.ts` must construct it with the editor's
 *    asset uploader (`new Uploader(this.config, this.api.uploader)`). Dropping
 *    that argument silently disables editor-level `config.uploader` for that
 *    tool — assets fall back to `blob:` URLs that do not survive a reload, with
 *    no error anywhere.
 *
 * 2. An upload request must name the kind of the ASSET, never assume the kind
 *    of the requesting tool. Every `api.uploader.upload*` call therefore has to
 *    pass an explicit `kind`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const TOOLS_DIR = join(REPO_ROOT, 'src', 'tools');

/** Tools that ship their own `uploader.ts` — the media-bearing set. */
const toolsWithUploader = (): string[] =>
  readdirSync(TOOLS_DIR).filter((name) => existsSync(join(TOOLS_DIR, name, 'uploader.ts')));

const readToolEntry = (tool: string): string =>
  readFileSync(join(TOOLS_DIR, tool, 'index.ts'), 'utf8');

describe('asset uploader wiring law', () => {
  it('finds the media tools it is meant to guard', () => {
    // A rename that empties this list would make every assertion below vacuous.
    expect(toolsWithUploader().sort()).toEqual(['audio', 'file', 'image', 'video']);
  });

  it.each(toolsWithUploader())(
    '%s constructs its Uploader with the editor asset uploader',
    (tool) => {
      const source = readToolEntry(tool);
      const construction = /new Uploader\(([^)]*)\)/.exec(source);

      expect(construction, `${tool}/index.ts must construct its Uploader`).not.toBeNull();
      expect(
        construction?.[1].replace(/\s+/g, ' '),
        `${tool} must pass this.api.uploader, or editor-level config.uploader silently stops serving it`
      ).toContain('this.api.uploader');
    }
  );

  it('never lets an upload request omit the asset kind', () => {
    const offenders: string[] = [];
    const callSite = /api\.uploader\s*\.?\s*\n?\s*\.(uploadByFile|uploadByUrl)\(([\s\S]{0,240}?)\)\s*[;.)]/g;

    const toolSources = readdirSync(TOOLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        readdirSync(join(TOOLS_DIR, entry.name))
          .filter((file) => file.endsWith('.ts'))
          .map((file) => ({ id: `${entry.name}/${file}`, path: join(TOOLS_DIR, entry.name, file) }))
      );

    for (const { id, path } of toolSources) {
      const matches = readFileSync(path, 'utf8').matchAll(callSite);
      const missing = Array.from(matches).filter((match) => !match[2].includes('kind:'));

      offenders.push(...missing.map((match) => `${id}: ${match[1]} without an explicit kind`));
    }

    expect(offenders).toEqual([]);
  });
});
