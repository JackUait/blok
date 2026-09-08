import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

interface HoverResolution {
  kind: string;
  wrapper: HTMLElement | null;
}

const resolution = vi.hoisted<{ current: HoverResolution }>(() => ({
  current: { kind: 'block', wrapper: null },
}));

vi.mock('../../../../../../src/components/modules/uiControllers/hovered-block-resolution', () => ({
  getPointFromPointerEvent: () => ({ x: 0, y: 0 }),
  resolveHoveredBlockWrapper: () => resolution.current,
}));

import {
  createRedactorTouchHandler,
  getClickedNode,
} from '../../../../../../src/components/modules/uiControllers/handlers/touch';
import { PopoverRegistry } from '../../../../../../src/components/utils/popover/popover-registry';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

interface Fixture {
  redactor: HTMLElement;
  holder: HTMLElement;
  content: HTMLElement;
  lastBlock: { holder: HTMLElement };
  handler: (event: Event) => void;
  setToTheLastBlock: Mock<() => void>;
  moveAndOpen: Mock<(block?: unknown, node?: unknown) => void>;
  getBlockByChildNode: Mock<(node: unknown) => unknown>;
}

const CONTENT_BOTTOM = 120;

const build = ({
  readOnly = false,
  currentIsLast = true,
  withContent = true,
}: { readOnly?: boolean; currentIsLast?: boolean; withContent?: boolean } = {}): Fixture => {
  const redactor = document.createElement('div');
  const holder = document.createElement('div');
  const content = document.createElement('div');

  content.setAttribute('data-blok-element-content', '');
  Object.defineProperty(content, 'getBoundingClientRect', {
    value: () => ({ top: 10, bottom: CONTENT_BOTTOM, left: 0, right: 100, width: 100, height: 110, x: 0, y: 10, toJSON: () => ({}) }),
    configurable: true,
  });
  if (withContent) {
    holder.appendChild(content);
  }
  redactor.appendChild(holder);
  document.body.appendChild(redactor);

  const lastBlock = { holder };
  const setToTheLastBlock = vi.fn<() => void>();
  const moveAndOpen = vi.fn<(block?: unknown, node?: unknown) => void>();
  const getBlockByChildNode = vi.fn<(node: unknown) => unknown>(() => ({ id: 'resolved' }));

  const Blok = {
    BlockManager: {
      setCurrentBlockByChildNode: () => (currentIsLast ? lastBlock : { holder: document.createElement('div') }),
      lastBlock,
      getBlockByChildNode,
    } as unknown as BlokModules['BlockManager'],
    RectangleSelection: { isRectActivated: () => false } as unknown as BlokModules['RectangleSelection'],
    Caret: { setToTheLastBlock } as unknown as BlokModules['Caret'],
    ReadOnly: { isEnabled: readOnly } as unknown as BlokModules['ReadOnly'],
    Toolbar: { contains: () => false, moveAndOpen } as unknown as BlokModules['Toolbar'],
  } as unknown as BlokModules;

  return {
    redactor,
    holder,
    content,
    lastBlock,
    handler: createRedactorTouchHandler({ Blok, redactorElement: redactor }),
    setToTheLastBlock,
    moveAndOpen,
    getBlockByChildNode,
  };
};

const mouseAt = (target: EventTarget, clientY: number): MouseEvent => {
  const event = new MouseEvent('mousedown', { clientX: 50, clientY, bubbles: true });

  Object.defineProperty(event, 'target', { value: target, configurable: true });

  return event;
};

/**
 * jsdom ships TouchEvent but not Touch, so a touch list has to be attached to
 * the event by hand — every branch keyed on `event.touches` is unreachable
 * otherwise.
 */
const touchAt = (target: EventTarget, clientY: number, points = 1): TouchEvent => {
  const event = new TouchEvent('touchstart', { bubbles: true });

  Object.defineProperty(event, 'touches', {
    value: points === 0 ? [] : [{ clientX: 50, clientY }],
    configurable: true,
  });
  Object.defineProperty(event, 'target', { value: target, configurable: true });

  return event;
};

/**
 * Six survivors are equivalent, in two groups.
 *
 * The centre-probe guard's first two operands are subsumed by the third:
 * `contains(null)` is false, `contains(outside)` is false, and when
 * `contains(centerProbe)` is true for the redactor itself the value returned is
 * the node the function would have returned anyway. Dropping either check, or
 * widening the pair to `||`, cannot change the answer.
 *
 * The `clientY === null` early return is equally inert: falling through
 * compares `null > contentRect.bottom`, which is false exactly as the guard's
 * own `false` was.
 */
describe('redactor touch handler mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolution.current = { kind: 'block', wrapper: document.createElement('div') };
    vi.spyOn(PopoverRegistry.instance, 'isSameTriggerPressActive').mockReturnValue(false);
    // jsdom does not implement hit testing at all, so the probe the handler
    // relies on has to exist before it can be spied on.
    Object.defineProperty(document, 'elementFromPoint', {
      value: () => null,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'elementFromPoint');
  });

  describe('a press below the last block', () => {
    it('moves the caret AND opens the toolbar on the last block when editable', () => {
      const fixture = build();

      fixture.handler(mouseAt(fixture.content, CONTENT_BOTTOM + 5));

      expect(fixture.setToTheLastBlock).toHaveBeenCalledTimes(1);
      expect(fixture.moveAndOpen.mock.calls).toStrictEqual([[fixture.lastBlock]]);
    });

    it('only moves the caret when read-only', () => {
      const fixture = build({ readOnly: true });

      fixture.handler(mouseAt(fixture.content, CONTENT_BOTTOM + 5));

      expect(fixture.setToTheLastBlock).toHaveBeenCalledTimes(1);
      expect(fixture.moveAndOpen).not.toHaveBeenCalled();
    });

    it('is not triggered by a press level with the content bottom', () => {
      const fixture = build();

      fixture.handler(mouseAt(fixture.content, CONTENT_BOTTOM));

      expect(fixture.setToTheLastBlock).not.toHaveBeenCalled();
      expect(fixture.moveAndOpen).toHaveBeenCalledTimes(1);
    });

    it('is not triggered by an event that carries no coordinates', () => {
      const fixture = build();
      const event = new Event('touchstart');

      Object.defineProperty(event, 'target', { value: fixture.content, configurable: true });
      fixture.handler(event);

      expect(fixture.setToTheLastBlock).not.toHaveBeenCalled();
    });

    it('treats a touch below the content exactly like a mouse press', () => {
      const fixture = build();

      fixture.handler(touchAt(fixture.content, CONTENT_BOTTOM + 5));

      expect(fixture.setToTheLastBlock).toHaveBeenCalledTimes(1);
      expect(fixture.moveAndOpen.mock.calls).toStrictEqual([[fixture.lastBlock]]);
    });

    it('is not triggered by a touch that carries no points', () => {
      const fixture = build();

      fixture.handler(touchAt(fixture.content, CONTENT_BOTTOM + 5, 0));

      expect(fixture.setToTheLastBlock).not.toHaveBeenCalled();
    });

    it('survives a block whose holder has no content element', () => {
      const fixture = build({ withContent: false });

      expect(() => fixture.handler(mouseAt(fixture.holder, CONTENT_BOTTOM + 5))).not.toThrow();
      expect(fixture.setToTheLastBlock).not.toHaveBeenCalled();
    });
  });

  describe('anchoring the toolbar', () => {
    it('looks the block up only when the pointer resolved to one', () => {
      const fixture = build({ currentIsLast: false });

      resolution.current = { kind: 'gutter', wrapper: null };
      fixture.handler(mouseAt(fixture.content, 20));

      expect(fixture.getBlockByChildNode).not.toHaveBeenCalled();
      expect(fixture.moveAndOpen.mock.calls[0][0]).toBeUndefined();
    });
  });

  describe('resolving the clicked node', () => {
    it('takes a press on a child at face value', () => {
      const redactor = document.createElement('div');
      const child = document.createElement('span');
      const fromPoint = vi.spyOn(document, 'elementFromPoint');

      expect(getClickedNode(child, mouseAt(child, 5), redactor)).toBe(child);
      expect(fromPoint).not.toHaveBeenCalled();
    });

    it('probes only for a mouse event, never for a bare one', () => {
      const redactor = document.createElement('div');
      const fromPoint = vi.spyOn(document, 'elementFromPoint');

      expect(getClickedNode(redactor, new Event('touchstart'), redactor)).toBe(redactor);
      expect(fromPoint).not.toHaveBeenCalled();
    });

    it('probes at the first touch point', () => {
      const redactor = document.createElement('div');
      const row = document.createElement('div');

      redactor.appendChild(row);
      document.body.appendChild(redactor);

      const fromPoint = vi.spyOn(document, 'elementFromPoint').mockReturnValue(row);

      expect(getClickedNode(redactor, touchAt(redactor, 9), redactor)).toBe(row);
      expect(fromPoint.mock.calls).toStrictEqual([[50, 9]]);
    });

    it('does not probe for a touch that carries no points', () => {
      const redactor = document.createElement('div');
      const fromPoint = vi.spyOn(document, 'elementFromPoint');

      expect(getClickedNode(redactor, touchAt(redactor, 9, 0), redactor)).toBe(redactor);
      expect(fromPoint).not.toHaveBeenCalled();
    });

    it('stops at the first probe when it lands on a real node', () => {
      const redactor = document.createElement('div');
      const row = document.createElement('div');

      redactor.appendChild(row);
      document.body.appendChild(redactor);

      const fromPoint = vi.spyOn(document, 'elementFromPoint').mockReturnValue(row);

      expect(getClickedNode(redactor, mouseAt(redactor, 5), redactor)).toBe(row);
      expect(fromPoint).toHaveBeenCalledTimes(1);
    });

    // A press in the redactor's own gutter resolves to the redactor itself, so
    // the row is found by re-probing at the horizontal centre of the same line.
    it('re-probes at the centre when the first probe hit the redactor', () => {
      const redactor = document.createElement('div');
      const row = document.createElement('div');

      redactor.appendChild(row);
      document.body.appendChild(redactor);
      Object.defineProperty(redactor, 'getBoundingClientRect', {
        value: () => ({ top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
        configurable: true,
      });

      const fromPoint = vi.spyOn(document, 'elementFromPoint')
        .mockReturnValueOnce(redactor)
        .mockReturnValueOnce(row);

      expect(getClickedNode(redactor, mouseAt(redactor, 5), redactor)).toBe(row);
      expect(fromPoint.mock.calls).toStrictEqual([[50, 5], [100, 5]]);
    });

    it.each(['nothing', 'the redactor again', 'a node outside the redactor'])(
      'keeps the redactor when the centre probe finds %s',
      (label) => {
      const redactor = document.createElement('div');
      const outside = document.createElement('div');

      document.body.append(redactor, outside);
      Object.defineProperty(redactor, 'getBoundingClientRect', {
        value: () => ({ top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
        configurable: true,
      });

      const byLabel: Record<string, HTMLElement | null> = {
        nothing: null,
        'the redactor again': redactor,
        'a node outside the redactor': outside,
      };

      vi.spyOn(document, 'elementFromPoint')
        .mockReturnValueOnce(redactor)
        .mockReturnValueOnce(byLabel[label]);

      expect(getClickedNode(redactor, mouseAt(redactor, 5), redactor)).toBe(redactor);
    }
    );
  });
});
