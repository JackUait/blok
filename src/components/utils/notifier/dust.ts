import { prefersReducedMotion } from '../reduced-motion';

/** How long the sweep takes to cross the card. */
export const DUST_MS = 640;

/** How long the last specks drift after the sweep ends. */
export const DUST_LIFE_MS = 900;

/** Room around the card for specks to drift into: they rise and blow toward the close side. */
const ROOM = { up: 80, side: 56, down: 12 };

/** Specks per square pixel of card the edge passes. */
const DENSITY = 1 / 20;

const MAX_DPR = 2;

interface Speck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lift: number;
  sway: number;
  phase: number;
  born: number;
  life: number;
  size: number;
  color: string;
}

interface Dust {
  paint(now: number, progress: number): void;
  remove(): void;
}

const between = (low: number, high: number): number => low + Math.random() * (high - low);

/**
 * Slow start, fast middle, soft end: the card gives way, then lets go.
 */
const sweep = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

/**
 * Where the mask's soft edge sits, as a share of the card width. Tied to the
 * mask in notifier-card.css: a 220% gradient whose band is centred at 110%.
 */
const edgeAt = (progress: number, rtl: boolean): number => (rtl ? -0.1 + 1.2 * progress : 1.1 - 1.2 * progress);

/**
 * Reads the picked image's pixels so specks shed from the tile carry its colours.
 * @returns a colour at card coordinates, or null outside the tile or when the pixels can't be read
 */
const tileSampler = (notify: HTMLElement, box: DOMRect): ((x: number, y: number) => string | null) => {
  const img = notify.querySelector<HTMLImageElement>('[data-blok-toast-part="thumb"] img');

  if (img === null || !img.complete || img.naturalWidth === 0) {
    return () => null;
  }
  const rect = img.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const scratch = document.createElement('canvas');

  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext('2d');

  if (context === null) {
    return () => null;
  }
  try {
    context.drawImage(img, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const left = rect.left - box.left;
    const top = rect.top - box.top;

    return (x, y) => {
      const px = Math.floor(x - left);
      const py = Math.floor(y - top);

      if (px < 0 || py < 0 || px >= width || py >= height) {
        return null;
      }
      const at = (py * width + px) * 4;

      return `rgb(${data[at]} ${data[at + 1]} ${data[at + 2]})`;
    };
  } catch {
    // A tainted image (cross-origin) cannot be read; its specks take the card's colours.
    return () => null;
  }
};

const createDust = (host: HTMLElement, notify: HTMLElement, box: DOMRect, rtl: boolean): Dust | null => {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (context === null) {
    return null;
  }
  const origin = host.getBoundingClientRect();
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const width = box.width + ROOM.side * 2;
  const height = box.height + ROOM.up + ROOM.down;
  const look = window.getComputedStyle(notify);
  const tone = (name: string, fallback: string): string => look.getPropertyValue(name).trim() || fallback;
  const palette = {
    body: tone('--blok-toast-dust-body', '#26262a'),
    shade: tone('--blok-toast-dust-shade', '#1c1c1f'),
    glint: tone('--blok-toast-dust-glint', '#f5f5f5'),
  };
  const sample = tileSampler(notify, box);
  const away = rtl ? -1 : 1;
  const specks: Speck[] = [];
  const state = { edge: edgeAt(0, rtl) * box.width };

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    left: `${box.left - origin.left - ROOM.side}px`,
    top: `${box.top - origin.top - ROOM.up}px`,
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: 'none',
    // Above the leaving card, which sits above the next one.
    zIndex: '2',
  });
  host.appendChild(canvas);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Glints stay rare: on the dark card they read as noise, not dust.
  const mix = [ { below: 0.7, color: palette.body }, { below: 0.97, color: palette.shade }, { below: 1, color: palette.glint } ];
  const colorAt = (x: number, y: number): string => {
    const roll = Math.random();

    return sample(x, y) ?? (mix.find((tone) => roll < tone.below) ?? mix[mix.length - 1]).color;
  };

  const shed = (from: number, to: number, now: number): void => {
    const start = Math.max(0, Math.min(box.width, Math.min(from, to)));
    const end = Math.max(0, Math.min(box.width, Math.max(from, to)));
    const count = Math.round((end - start) * box.height * DENSITY);

    Array.from({ length: count }).forEach(() => {
      const x = between(start, end);
      const y = between(0, box.height);

      specks.push({
        x,
        y,
        vx: away * between(40, 170),
        vy: -between(20, 90),
        lift: between(60, 220),
        sway: between(1, 6),
        phase: between(0, Math.PI * 2),
        born: now,
        life: between(DUST_LIFE_MS * 0.45, DUST_LIFE_MS),
        size: between(1, 2.6),
        color: colorAt(x, y),
      });
    });
  };

  return {
    paint: (now, progress) => {
      const edge = edgeAt(progress, rtl) * box.width;

      shed(state.edge, edge, now);
      state.edge = edge;
      context.clearRect(0, 0, width, height);

      const living = specks.filter((speck) => now - speck.born < speck.life);

      specks.length = 0;
      living.forEach((speck) => specks.push(speck));
      specks.forEach((speck) => {
        const age = now - speck.born;
        const s = age / 1000;
        const x = speck.x + speck.vx * s + Math.sin(speck.phase + s * 9) * speck.sway;
        const y = speck.y + speck.vy * s - 0.5 * speck.lift * s * s;

        context.globalAlpha = (1 - age / speck.life) ** 1.4;
        context.fillStyle = speck.color;
        context.fillRect(ROOM.side + x, ROOM.up + y, speck.size, speck.size);
      });
    },
    remove: () => canvas.remove(),
  };
};

/**
 * Turns a closing card into dust: a soft edge sweeps in from the close side,
 * eating the card, and specks peel off it and drift up and away.
 * Removal runs on timers, not frames, so a hidden tab still clears the card.
 * @param notify - the closing card
 * @param onGone - called once the card and its dust are gone
 * @param onRemoved - called when the card leaves the layout, while its dust still drifts
 * @returns false when the card should leave the plain way (reduced motion, or detached)
 */
export const dissolve = (notify: HTMLElement, onGone: () => void, onRemoved?: () => void): boolean => {
  const host = notify.parentElement;

  if (host === null || prefersReducedMotion()) {
    return false;
  }
  const rtl = window.getComputedStyle(notify).direction === 'rtl';
  const box = notify.getBoundingClientRect();
  const dust = typeof CanvasRenderingContext2D === 'undefined' ? null : createDust(host, notify, box, rtl);
  const start = performance.now();
  const life = { running: true };

  notify.setAttribute('data-blok-toast-dust', rtl ? 'rtl' : 'ltr');

  const frame = (now: number): void => {
    if (!life.running) {
      return;
    }
    const progress = sweep(Math.min(1, Math.max(0, (now - start) / DUST_MS)));

    notify.style.setProperty('--_blok-toast-dust', String(progress));
    dust?.paint(now, progress);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
  window.setTimeout(() => {
    notify.remove();
    onRemoved?.();
  }, DUST_MS);
  window.setTimeout(() => {
    life.running = false;
    dust?.remove();
    onGone();
  }, DUST_MS + DUST_LIFE_MS);

  return true;
};
