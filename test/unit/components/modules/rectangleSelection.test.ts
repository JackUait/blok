import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import RectangleSelection from '../../../../src/components/modules/rectangleSelection';

describe('RectangleSelection interactions with Toolbar', () => {
  let rectangleSelection: RectangleSelection;
  let toolbarClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toolbarClose = vi.fn();

    rectangleSelection = new RectangleSelection({
      config: {},
      eventsDispatcher: {
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as typeof rectangleSelection['eventsDispatcher'],
    });

    rectangleSelection.state = {
      Toolbar: {
        close: toolbarClose,
        CSS: {
          toolbar: 'ce-toolbar',
        },
      },
      BlockSelection: {
        selectBlockByIndex: vi.fn(),
        unSelectBlockByIndex: vi.fn(),
      },
      BlockManager: {
        blocks: [],
        getBlockByIndex: vi.fn(() => ({
          holder: document.createElement('div'),
          selected: false,
        })),
        lastBlock: {
          holder: document.createElement('div'),
        },
      },
      InlineToolbar: {
        CSS: {
          inlineToolbar: 'ce-inline-toolbar',
        },
      },
      UI: {
        CSS: {
          editorWrapper: 'codex-editor',
        },
        nodes: {
          redactor: document.createElement('div'),
        },
      },
      RectangleSelection: {} as RectangleSelection['Editor']['RectangleSelection'],
    } as unknown as RectangleSelection['Editor'];

    (rectangleSelection as unknown as { overlayRectangle: HTMLDivElement }).overlayRectangle = document.createElement('div');
    (rectangleSelection as unknown as { overlayRectangle: HTMLDivElement }).overlayRectangle.style.display = 'none';

    vi.spyOn(rectangleSelection as unknown as { genInfoForMouseSelection: () => { rightPos: number; leftPos: number; index: number | undefined } }, 'genInfoForMouseSelection')
      .mockReturnValue({
        rightPos: 0,
        leftPos: 0,
        index: undefined,
      });

    vi.spyOn(rectangleSelection as unknown as { updateRectangleSize: () => void }, 'updateRectangleSize').mockImplementation(() => {});
    vi.spyOn(rectangleSelection as unknown as { trySelectNextBlock: () => void }, 'trySelectNextBlock').mockImplementation(() => {});
    vi.spyOn(rectangleSelection as unknown as { inverseSelection: () => void }, 'inverseSelection').mockImplementation(() => {});
    vi.spyOn(rectangleSelection as unknown as { shrinkRectangleToPoint: () => void }, 'shrinkRectangleToPoint').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('closes the Toolbar once rectangle selection becomes active', () => {
    (rectangleSelection as unknown as { mousedown: boolean }).mousedown = true;
    (rectangleSelection as unknown as { isRectSelectionActivated: boolean }).isRectSelectionActivated = false;

    (rectangleSelection as unknown as { changingRectangle: (event: MouseEvent) => void }).changingRectangle({
      pageX: 10,
      pageY: 20,
    } as unknown as MouseEvent);

    expect(toolbarClose).toHaveBeenCalledTimes(1);
  });
});

