import type { ImageAdjust, ImageCrop, ImageFilterPreset } from '../../../../types/tools/image';
import { createSpring, SPRING_SOFT, type SpringClock } from '../../../components/utils/spring';
import { promoteToTopLayer } from '../../../components/utils/top-layer';
import { IDENTITY, orientedSize, type Geometry } from '../geometry';
import { applyImageFilter, buildPlane, sizePlane } from '../image-view';
import { rectToCamera, type Box, type Size } from './camera';

/** Sizes the plane to O in px so the camera transform maps O px to stage px. */
export function fitCameraPlane(plane: HTMLElement, img: HTMLImageElement, n: Size, g: Geometry): void {
  const o = orientedSize(n, g);

  sizePlane(plane, img, n, g);
  plane.style.setProperty('width', `${o.w}px`);
  plane.style.setProperty('height', `${o.h}px`);
}

/** The shared renderer plane, moved by a camera instead of laid out in flow. Without `n`, call fitCameraPlane once known. */
export function cameraPlane(img: HTMLImageElement, n: Size | null, g: Geometry): HTMLElement {
  const plane = buildPlane(img, n, g);

  // buildPlane lays the plane out in flow; the camera places it from its parent's corner (left/top live in darkroom.css).
  plane.style.position = 'absolute';
  if (n) fitCameraPlane(plane, img, n, g);

  return plane;
}

export const CHROME_OUT_MS = 120;
export const CHROME_BACK_DELAY_MS = 400;

export interface Dissolve {
  begin(): void;
  end(): void;
  destroy(): void;
}

/** Opacity only: hiding the chrome would drop keyboard focus and break the focus trap. */
export function createDissolve(targets: HTMLElement[], grid: HTMLElement): Dissolve {
  const st = { back: 0 };

  return {
    begin() {
      window.clearTimeout(st.back);
      targets.forEach((el) => el.style.setProperty('opacity', '0'));
      grid.style.setProperty('opacity', '1');
    },
    end() {
      window.clearTimeout(st.back);
      st.back = window.setTimeout(() => {
        targets.forEach((el) => el.style.removeProperty('opacity'));
        grid.style.removeProperty('opacity');
      }, CHROME_BACK_DELAY_MS);
    },
    destroy() {
      window.clearTimeout(st.back);
    },
  };
}

export interface FlyOutOptions {
  url: string;
  natural: Size;
  /** Crop in the oriented box. */
  rect: ImageCrop;
  geometry?: Geometry;
  filter?: ImageFilterPreset;
  adjust?: ImageAdjust;
  from: Box;
  fromRound: number;
  target: HTMLElement | null;
  targetRound: number;
  clock?: SpringClock;
  reducedMotion?: () => boolean;
  /** The dark surround left behind by the closed dialog; fades out with the flight. */
  veil?: HTMLElement | null;
  onDone?(): void;
}

/** Must be promoted before the flight shell, so the shell stacks above it. */
export function createVeil(): HTMLElement {
  const veil = document.createElement('div');

  veil.className = 'blok-darkroom-veil';
  veil.setAttribute('data-role', 'darkroom-veil');
  veil.setAttribute('aria-hidden', 'true');
  document.body.appendChild(veil);
  promoteToTopLayer(veil);

  return veil;
}

export const isOnScreen = (r: DOMRect): boolean => r.width > 0 && r.height > 0
  && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;

export function flyOut(opts: FlyOutOptions): void {
  const shell = document.createElement('div');

  shell.className = 'blok-darkroom-flight';
  shell.setAttribute('data-role', 'darkroom-flight');
  shell.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img');
  const geometry = opts.geometry ?? IDENTITY;
  const o = orientedSize(opts.natural, geometry);

  img.src = opts.url;
  img.alt = '';
  applyImageFilter(img, opts.filter ?? 'none', opts.adjust ?? {});
  const plane = cameraPlane(img, opts.natural, geometry);

  shell.appendChild(plane);
  document.body.appendChild(shell);
  promoteToTopLayer(shell);
  const veil = opts.veil ?? null;

  const { target } = opts;
  const box = target?.getBoundingClientRect() ?? null;
  const land = box !== null && isOnScreen(box) ? box : null;

  if (target) target.style.visibility = 'hidden';

  const paint = (v: Readonly<Record<'x' | 'y' | 'w' | 'h' | 'round' | 'o' | 'veil', number>>): void => {
    if (veil) veil.style.opacity = String(v.veil);
    shell.style.transform = `translate(${v.x}px, ${v.y}px)`;
    shell.style.width = `${v.w}px`;
    shell.style.height = `${v.h}px`;
    shell.style.opacity = String(v.o);
    shell.style.setProperty('--blok-radius-darkroom-frame', `${v.round * 50}%`);
    const cam = rectToCamera(opts.rect, o, { x: 0, y: 0, w: v.w, h: v.h });

    plane.style.transform = `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})`;
  };

  const spring = createSpring({
    from: { ...opts.from, round: opts.fromRound, o: 1, veil: 1 },
    config: SPRING_SOFT,
    clock: opts.clock,
    reducedMotion: opts.reducedMotion,
    onUpdate: paint,
    onSettle: () => {
      shell.remove();
      veil?.remove();
      if (target) target.style.visibility = '';
      opts.onDone?.();
    },
  });

  paint(spring.values());
  spring.to(land
    ? { x: land.left, y: land.top, w: land.width, h: land.height, round: opts.targetRound, veil: 0 }
    : { o: 0, veil: 0 });
}
