import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RELEASE_TAG_WORKFLOWS, missingWorkflowSecrets } from '../../../scripts/release.mjs';

const repoRoot = resolve(__dirname, '../../..');

const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf-8');

describe('release CI secret gate', () => {
  it('names every workflow a release tag starts', () => {
    // `yarn release` publishes npm and pushes the tag; these are what the tag
    // then runs unattended, so their credentials must exist before it is cut.
    expect(RELEASE_TAG_WORKFLOWS).toEqual([
      '.github/workflows/release-server.yml',
      '.github/workflows/mirror.yml',
    ]);
  });

  it('reports a referenced secret the repository does not hold', () => {
    const workflow = 'env:\n  A: ${{ secrets.PRESENT_ONE }}\n  B: ${{ secrets.ABSENT_ONE }}\n';

    expect(missingWorkflowSecrets({
      workflowSources: [workflow],
      existingSecrets: ['PRESENT_ONE'],
    })).toEqual(['ABSENT_ONE']);
  });

  it('never asks for GITHUB_TOKEN, which Actions mints per run', () => {
    expect(missingWorkflowSecrets({
      workflowSources: ['${{ secrets.GITHUB_TOKEN }}'],
      existingSecrets: [],
    })).toEqual([]);
  });

  it('reports each missing name once, sorted, across every workflow', () => {
    expect(missingWorkflowSecrets({
      workflowSources: ['${{ secrets.ZED }} ${{ secrets.ZED }}', '${{ secrets.ABE }}'],
      existingSecrets: [],
    })).toEqual(['ABE', 'ZED']);
  });

  it('passes when the repository holds every referenced secret', () => {
    expect(missingWorkflowSecrets({
      workflowSources: ['${{ secrets.ONLY }}'],
      existingSecrets: ['ONLY', 'SPARE'],
    })).toEqual([]);
  });

  it('would have caught the unset dodopizza mirror token before any package shipped', () => {
    // The regression this gate exists for: release-server.yml has referenced
    // BLOK_GITHUB_TOKEN since the mirror step landed, and the repository has
    // never held it. NUGET_API_KEY reached a tag the same way once already.
    const sources = RELEASE_TAG_WORKFLOWS.map(read);

    expect(sources.join('\n')).toContain('secrets.BLOK_GITHUB_TOKEN');
    expect(missingWorkflowSecrets({
      workflowSources: sources,
      existingSecrets: ['MIRROR_PAT', 'NUGET_API_KEY'],
    })).toEqual(['BLOK_GITHUB_TOKEN']);
  });
});
