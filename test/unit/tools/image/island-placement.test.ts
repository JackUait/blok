import { describe, expect, it } from 'vitest';
import { ISLAND_GAP_PX, islandBoundaryTop, resolveIslandPlacement } from '../../../../src/tools/image/island-placement';

describe('resolveIslandPlacement', () => {
  it('floats above when the islands fit between the boundary and the figure', () => {
    expect(resolveIslandPlacement({ figureTop: 200, islandHeight: 34, boundaryTop: 0 })).toBe('above');
  });

  it('fits exactly when the room equals island height plus the gap', () => {
    expect(resolveIslandPlacement({ figureTop: 34 + ISLAND_GAP_PX, islandHeight: 34, boundaryTop: 0 })).toBe('above');
    expect(resolveIslandPlacement({ figureTop: 34 + ISLAND_GAP_PX - 1, islandHeight: 34, boundaryTop: 0 })).toBe('inside');
  });

  it('sits inside when the figure is the first thing in the editor', () => {
    expect(resolveIslandPlacement({ figureTop: 108, islandHeight: 34, boundaryTop: 100 })).toBe('inside');
  });

  it('sits inside when the figure top is scrolled off screen', () => {
    expect(resolveIslandPlacement({ figureTop: -40, islandHeight: 34, boundaryTop: 0 })).toBe('inside');
  });
});

describe('islandBoundaryTop', () => {
  const mount = (editorTop: number): { editor: HTMLElement; figure: HTMLElement } => {
    const editor = document.createElement('div');
    editor.setAttribute('data-blok-redactor', '');
    const figure = document.createElement('div');
    editor.appendChild(figure);
    document.body.appendChild(editor);
    Object.defineProperty(editor, 'getBoundingClientRect', { value: () => ({ top: editorTop }) });

    return { editor, figure };
  };

  it('uses the editor top when it is below the viewport top', () => {
    const { editor, figure } = mount(120);

    expect(islandBoundaryTop(figure)).toBe(120);
    editor.remove();
  });

  it('uses the viewport top when the editor is scrolled above it', () => {
    const { editor, figure } = mount(-500);

    expect(islandBoundaryTop(figure)).toBe(0);
    editor.remove();
  });
});
