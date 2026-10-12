/**
 * Adapter law (03 §6 item 12, 06 05-Q5): React, Vue and Angular hand the host
 * the CORE `Blok` type for the live instance. That is why `editor.agent`, and
 * every later API namespace, reaches adapter users with no adapter code. An
 * adapter that narrowed the instance to a type of its own would drop it.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf-8');

/** `import type { ..., Blok, ... } from '@bloklabs/core';`, on one line or many. */
const importsCoreBlok = (source: string): boolean =>
  /import type \{[^}]*\bBlok\b[^}]*\} from '@bloklabs\/core';/.test(source);

describe('adapter Blok instance law', () => {
  it('the core API carries agent, and Blok merges the API', () => {
    const core = read('types/index.d.ts');

    expect(core).toMatch(/export interface API \{[\s\S]*?\n {2}agent: Agent;/);
    expect(core).toMatch(/export interface Blok extends Omit<API,/);
  });

  it('React publishes the core Blok for the ref and the editor', () => {
    const types = read('packages/react/types/index.d.ts');

    expect(importsCoreBlok(types)).toBe(true);
    expect(types).toContain('React.RefAttributes<Blok | null>');
    expect(types).toContain('editor: Blok | null');
  });

  it('Vue publishes the core Blok for the exposed instance and useBlok', () => {
    const types = read('packages/vue/types/index.d.ts');

    expect(importsCoreBlok(types)).toBe(true);
    expect(types).toContain('instance: Blok | null');
    expect(types).toContain('Ref<Blok | null>');
  });

  it('Angular exposes the core Blok on instance() and (ready)', () => {
    const source = read('packages/angular/src/blok-editor.component.ts');

    expect(importsCoreBlok(source)).toBe(true);
    expect(source).toContain('computed<Blok | null>');
    expect(source).toContain('new EventEmitter<Blok>()');
  });
});
