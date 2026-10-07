import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { OutputData } from '../../../../types';

const body: OutputData = {
  blocks: [{
    id: 'b1',
    type: 'paragraph',
    data: { text: '<strong>a</strong> <a href="https://example.com">l</a> <mark style="color: var(--blok-color-red-text);">c</mark>' },
  }],
};

const openDrawer = async (onDescriptionChange: (rowId: string, description: OutputData) => void): Promise<{ drawer: DatabaseCardDrawer; wrapper: HTMLElement }> => {
  const wrapper = document.createElement('div');

  document.body.appendChild(wrapper);

  const drawer = new DatabaseCardDrawer({
    wrapper,
    readOnly: false,
    toolsConfig: { tools: { paragraph: Paragraph } },
    titlePropertyId: 'prop-title',
    descriptionPropertyId: 'prop-body',
    schema: [{ id: 'prop-body', name: 'Body', type: 'richText', position: 'a1' }],
    onTitleChange: vi.fn(),
    onDescriptionChange,
    onClose: vi.fn(),
  });

  drawer.open({ id: 'row-1', position: 'a0', properties: { 'prop-title': 'Card', 'prop-body': body } });

  await vi.waitFor(() => {
    expect(wrapper.querySelector(`[${DATA_ATTR.rendered}]`)).not.toBeNull();
  }, { timeout: 20000 });

  return { drawer, wrapper };
};

describe('DatabaseCardDrawer — the body is stored as HTML', { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('closing an unedited formatted body writes nothing', async () => {
    const onDescriptionChange = vi.fn();
    const { drawer } = await openDrawer(onDescriptionChange);

    drawer.close();
    // The close-time save is async.
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(onDescriptionChange).not.toHaveBeenCalled();
    drawer.destroy();
  });

  it('an edit hands the row HTML, not segments', async () => {
    const onDescriptionChange = vi.fn();
    const { drawer, wrapper } = await openDrawer(onDescriptionChange);
    const element = wrapper.querySelector('[data-blok-tool="paragraph"]');

    if (!(element instanceof HTMLElement)) {
      throw new Error('the body has no paragraph');
    }
    element.innerHTML = '<b>z</b>';

    await vi.waitFor(() => expect(onDescriptionChange).toHaveBeenCalled(), { timeout: 5000 });

    const description = onDescriptionChange.mock.calls.at(-1)?.[1] as OutputData;

    expect(description.blocks[0].data.text).toBe('<strong>z</strong>');
    drawer.destroy();
  });
});
