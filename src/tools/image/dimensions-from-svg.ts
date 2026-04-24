type Dims = { width: number; height: number };

function parseNumber(raw: string | null): number | null {
  if (raw == null) return null;
  const match = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(raw.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isSvgUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url, 'https://base.local');
    return /\.svg(?:$|\?|#)/i.test(pathname);
  } catch {
    return false;
  }
}

async function fetchSvgText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function dimsFromViewBox(viewBox: string | null): Dims | null {
  if (!viewBox) return null;
  const parts = viewBox.trim().split(/[\s,]+/);
  if (parts.length !== 4) return null;
  const vw = parseNumber(parts[2]);
  const vh = parseNumber(parts[3]);
  if (vw == null || vh == null) return null;
  return { width: vw, height: vh };
}

export async function dimensionsFromSvg(url: string): Promise<Dims | null> {
  if (!isSvgUrl(url)) return null;
  const text = await fetchSvgText(url);
  if (text == null) return null;
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return null;

  const w = parseNumber(root.getAttribute('width'));
  const h = parseNumber(root.getAttribute('height'));
  if (w != null && h != null) return { width: w, height: h };

  return dimsFromViewBox(root.getAttribute('viewBox'));
}
