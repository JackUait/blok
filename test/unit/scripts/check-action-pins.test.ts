import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  collectUses,
  findUnpinnedPins,
  parseActionRef,
} from '../../../scripts/check-action-pins.mjs';

const PAGES_ARTIFACT_V3 = 'actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa';
const PAGES_ARTIFACT_V5 = 'actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9';

/** The tail of the real v3.0.1 action.yml, the release that broke Build Docs. */
const V3_ACTION_YML = `name: "Upload GitHub Pages artifact"
description: "A composite action that prepares your static assets"
runs:
  using: "composite"
  steps:
    - name: Archive artifact
      shell: bash
      run: tar -cvf "$RUNNER_TEMP/artifact.tar" .

    - name: Upload artifact
      id: upload-artifact
      uses: actions/upload-artifact@v4
      with:
        name: \${{ inputs.name }}
`;

const V5_ACTION_YML = V3_ACTION_YML.replace(
  'actions/upload-artifact@v4',
  'actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f # v7.0.0',
);

const workflowUsing = (ref: string): string => `jobs:
  build:
    steps:
      - uses: ${ref}
`;

/** Serves one action.yml per `owner/repo/subpath` key; anything else has none. */
const upstream = (files: Record<string, string>) =>
  vi.fn(async ({ owner, repo, subpath }: {
    owner: string;
    repo: string;
    subpath: string;
  }) => files[[owner, repo, subpath].filter(Boolean).join('/')] ?? null);

describe('check-action-pins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports an unpinned action nested inside a pinned one', async () => {
    const violations = await findUnpinnedPins({
      sources: [{ label: '.github/workflows/deploy-docs.yml', text: workflowUsing(PAGES_ARTIFACT_V3) }],
      readAction: upstream({ 'actions/upload-pages-artifact': V3_ACTION_YML }),
    });

    expect(violations).toEqual([
      { from: PAGES_ARTIFACT_V3, uses: 'actions/upload-artifact@v4' },
    ]);
  });

  it('accepts the release whose nested action carries a SHA', async () => {
    const violations = await findUnpinnedPins({
      sources: [{ label: '.github/workflows/deploy-docs.yml', text: workflowUsing(PAGES_ARTIFACT_V5) }],
      readAction: upstream({ 'actions/upload-pages-artifact': V5_ACTION_YML }),
    });

    expect(violations).toEqual([]);
  });

  it('reports an unpinned action written directly in our own workflow', async () => {
    const violations = await findUnpinnedPins({
      sources: [{ label: '.github/workflows/ci.yml', text: workflowUsing('actions/checkout@v5') }],
      readAction: upstream({}),
    });

    expect(violations).toEqual([
      { from: '.github/workflows/ci.yml', uses: 'actions/checkout@v5' },
    ]);
  });

  it('walks past the first upstream level', async () => {
    const middle = 'acme/middle@1111111111111111111111111111111111111111';
    const violations = await findUnpinnedPins({
      sources: [{ label: '.github/workflows/ci.yml', text: workflowUsing(middle) }],
      readAction: upstream({
        'acme/middle': 'runs:\n  using: composite\n  steps:\n    - uses: acme/leaf@v2\n',
      }),
    });

    expect(violations).toEqual([{ from: middle, uses: 'acme/leaf@v2' }]);
  });

  it('reads a subpath action from its own directory', async () => {
    const readAction = upstream({ 'actions/cache/restore': 'runs:\n  using: node20\n' });

    await findUnpinnedPins({
      sources: [{
        label: '.github/actions/setup-node-deps/action.yml',
        text: workflowUsing('actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9'),
      }],
      readAction,
    });

    expect(readAction).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'actions',
      repo: 'cache',
      subpath: 'restore',
      ref: '55cc8345863c7cc4c66a329aec7e433d2d1c52a9',
    }));
  });

  it('ignores local and docker references', async () => {
    const readAction = upstream({});
    const violations = await findUnpinnedPins({
      sources: [{
        label: '.github/workflows/ci.yml',
        text: 'jobs:\n  build:\n    steps:\n      - uses: ./.github/actions/setup-node-deps\n'
          + '      - uses: docker://alpine:3.20\n',
      }],
      readAction,
    });

    expect(violations).toEqual([]);
    expect(readAction).not.toHaveBeenCalled();
  });

  it('visits each pinned action once even when two files use it', async () => {
    const ref = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
    const readAction = upstream({ 'actions/checkout': 'runs:\n  using: node24\n' });

    await findUnpinnedPins({
      sources: [
        { label: 'a.yml', text: workflowUsing(ref) },
        { label: 'b.yml', text: workflowUsing(ref) },
      ],
      readAction,
    });

    expect(readAction).toHaveBeenCalledTimes(1);
  });

  it('surfaces the fetch failure instead of passing silently', async () => {
    const readAction = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(findUnpinnedPins({
      sources: [{ label: 'a.yml', text: workflowUsing(PAGES_ARTIFACT_V3) }],
      readAction,
    })).rejects.toThrow('network down');
  });

  it('collects quoted and unquoted uses values', () => {
    expect(collectUses("steps:\n  - uses: 'a/b@v1'\n  - uses: c/d@v2\n")).toEqual([
      'a/b@v1',
      'c/d@v2',
    ]);
  });

  it('splits an action reference into repository, subpath and ref', () => {
    expect(parseActionRef('github/codeql-action/analyze@abc123')).toEqual({
      owner: 'github',
      repo: 'codeql-action',
      subpath: 'analyze',
      ref: 'abc123',
    });
  });
});
