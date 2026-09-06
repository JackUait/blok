import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

describe('emoji dataset location law', () => {
  it('keeps the dataset in the shared utils directory', () => {
    expect(existsSync(resolve(ROOT, 'src/components/utils/emoji/emoji-data.ts'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'src/components/utils/emoji/emoji-locale.ts'))).toBe(true);
  });

  it('does not leave a copy under the callout tool', () => {
    expect(existsSync(resolve(ROOT, 'src/tools/callout/emoji-picker/emoji-data.ts'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'src/tools/callout/emoji-picker/locales'))).toBe(false);
  });
});
