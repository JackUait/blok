import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { DatabaseConfig, DatabaseData } from '../../../../src/tools/database/types';
import type { Blok as PublicBlok } from '../../../../types';

let editor: PublicBlok | undefined;
let holder: HTMLDivElement | undefined;

const mount = async (config: DatabaseConfig = {}): Promise<HTMLInputElement> => {
  class ConfiguredDatabase extends DatabaseTool {
    constructor(options: ConstructorParameters<typeof DatabaseTool>[0]) {
      super({ ...options, config });
    }
  }

  const data = {
    schema: [
      { id: 'title', name: 'Name', type: 'title', position: 'a0' },
      { id: 'email', name: 'Email', type: 'email', position: 'a1' },
    ],
    views: [{
      id: 'form', name: 'Form', type: 'form', position: 'a0',
      sorts: [], filters: [], visibleProperties: ['email'],
      properties: [{ id: 'title', visible: true }, { id: 'email', visible: true }],
    }],
    activeViewId: 'form',
  } satisfies DatabaseData;

  editor = new Blok({
    holder, dataModel: 'hierarchical',
    tools: { database: ConfiguredDatabase, 'database-row': DatabaseRowTool },
    data: { blocks: [{ id: 'db', type: 'database', data, content: [] }] },
  }) as unknown as PublicBlok;
  await editor.isReady;
  const email = document.querySelector<HTMLInputElement>('[id="blok-form-form-email"]');

  if (email === null) throw new Error('Missing email question');

  return email;
};

describe('public form email validity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('the real email question reports a native mismatch for malformed input', async () => {
    const email = await mount();

    email.value = 'not-an-email';

    expect(email.validity.typeMismatch).toBe(true);
    expect(email.type).toBe('email');
  });

  it('does not create or deliver a response with a malformed nonempty email answer', async () => {
    const onSubmit = vi.fn();
    const email = await mount({ forms: { onSubmit } });
    const title = document.querySelector<HTMLInputElement>('[id="blok-form-form-title"]');
    const submit = document.querySelector<HTMLButtonElement>('[data-blok-database-form-submit]');

    if (title === null || submit === null || editor === undefined) throw new Error('Missing public form');

    title.value = 'Response';
    email.value = 'not-an-email';
    submit.click();
    const saved = await editor.save();

    expect(saved.blocks.filter((block) => block.type === 'database-row')).toEqual([]);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('[data-blok-database-form-done]')).toBeNull();
  });
});
