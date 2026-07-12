import * as si from "simple-icons";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

const OUT = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "../src/components/home/embed-services.ts");

const icons = Object.values(si).filter((v) => v && v.slug && v.path);
const bySlug = new Map(icons.map((i) => [i.slug, i]));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const byTitle = new Map();
for (const i of icons) {
  const k = norm(i.title);
  if (!byTitle.has(k)) byTitle.set(k, i);
}

// title -> explicit simple-icons slug (only where title-match won't resolve it)
const SLUG = {
  "VK Video": "vk",
  "draw.io": "diagramsdotnet",
  "Naver TV": "naver",
  "OK.ru": "odnoklassniki",
  "Yandex Music": "yandexmusic",
  "Apple Music": "applemusic",
  "Apple Podcasts": "applepodcasts",
  "Google Drive": "googledrive",
  "Google Docs": "googledocs",
  "Google Sheets": "googlesheets",
  "Google Slides": "googleslides",
  "Google Forms": "googleforms",
  "Spotify for Creators": "spotify",
  "Pocket Casts": "pocketcasts",
  iHeart: "iheartradio",
  "NetEase Cloud Music": "neteasecloudmusic",
  "Internet Archive": "internetarchive",
  "X (Twitter)": "x",
  "Mail.ru": "maildotru",
  "p5.js": "p5dotjs",
  "Wolfram Cloud": "wolframmathematica",
  Douyin: "tiktok",
  KakaoTV: "kakaotalk",
  "ArcGIS StoryMaps": "arcgis",
};

// Real brand glyphs simple-icons doesn't ship, sourced from CoreUI Brands (cib).
// Single-path, currentColor, 32x32 viewBox — render identically to simple-icons.
const SUPPLEMENT = {
  CodePen: {
    hex: "#000000",
    vb: 32,
    path: "m32 10.912l-.027-.12l-.02-.063q-.022-.052-.041-.104c0-.021-.016-.041-.027-.063l-.047-.093l-.036-.063l-.063-.084l-.057-.057l-.084-.063l-.063-.041l-.077-.057l-.057-.052l-.021-.025L16.771.255a1.35 1.35 0 0 0-1.52 0L.527 10.068l-.079.068l-.052.052l-.068.077l-.047.057l-.068.084c-.025.02-.041.036-.041.057l-.068.083l-.025.079c-.027.015-.027.052-.043.093l-.009.068c-.027.041-.027.077-.027.12v9.995c0 .063.005.12.016.181l.011.063a1 1 0 0 0 .025.115l.021.063c.015.037.02.073.036.104l.031.063c0 .016.016.057.037.084l.041.052c.021.015.041.052.063.077l.036.057l.052.052c.016.016.016.043.043.043l.077.052l.057.041l.011.021l14.631 9.771c.219.161.5.219.76.219c.255 0 .516-.084.755-.24l14.881-9.875l.067-.079l.047-.063l.052-.077l.043-.068l.036-.093l.021-.068l.041-.104l.021-.057l.041-.109v-10c0-.063 0-.125-.027-.188l-.015-.057l.057.005zm-15.984 8.369l-4.871-3.251l4.871-3.26l4.864 3.256zm-1.38-8.896l-5.964 3.984l-4.817-3.219l10.781-7.187zm-8.443 5.642l-3.444 2.307v-4.599l3.444 2.301zm2.479 1.666l5.964 3.989v6.427L3.855 20.921l4.823-3.228zm8.713 3.99l5.969-3.975l4.817 3.224l-10.787 7.188zm8.443-5.642l3.443-2.292v4.605l-3.443-2.308zm-2.473-1.656l-5.964-3.984V3.958l10.781 7.187l-4.817 3.219z",
  },
  LinkedIn: {
    hex: "#0A66C2",
    vb: 32,
    path: "M27.26 27.271h-4.733v-7.427c0-1.771-.037-4.047-2.475-4.047c-2.468 0-2.844 1.921-2.844 3.916v7.557h-4.739V11.999h4.552v2.083h.061c.636-1.203 2.183-2.468 4.491-2.468c4.801 0 5.692 3.161 5.692 7.271v8.385zM7.115 9.912a2.75 2.75 0 0 1-2.751-2.756a2.753 2.753 0 1 1 2.751 2.756m2.374 17.359H4.74V12h4.749zM29.636 0H2.36C1.057 0 0 1.031 0 2.307v27.387c0 1.276 1.057 2.307 2.36 2.307h27.271c1.301 0 2.369-1.031 2.369-2.307V2.307C32 1.031 30.932 0 29.631 0z",
  },
};

// Services with no logo in any icon library: we fall back to their real
// favicon (the brand's own app icon), fetched at generation time and inlined
// as a base64 data URI so the bundle stays self-contained.
const DOMAINS = {
  RUTUBE: "rutube.ru", Youku: "youku.com", "Yandex Music": "music.yandex.ru", ARTE: "www.arte.tv",
  Anghami: "anghami.com", Streamable: "streamable.com", Vidyard: "vidyard.com", Desmos: "desmos.com",
  SOOP: "sooplive.com", Coub: "coub.com", BitChute: "bitchute.com", Acast: "acast.com",
  Podbean: "podbean.com", Buzzsprout: "buzzsprout.com", Transistor: "transistor.fm", TuneIn: "tunein.com",
  Boomplay: "boomplay.com", Tally: "tally.so", Jotform: "jotform.com", Whimsical: "whimsical.com",
  Mentimeter: "mentimeter.com", Plunker: "plnkr.co", Datawrapper: "datawrapper.de", Flourish: "flourish.studio",
  "Our World in Data": "ourworldindata.org", GeoGebra: "geogebra.org", Genially: "genially.com", Infogram: "infogram.com",
  Felt: "felt.com", Wakelet: "wakelet.com", "Poll Everywhere": "polleverywhere.com", "Tencent Video": "v.qq.com",
  Kinescope: "kinescope.io", Vidio: "vidio.com", Smotrim: "smotrim.ru",
};

async function fetchFavicon(domain) {
  const r = await fetch(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 120) return null; // generic globe fallback
  const type = (r.headers.get("content-type") || "image/png").split(";")[0];
  return { img: `data:${type};base64,${buf.toString("base64")}`, buf, type };
}

// Favicons below this native resolution look soft on a retina tile; we drop
// those services from the carousel rather than show a pixelated logo.
const MIN_FAVICON_RES = 64;

function decodeFavicon({ buf, type }) {
  try {
    return type === "image/jpeg" ? jpeg.decode(buf, { useTArray: true, formatAsRGBA: true }) : PNG.sync.read(buf);
  } catch {
    return null;
  }
}

// Sample the favicon's edge ring and return the dominant opaque colour, so the
// tile background can extend the icon's own border seamlessly. Returns null when
// the border is transparent (a glyph-only favicon) — caller keeps the brand hex.
function edgeColor(img) {
  const { width: w, height: h, data } = img;
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const inset = Math.max(1, Math.round(w * 0.06)); // skip anti-aliased rounded corners
  const pts = [];
  for (let f = 1; f <= 7; f++) {
    const x = Math.round((w - 1) * (f / 8));
    const y = Math.round((h - 1) * (f / 8));
    pts.push([x, inset], [x, h - 1 - inset], [inset, y], [w - 1 - inset, y]);
  }
  const opaque = pts.map((p) => at(p[0], p[1])).filter((c) => c[3] > 230);
  if (opaque.length < pts.length * 0.5) return null; // mostly transparent border
  const avg = opaque.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]).map((s) => Math.round(s / opaque.length));
  return "#" + avg.map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Brand colours for services that resolve to neither a glyph nor a favicon (monogram of last resort).
const FALLBACK_HEX = {
  RUTUBE: "#000000", CodePen: "#0B0B0B", Youku: "#00A0E9", "Yandex Music": "#FFCC00",
  ARTE: "#FF1400", Anghami: "#B5179E", Streamable: "#0F90FA", Vidyard: "#2E3192",
  Desmos: "#2D70B3", LinkedIn: "#0A66C2", SOOP: "#1F6FEB", Coub: "#4F4FFB",
  BitChute: "#EF4137", Acast: "#8A4FFF", Podbean: "#71B84A", Buzzsprout: "#E03A3E",
  Transistor: "#7C5CFC", TuneIn: "#14D8CC", Boomplay: "#E64B16", Tally: "#1F1F1F",
  Jotform: "#FF6100", Whimsical: "#6B4DFF", Mentimeter: "#2962FF", Plunker: "#E8732C",
  Datawrapper: "#1D81A2", Flourish: "#FA4B42", "Our World in Data": "#1D3D63",
  GeoGebra: "#1565C0", Genially: "#5A35DE", Infogram: "#E6522C", Felt: "#5E5CE6",
  Wakelet: "#1E6FD9", "Poll Everywhere": "#C0392B", "Tencent Video": "#FF7E00",
  Kinescope: "#5B3FFF", Vidio: "#49B882", Smotrim: "#2B53A7", CodePen: "#0B0B0B",
};

// All 111 services, with a fallback brand colour for any missing from simple-icons.
const SERVICES = [
  ["YouTube"], ["Vimeo"], ["RUTUBE"], ["VK Video"], ["CodePen"], ["Loom"], ["Figma"],
  ["Spotify"], ["Google Drive"], ["Google Docs"], ["Google Sheets"], ["Google Slides"],
  ["Google Forms"], ["draw.io"], ["bilibili"], ["niconico"], ["Youku"], ["Naver TV"],
  ["KakaoTV"], ["Dailymotion"], ["OK.ru"], ["Yandex Music"], ["ARTE"], ["Deezer"],
  ["SoundCloud"], ["Mixcloud"], ["Apple Music"], ["Apple Podcasts"], ["Audiomack"],
  ["Anghami"], ["Streamable"], ["TikTok"], ["Wistia"], ["Vidyard"], ["GIPHY"],
  ["CodeSandbox"], ["StackBlitz"], ["Typeform"], ["Airtable"], ["Miro"], ["Desmos"],
  ["Observable"], ["JSFiddle"], ["Reddit"], ["Instagram"], ["Facebook"], ["LinkedIn"],
  ["Mastodon"], ["Pinterest"], ["Snapchat"], ["Substack"], ["TED"], ["Internet Archive"],
  ["Kick"], ["PeerTube"], ["Odysee"], ["SOOP"], ["Coub"], ["BitChute"], ["TIDAL"],
  ["Spotify for Creators"], ["Pocket Casts"], ["iHeart"], ["Acast"], ["Podbean"],
  ["Spreaker"], ["Buzzsprout"], ["Castbox"], ["Transistor"], ["Audioboom"], ["TuneIn"],
  ["Beatport"], ["NetEase Cloud Music"], ["Suno"], ["hearthis.at"], ["Boomplay"],
  ["Calendly"], ["Tally"], ["Jotform"], ["Whimsical"], ["Excalidraw"], ["tldraw"],
  ["Mentimeter"], ["Behance"], ["Chromatic"], ["Plunker"], ["Datawrapper"], ["Flourish"],
  ["Our World in Data"], ["GeoGebra"], ["Scratch"], ["Kahoot!"], ["Genially"], ["Infogram"],
  ["ArcGIS StoryMaps"], ["Felt"], ["p5.js"], ["Wakelet"], ["Poll Everywhere"],
  ["Wolfram Cloud"], ["Sketchfab"], ["OpenStreetMap"], ["Tencent Video"], ["Douyin"],
  ["Kinescope"], ["Vidio"], ["Mail.ru"], ["Smotrim"], ["X (Twitter)"], ["Telegram"],
  ["Threads"],
];

// Services intentionally excluded from the carousel (by request) — poor-looking
// tiles: Podbean, tldraw (white glyph on near-white), BitChute (red on red),
// Poll Everywhere (low-quality favicon).
const EXCLUDE = new Set(["Podbean", "tldraw", "BitChute", "Poll Everywhere", "Genially", "KakaoTV"]);

// Per-tile look overrides. `fg` recolours the glyph (default white). KakaoTalk's
// white bubble on yellow read as a logo-in-a-logo, so it gets a white tile with
// the brand-yellow bubble instead.
const OVERRIDE = {
  // Tally's flower filled the tile edge-to-edge; inset it on a white frame.
  Tally: { hex: "#FFFFFF", pad: true },
};

const out = [];
const dropped = [];
for (const [title] of SERVICES) {
  if (EXCLUDE.has(title)) {
    dropped.push(`${title} (excluded)`);
    continue;
  }
  let icon = null;
  const slug = SLUG[title];
  if (slug && bySlug.has(slug)) icon = bySlug.get(slug);
  if (!icon) icon = byTitle.get(norm(title)) ?? null;
  if (icon) {
    out.push({ title, hex: "#" + icon.hex, path: icon.path });
  } else if (SUPPLEMENT[title]) {
    const { hex, path, vb } = SUPPLEMENT[title];
    out.push({ title, hex, path, vb });
  } else if (DOMAINS[title]) {
    const fav = await fetchFavicon(DOMAINS[title]);
    const decoded = fav ? decodeFavicon(fav) : null;
    if (decoded && decoded.width >= MIN_FAVICON_RES) {
      const ec = edgeColor(decoded);
      const hex = ec ?? FALLBACK_HEX[title] ?? "#64748B";
      out.push({ title, hex, path: null, img: fav.img, ...(ec ? { cover: true } : {}) });
    } else {
      dropped.push(`${title} (${decoded ? decoded.width + "px" : "no favicon"})`);
    }
  } else {
    dropped.push(`${title} (no source)`);
  }
}

for (const s of out) {
  if (OVERRIDE[s.title]) Object.assign(s, OVERRIDE[s.title]);
}

const body =
  "// AUTO-GENERATED — do not edit by hand.\n" +
  "// Service list mirrors src/tools/link/registry.ts; logos + brand colours come\n" +
  "// from simple-icons (plus a few from CoreUI Brands). Services with no library\n" +
  "// logo carry `img`: their real favicon, inlined as a base64 data URI.\n" +
  "// Regenerate: node docs/scripts/gen-embed-services.mjs\n" +
  "export interface EmbedService {\n  title: string;\n  /** Tile background: brand colour, or the favicon's sampled edge colour. */\n  hex: string | null;\n  path: string | null;\n  /** Glyph viewBox size; defaults to 24 (simple-icons). */\n  vb?: number;\n  /** Base64 favicon data URI, when no vector glyph exists. */\n  img?: string;\n  /** Favicon fills the tile edge-to-edge (app-icon with a solid edge). */\n  cover?: boolean;\n  /** Glyph colour override; defaults to white. */\n  fg?: string;\n  /** Inset the favicon a bit instead of filling the tile edge-to-edge. */\n  pad?: boolean;\n}\n\n" +
  "export const EMBED_SERVICES: EmbedService[] = " +
  JSON.stringify(out, null, 2) +
  ";\n";

writeFileSync(OUT, body);
console.log("written:", out.length, "services ->", OUT);
console.log("DROPPED low-res (", dropped.length, "):", dropped.join(", "));
