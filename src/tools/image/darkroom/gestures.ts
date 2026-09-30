import type { Handle } from '../crop-math';
import type { Point } from './camera';

export type GestureKind = 'pan' | 'handle' | 'zoom';

export interface GestureHandlers {
  onStart(kind: GestureKind): void;
  onPan(dx: number, dy: number): void;
  onHandle(handle: Handle, dx: number, dy: number): void;
  onZoom(factor: number, center: Point, dx: number, dy: number): void;
  onEnd(kind: GestureKind): void;
  onPeek(active: boolean): void;
}

export const HOLD_MS = 350;
export const SLOP_PX = 4;
export const WHEEL_IDLE_MS = 250;

// macOS trackpad pinch arrives as ctrl+wheel with small deltas; a mouse wheel needs a gentler rate.
const PINCH_RATE = 0.01;
const WHEEL_RATE = 0.002;

type Mode = 'idle' | 'pending' | 'pan' | 'handle' | 'pinch' | 'peek';

const isHandle = (v: string | null): v is Handle =>
  v !== null && ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].includes(v);

export function attachGestures(stage: HTMLElement, h: GestureHandlers): () => void {
  const pointers = new Map<number, Point>();
  const st = {
    mode: 'idle' as Mode,
    origin: { x: 0, y: 0 },
    handle: 'se' as Handle,
    hold: 0,
    wheelIdle: 0,
    pinchDist: 0,
    pinchMid: { x: 0, y: 0 },
  };

  const local = (e: MouseEvent): Point => {
    const r = stage.getBoundingClientRect();

    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const pinchGeometry = (): { dist: number; mid: Point } => {
    const [a, b] = [...pointers.values()];

    return { dist: Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const endActive = (): void => {
    window.clearTimeout(st.hold);
    if (st.mode === 'pan' || st.mode === 'handle') h.onEnd(st.mode);
    if (st.mode === 'pinch') h.onEnd('zoom');
    if (st.mode === 'peek') h.onPeek(false);
    st.mode = 'idle';
  };

  const onDown = (e: PointerEvent): void => {
    const p = local(e);

    pointers.set(e.pointerId, p);
    stage.setPointerCapture?.(e.pointerId);
    e.preventDefault();

    if (pointers.size === 2) {
      endActive();
      const g = pinchGeometry();

      st.mode = 'pinch';
      st.pinchDist = g.dist;
      st.pinchMid = g.mid;
      h.onStart('zoom');

      return;
    }
    if (pointers.size > 2) return;

    const handle = e.target instanceof Element ? e.target.closest('[data-handle]')?.getAttribute('data-handle') ?? null : null;

    st.origin = p;
    if (isHandle(handle)) {
      st.mode = 'handle';
      st.handle = handle;
      h.onStart('handle');

      return;
    }
    st.mode = 'pending';
    st.hold = window.setTimeout(() => {
      if (st.mode !== 'pending') return;
      st.mode = 'peek';
      h.onPeek(true);
    }, HOLD_MS);
  };

  const onMove = (e: PointerEvent): void => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);

    pointers.set(e.pointerId, p);
    const dx = p.x - st.origin.x;
    const dy = p.y - st.origin.y;

    if (st.mode === 'pending' && Math.hypot(dx, dy) > SLOP_PX) {
      window.clearTimeout(st.hold);
      st.mode = 'pan';
      h.onStart('pan');
    }
    if (st.mode === 'pan') h.onPan(dx, dy);
    if (st.mode === 'handle') h.onHandle(st.handle, dx, dy);
    if (st.mode === 'pinch' && pointers.size === 2) {
      const g = pinchGeometry();

      h.onZoom(g.dist / st.pinchDist, g.mid, g.mid.x - st.pinchMid.x, g.mid.y - st.pinchMid.y);
      st.pinchDist = g.dist;
      st.pinchMid = g.mid;
    }
  };

  const onUp = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    if (st.mode === 'pinch' && pointers.size === 1) {
      h.onEnd('zoom');
      // The finger left on the glass does nothing until it lifts too.
      st.mode = 'idle';

      return;
    }
    if (pointers.size === 0) endActive();
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rate = e.ctrlKey ? PINCH_RATE : WHEEL_RATE;

    if (st.wheelIdle === 0) h.onStart('zoom');
    window.clearTimeout(st.wheelIdle);
    h.onZoom(Math.exp(-e.deltaY * rate), local(e), 0, 0);
    st.wheelIdle = window.setTimeout(() => {
      st.wheelIdle = 0;
      h.onEnd('zoom');
    }, WHEEL_IDLE_MS);
  };

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('wheel', onWheel, { passive: false });

  return (): void => {
    window.clearTimeout(st.hold);
    window.clearTimeout(st.wheelIdle);
    stage.removeEventListener('pointerdown', onDown);
    stage.removeEventListener('pointermove', onMove);
    stage.removeEventListener('pointerup', onUp);
    stage.removeEventListener('pointercancel', onUp);
    stage.removeEventListener('wheel', onWheel);
  };
}
