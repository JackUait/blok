import type * as MapLibre from 'maplibre-gl';

export type MapLibreModule = typeof MapLibre;

const state: { pending: Promise<MapLibreModule> | null } = { pending: null };

/**
 * MapLibre and its worker load only when a map draws, so an editor without
 * maps pays nothing. A failed download is retried by the next map.
 */
export const loadMapLibre = (): Promise<MapLibreModule> => {
  state.pending ??= import('./maplibre-runtime')
    .then((runtime) => runtime.boot())
    .catch((error: unknown) => {
      state.pending = null;
      throw error;
    });

  return state.pending;
};

/** MapLibre draws with WebGL. Server rendering and blocked GPUs have none. */
export const supportsWebGL = (): boolean => {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');

    return (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) !== null;
  } catch {
    return false;
  }
};
