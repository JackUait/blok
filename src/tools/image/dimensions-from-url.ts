type Dims = { width: number; height: number };

function valid(w: unknown, h: unknown): Dims | null {
  const width = Number(w);
  const height = Number(h);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function fromSearchParams(params: URLSearchParams): Dims | null {
  const size = params.get('size') ?? params.get('dim') ?? params.get('dimensions');
  if (size) {
    const match = /^(\d+)[xX](\d+)$/.exec(size);
    if (match) return valid(match[1], match[2]);
  }
  const resize = params.get('resize') ?? params.get('fit');
  if (resize) {
    const match = /^(\d+),(\d+)$/.exec(resize);
    if (match) return valid(match[1], match[2]);
  }
  const w = params.get('w') ?? params.get('width') ?? params.get('imwidth');
  const h = params.get('h') ?? params.get('height') ?? params.get('imheight');
  if (w && h) return valid(w, h);
  return null;
}

function firstMatch(segments: string[], re: RegExp): string | null {
  for (const seg of segments) {
    const m = re.exec(seg);
    if (m) return m[1];
  }
  return null;
}

function fromCloudinary(pathname: string): Dims | null {
  const match = /\/(?:upload|fetch|private|authenticated)\/([^/]+(?:\/[^/]+)*)\//.exec(pathname);
  if (!match) return null;
  const segments = match[1].split('/');
  const w = firstMatch(segments, /(?:^|,)w_(\d+)(?:,|$)/);
  const h = firstMatch(segments, /(?:^|,)h_(\d+)(?:,|$)/);
  return w && h ? valid(w, h) : null;
}

function fromCloudflare(pathname: string): Dims | null {
  const match = /\/cdn-cgi\/image\/([^/]+)\//.exec(pathname);
  if (!match) return null;
  const w = /(?:^|,)width=(\d+)(?:,|$)/.exec(match[1]);
  const h = /(?:^|,)height=(\d+)(?:,|$)/.exec(match[1]);
  return w && h ? valid(w[1], h[1]) : null;
}

function fromImageKit(pathname: string): Dims | null {
  const match = /\/tr:([^/]+)\//.exec(pathname);
  if (!match) return null;
  const w = /(?:^|,)w-(\d+)(?:,|$)/.exec(match[1]);
  const h = /(?:^|,)h-(\d+)(?:,|$)/.exec(match[1]);
  return w && h ? valid(w[1], h[1]) : null;
}

function fromPath(pathname: string): Dims | null {
  return fromCloudinary(pathname) ?? fromCloudflare(pathname) ?? fromImageKit(pathname);
}

function fromFilename(pathname: string): Dims | null {
  const base = pathname.split('/').pop() ?? '';
  const wh = /[-_](\d{2,5})[xX](\d{2,5})(?:[._-]|\.[a-z0-9]+$)/.exec(base);
  if (wh) return valid(wh[1], wh[2]);
  const sep = /[-_]w(\d+)[-_]h(\d+)/.exec(base);
  if (sep) return valid(sep[1], sep[2]);
  return null;
}

function safeParse(url: string): URL | null {
  try {
    return new URL(url, 'https://base.local');
  } catch {
    return null;
  }
}

export function dimensionsFromUrl(url: string): Dims | null {
  if (!url) return null;
  const parsed = safeParse(url);
  if (!parsed) return null;
  return fromSearchParams(parsed.searchParams) ?? fromPath(parsed.pathname) ?? fromFilename(parsed.pathname);
}
