import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { OutputData } from '../../../../types';
import type { ToolsConfig } from '../../../../types/api/tools';

const body: OutputData = {
  blocks: [{
    id: 'b1',
    type: 'paragraph',
    data: { text: '<strong>a</strong> <a href="https://example.com">l</a> <mark style="color: var(--blok-color-red-text);">c</mark>' },
  }],
};

/** A custom block that keeps whatever data it was given. */
class KeepsData {
  private readonly data: Record<string, unknown>;

  constructor({ data }: { data: Record<string, unknown> }) {
    this.data = data;
  }

  public render(): HTMLElement {
    return document.createElement('div');
  }

  public save(): Record<string, unknown> {
    return this.data;
  }
}

/** Declares its `text` as rich text. */
class RichNote extends KeepsData {
  public static get richTextFields(): string[] {
    return ['text'];
  }
}

const openDrawer = async (
  onDescriptionChange: (rowId: string, description: OutputData) => void,
  description: OutputData = body,
  toolsConfig: ToolsConfig = { tools: { paragraph: Paragraph } }
): Promise<{ drawer: DatabaseCardDrawer; wrapper: HTMLElement }> => {
  const wrapper = document.createElement('div');

  document.body.appendChild(wrapper);

  const drawer = new DatabaseCardDrawer({
    wrapper,
    readOnly: false,
    toolsConfig,
    titlePropertyId: 'prop-title',
    descriptionPropertyId: 'prop-body',
    schema: [{ id: 'prop-body', name: 'Body', type: 'richText', position: 'a1' }],
    onTitleChange: vi.fn(),
    onDescriptionChange,
    onClose: vi.fn(),
  });

  drawer.open({ id: 'row-1', position: 'a0', properties: { 'prop-title': 'Card', 'prop-body': description } });

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

  describe('a configured custom tool', () => {
    const withCustom = (data: Record<string, unknown>, type: string): OutputData => ({
      blocks: [
        { id: 'b1', type: 'paragraph', data: { text: 'p' } },
        { id: 'c1', type, data },
      ],
    });

    const edit = async (wrapper: HTMLElement): Promise<void> => {
      const element = wrapper.querySelector('[data-blok-tool="paragraph"]');

      if (!(element instanceof HTMLElement)) {
        throw new Error('the body has no paragraph');
      }
      element.innerHTML = 'q';
    };

    it.each([
      ['with static richTextFields', 'note', { text: '<b>n</b>' }],
      // A built-in type name: the built-in field table must not apply to it.
      ['without static richTextFields', 'quote', { text: ['x', 'y'] }],
    ])('%s: closing an unedited body writes nothing', async (_label, type, data) => {
      const onDescriptionChange = vi.fn();
      const { drawer } = await openDrawer(onDescriptionChange, withCustom(data, type), {
        tools: { paragraph: Paragraph, [type]: type === 'note' ? RichNote : KeepsData },
      });

      drawer.close();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(onDescriptionChange).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('with static richTextFields: an edit hands the row its field as HTML', async () => {
      const onDescriptionChange = vi.fn();
      const { drawer, wrapper } = await openDrawer(onDescriptionChange, withCustom({ text: '<b>n</b>' }, 'note'), {
        tools: { paragraph: Paragraph, note: RichNote },
      });

      await edit(wrapper);
      await vi.waitFor(() => expect(onDescriptionChange).toHaveBeenCalled(), { timeout: 5000 });

      const description = onDescriptionChange.mock.calls.at(-1)?.[1] as OutputData;

      // A rich field goes through segments, so it comes back in Blok's spelling.
      expect(description.blocks[1].data.text).toBe('<strong>n</strong>');
      drawer.destroy();
    });

    it('without static richTextFields: an edit leaves its data as the tool saved it', async () => {
      const onDescriptionChange = vi.fn();
      const { drawer, wrapper } = await openDrawer(onDescriptionChange, withCustom({ text: ['x', 'y'] }, 'quote'), {
        tools: { paragraph: Paragraph, quote: KeepsData },
      });

      await edit(wrapper);
      await vi.waitFor(() => expect(onDescriptionChange).toHaveBeenCalled(), { timeout: 5000 });

      const description = onDescriptionChange.mock.calls.at(-1)?.[1] as OutputData;

      expect(description.blocks[1].data).toEqual({ text: ['x', 'y'] });
      drawer.destroy();
    });
  });
});
