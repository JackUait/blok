import { describe, expect, it } from 'vitest';
import { presets } from './presets-data';

describe('presets docs data', () => {
  it('documents every shipped preset', () => {
    expect(presets.map((p) => p.id).sort()).toEqual(
      ['cloudinary', 'fetch-endpoint', 'indexeddb', 'presigned', 'supabase'].sort()
    );
  });

  it('says for each preset whether re-hosting a remote URL works', () => {
    for (const preset of presets) {
      expect(typeof preset.supportsUploadByUrl).toBe('boolean');
    }
  });

  it('marks indexedDB as unsuitable for production', () => {
    expect(presets.find((p) => p.id === 'indexeddb')?.productionReady).toBe(false);
  });
});
