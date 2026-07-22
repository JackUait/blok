/**
 * Reactive BlokState contract for the React adapter (adapters phase of the
 * 2026-07-22 reactive-config-contract design).
 *
 * The three `BlokState` fields — `readOnly`, `hideToolbar`, `inlineToolbar` —
 * must sync IN PLACE on a live editor: flipping the prop drives the public
 * runtime setter on the SAME instance, never a destroy/recreate cycle.
 *
 * These tests boot the REAL core (this package's vitest config aliases
 * `@bloklabs/core` to the repo's `src/`) so the assertions observe genuine
 * editor state, not mock call shapes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';

// Direct src import: the published DATA_ATTR declaration is a hand-authored
// subset that does not carry `toolbarHidden`; tests may reach the real map.
import { DATA_ATTR } from '../../../src/components/constants/data-attributes';
import { useBlok, BlokContent } from '../src';
import type { UseBlokConfig } from '../src';
import type { Blok } from '@/types';
import { Paragraph } from '../../../src/tools/paragraph';
import { BoldInlineTool } from '../../../src/components/inline-tools/inline-tool-bold';
import { ItalicInlineTool } from '../../../src/components/inline-tools/inline-tool-italic';

const TOOLS: UseBlokConfig['tools'] = {
  paragraph: { class: Paragraph, inlineToolbar: true },
  bold: { class: BoldInlineTool },
  italic: { class: ItalicInlineTool },
};

/** Every distinct editor instance the harness has observed (identity log). */
let editors: Blok[] = [];

function Harness({ config }: { config: UseBlokConfig }): React.ReactElement {
  const editor = useBlok(config);

  useEffect(() => {
    if (editor !== null && !editors.includes(editor)) {
      editors.push(editor);
    }
  }, [editor]);

  return <BlokContent editor={editor} data-testid="container" />;
}

const waitForEditor = async (): Promise<Blok> => {
  await waitFor(() => {
    expect(editors.length).toBeGreaterThan(0);
  }, { timeout: 5000 });

  return editors[0];
};

/** Reach a module instance through the editor's `module` aliases. */
const moduleOf = <T,>(editor: Blok, name: string): T =>
  (editor as unknown as { module: Record<string, T> }).module[name];

const paragraphInlineToolKeys = (editor: Blok): string[] => {
  const tools = moduleOf<{
    blockTools: Map<string, { inlineTools: Map<string, unknown> }>;
  }>(editor, 'tools');
  const paragraph = tools.blockTools.get('paragraph');

  if (paragraph === undefined) {
    throw new Error('paragraph block tool is not available');
  }

  return Array.from(paragraph.inlineTools.keys());
};

describe('useBlok reactive BlokState fields (real core, in-place sync)', () => {
  beforeEach(() => {
    editors = [];
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Let useBlok's deferred destroy (setTimeout 0) run after RTL's unmount.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    vi.restoreAllMocks();
  });

  describe('readOnly', () => {
    it('flips readOnly.isEnabled on the SAME instance (no recreation)', async () => {
      const { rerender } = render(<Harness config={{ readOnly: false }} />);
      const editor = await waitForEditor();

      expect(editor.readOnly.isEnabled).toBe(false);

      rerender(<Harness config={{ readOnly: true }} />);

      await waitFor(() => {
        expect(editor.readOnly.isEnabled).toBe(true);
      });
      expect(editors).toHaveLength(1);
    });

    it('object form syncs hideControls in place via readOnly.set(state, { hideControls })', async () => {
      const { rerender } = render(<Harness config={{ readOnly: false }} />);
      const editor = await waitForEditor();
      const readOnlyModule = moduleOf<{ isControlsHidden: boolean }>(editor, 'readOnly');

      expect(readOnlyModule.isControlsHidden).toBe(false);

      rerender(<Harness config={{ readOnly: { hideControls: true } }} />);

      await waitFor(() => {
        expect(editor.readOnly.isEnabled).toBe(true);
        expect(readOnlyModule.isControlsHidden).toBe(true);
      });
      expect(editors).toHaveLength(1);
    });

    it('exposes the in-place toggle capability: readOnly.togglesInPlace === true', async () => {
      render(<Harness config={{}} />);
      const editor = await waitForEditor();

      expect(editor.readOnly.togglesInPlace).toBe(true);
    });
  });

  describe('hideToolbar', () => {
    it('toggles the wrapper toolbar-hidden attribute in place when the prop flips', async () => {
      const { container, rerender } = render(<Harness config={{ hideToolbar: false }} />);

      await waitForEditor();
      expect(container.querySelector(`[${DATA_ATTR.toolbarHidden}]`)).toBeNull();

      rerender(<Harness config={{ hideToolbar: true }} />);

      await waitFor(() => {
        expect(container.querySelector(`[${DATA_ATTR.toolbarHidden}]`)).not.toBeNull();
      });
      expect(editors).toHaveLength(1);

      rerender(<Harness config={{ hideToolbar: false }} />);

      await waitFor(() => {
        expect(container.querySelector(`[${DATA_ATTR.toolbarHidden}]`)).toBeNull();
      });
      expect(editors).toHaveLength(1);
    });
  });

  describe('inlineToolbar', () => {
    it('re-assigns block-tool inline tools in place when the prop changes', async () => {
      const { rerender } = render(<Harness config={{ tools: TOOLS, inlineToolbar: true }} />);
      const editor = await waitForEditor();

      expect(paragraphInlineToolKeys(editor)).toContain('bold');
      expect(paragraphInlineToolKeys(editor)).toContain('italic');

      rerender(<Harness config={{ tools: TOOLS, inlineToolbar: ['bold'] }} />);

      await waitFor(() => {
        expect(paragraphInlineToolKeys(editor)).not.toContain('italic');
        expect(paragraphInlineToolKeys(editor)).toContain('bold');
      });
      expect(editors).toHaveLength(1);
    });

    it('a NEW array with identical content does not thrash the setter (compared by content)', async () => {
      const { rerender } = render(<Harness config={{ tools: TOOLS, inlineToolbar: ['bold'] }} />);
      const editor = await waitForEditor();

      const setInlineToolbarSpy = vi.spyOn(editor.tools, 'setInlineToolbar');

      rerender(<Harness config={{ tools: TOOLS, inlineToolbar: ['bold'] }} />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(setInlineToolbarSpy).not.toHaveBeenCalled();
      expect(editors).toHaveLength(1);
    });
  });
});
