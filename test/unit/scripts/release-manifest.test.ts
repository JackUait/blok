import { describe, expect, it } from 'vitest';
import { FAMILY, prepareManifestForGpr, rewriteSpecifiersForGpr } from '../../../scripts/release-manifest.mjs';

const findEntry = (npmName: string): (typeof FAMILY)[number] => {
  const entry = FAMILY.find((p) => p.npmName === npmName);

  if (!entry) {
    throw new Error(`FAMILY entry missing: ${npmName}`);
  }

  return entry;
};

describe('release family manifest', () => {
  it('covers all five packages with correct npm + mirror names in publish order', () => {
    expect(FAMILY.map((p) => [p.npmName, p.gprName])).toEqual([
      ['@bloklabs/core', '@dodopizza/blok'],
      ['@bloklabs/react', '@dodopizza/blok-react'],
      ['@bloklabs/vue', '@dodopizza/blok-vue'],
      ['@bloklabs/angular', '@dodopizza/blok-angular'],
      ['@bloklabs/cli', '@dodopizza/blok-cli'],
    ]);
  });

  it('every entry declares its manifest and pack directories', () => {
    for (const entry of FAMILY) {
      expect(entry.manifestPath, entry.npmName).toMatch(/package\.json$/);
      expect(typeof entry.packDir, entry.npmName).toBe('string');
    }
  });

  it('rewrites name AND the @bloklabs/core peer for GPR tarballs', () => {
    const entry = findEntry('@bloklabs/react');
    const out = prepareManifestForGpr(
      {
        name: '@bloklabs/react',
        version: '2.0.0',
        peerDependencies: { '@bloklabs/core': '^2.0.0', react: '^19.0.0' },
      },
      entry,
    ) as { name: string; peerDependencies: Record<string, string> };

    expect(out.name).toBe('@dodopizza/blok-react');
    expect(out.peerDependencies['@dodopizza/blok']).toBe('^2.0.0');
    expect(out.peerDependencies['@bloklabs/core']).toBeUndefined();
    expect(out.peerDependencies.react).toBe('^19.0.0');
  });

  it('rewrites core specifiers inside bundled code for GPR tarballs', () => {
    const code = [
      'import { Blok } from "@bloklabs/core";',
      'import { createBlocksApiForEditor } from "@bloklabs/core/adapters";',
      "const dyn = await import('@bloklabs/core/markdown');",
    ].join('\n');
    const out = rewriteSpecifiersForGpr(code);

    expect(out).toContain('from "@dodopizza/blok"');
    expect(out).toContain('from "@dodopizza/blok/adapters"');
    expect(out).toContain("import('@dodopizza/blok/markdown')");
    expect(out).not.toContain('@bloklabs');
  });

  it('marks exactly the adapter entries for dist rewriting', () => {
    const rewriting = FAMILY.filter((p) => (p.distRewriteDirs ?? []).length > 0).map((p) => p.npmName);

    expect(rewriting).toEqual(['@bloklabs/react', '@bloklabs/vue', '@bloklabs/angular']);
  });

  it('leaves manifests without a core peer untouched apart from the name', () => {
    const entry = findEntry('@bloklabs/core');
    const input = { name: '@bloklabs/core', version: '2.0.0' };
    const out = prepareManifestForGpr(input, entry) as {
      name: string;
      peerDependencies?: Record<string, string>;
    };

    expect(out.name).toBe('@dodopizza/blok');
    expect(out.peerDependencies).toBeUndefined();
    // pure function: the input object is not mutated
    expect(input.name).toBe('@bloklabs/core');
  });
});
