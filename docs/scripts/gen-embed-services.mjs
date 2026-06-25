import * as si from "simple-icons";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

// Brand colours for services simple-icons no longer ships (rendered as monograms).
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

const out = [];
const missing = [];
for (const [title] of SERVICES) {
  let icon = null;
  const slug = SLUG[title];
  if (slug && bySlug.has(slug)) icon = bySlug.get(slug);
  if (!icon) icon = byTitle.get(norm(title)) ?? null;
  if (!icon) {
    missing.push(title);
    out.push({ title, hex: FALLBACK_HEX[title] ?? "#64748B", path: null });
  } else {
    out.push({ title, hex: "#" + icon.hex, path: icon.path });
  }
}

const body =
  "// AUTO-GENERATED — do not edit by hand.\n" +
  "// Service list mirrors src/tools/link/registry.ts; logos + brand colours come\n" +
  "// from simple-icons. Regenerate: node docs/scripts/gen-embed-services.mjs\n" +
  "export interface EmbedService {\n  title: string;\n  hex: string | null;\n  path: string | null;\n}\n\n" +
  "export const EMBED_SERVICES: EmbedService[] = " +
  JSON.stringify(out, null, 2) +
  ";\n";

writeFileSync(OUT, body);
console.log("written:", out.length, "services ->", OUT);
console.log("MISSING (", missing.length, "):", missing.join(", "));
