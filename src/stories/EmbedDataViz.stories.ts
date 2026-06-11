import type { Meta, StoryObj } from '@storybook/html-vite';

import { Embed, type EmbedData } from '../tools/link/embed';
import { EMBED_SERVICES, matchEmbedService } from '../tools/link/registry';

import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData } from '@/types';

interface EmbedDataVizArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

const DEFAULT_WIDTH = 580;
const DEFAULT_HEIGHT = 320;

/**
 * One canonical share URL per data-viz/education service, mirroring the
 * positive samples proven by test/unit/tools/link/registry.test.ts.
 */
const DATA_VIZ_SOURCES: Record<string, string> = {
  datawrapper: 'https://datawrapper.dwcdn.net/OhYbA/4/',
  flourish: 'https://public.flourish.studio/visualisation/1234567/',
  ourworldindata: 'https://ourworldindata.org/grapher/life-expectancy?tab=chart&country=~USA',
  geogebra: 'https://www.geogebra.org/m/cAsHWvWS',
  scratch: 'https://scratch.mit.edu/projects/1090231983/',
  kahoot: 'https://create.kahoot.it/details/965a7a4f-1c81-4d63-a2db-1a4d8f1e0f12',
  genially: 'https://view.genially.com/64fb1c8a2d3e4f0011aabbcc/interactive-image',
  infogram: 'https://infogram.com/monthly-report-1h7g6k0e9q5o2oy',
  arcgisstorymaps: 'https://storymaps.arcgis.com/stories/0123456789abcdef0123456789abcdef',
  felt: 'https://felt.com/map/My-Cool-Map-9BCQglnQTleNJxRhmJWUDCA',
  p5js: 'https://editor.p5js.org/p5/sketches/Hk7tg4q7l',
  wakelet: 'https://wakelet.com/wake/4t7Vy9hDFLbacQHRSrSmVA',
  pollev: 'https://pollev.com/teachername123',
  wolframcloud: 'https://www.wolframcloud.com/obj/demonstrations/CellularAutomaton-source.nb',
  sketchfab: 'https://sketchfab.com/3d-models/vintage-camera-cf2da81e2cd44e87b9e69eb9d6e6cab6',
  openstreetmap: 'https://www.openstreetmap.org/#map=13/51.5000/-0.1100',
};

/**
 * Resolves a service's sample URL through the live registry and builds the
 * exact block data Embed.onPaste would produce for that paste.
 */
const buildEmbedData = (service: string): EmbedData => {
  const source = DATA_VIZ_SOURCES[service];
  const match = matchEmbedService(source);

  if (match === null) {
    throw new Error(`Sample URL for "${service}" did not match any embed service: ${source}`);
  }

  if (match.service !== service) {
    throw new Error(`Sample URL for "${service}" matched "${match.service}" instead: ${source}`);
  }

  const config = EMBED_SERVICES[match.service];

  return {
    service: match.service,
    source,
    embed: match.embedUrl,
    kind: match.kind,
    width: config.width ?? DEFAULT_WIDTH,
    height: config.height ?? DEFAULT_HEIGHT,
  };
};

/**
 * Wraps a single embed block for a service into editor OutputData.
 */
const createEmbedData = (service: string): OutputData => ({
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: `embed-${service}`,
      type: 'embed',
      data: buildEmbedData(service),
    },
  ],
});

/**
 * Creates an editor container with the Embed tool registered.
 */
const createEditor = (args: EmbedDataVizArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: {
    embed: { class: Embed },
  },
});

const meta: Meta<EmbedDataVizArgs> = {
  title: 'Tools/Embed/Data & Education',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: createEmbedData('datawrapper'),
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<EmbedDataVizArgs>;

/**
 * Builds a story rendering one live embed block for the given service.
 * Stories load real provider iframes — intended for manual browsing.
 */
const createServiceStory = (service: string): Story => ({
  args: {
    minHeight: (EMBED_SERVICES[service].height ?? DEFAULT_HEIGHT) + 160,
    data: createEmbedData(service),
  },
});

/**
 * Datawrapper chart via the dwcdn host — the version path segment is dropped
 * (the bare id serves the latest published version).
 */
export const Datawrapper: Story = createServiceStory('datawrapper');

/**
 * Flourish visualisation via the flo.uri.sh embed host.
 */
export const Flourish: Story = createServiceStory('flourish');

/**
 * Our World in Data grapher page framed as-is — query params encode chart
 * state (countries, time range, tab) and are preserved.
 */
export const OurWorldInData: Story = createServiceStory('ourworldindata');

/**
 * GeoGebra material page framed as-is (the dedicated iframe endpoint is dead,
 * so site chrome shows inside the frame).
 */
export const GeoGebra: Story = createServiceStory('geogebra');

/**
 * Scratch project via the /embed player at its fixed 485x402 stage size.
 */
export const Scratch: Story = createServiceStory('scratch');

/**
 * Kahoot quiz rewritten onto embed.kahoot.it — share pages deny framing.
 */
export const Kahoot: Story = createServiceStory('kahoot');

/**
 * Genially via the bare view URL (24-hex id, slug tail dropped).
 */
export const Genially: Story = createServiceStory('genially');

/**
 * Infogram project via e.infogram.com keeping the FULL slug — the trailing id
 * token alone 404s.
 */
export const Infogram: Story = createServiceStory('infogram');

/**
 * ArcGIS StoryMaps story as a passthrough — the CSP frame-ancestors directive
 * overrides X-Frame-Options: SAMEORIGIN in browsers.
 */
export const ArcGISStoryMaps: Story = createServiceStory('arcgisstorymaps');

/**
 * Felt map rewritten onto the /embed/map/ path — share pages deny framing.
 */
export const Felt: Story = createServiceStory('felt');

/**
 * p5.js sketch via the chrome-less /full/ running view.
 */
export const P5js: Story = createServiceStory('p5js');

/**
 * Wakelet collection via the embed.wakelet.com list view.
 */
export const Wakelet: Story = createServiceStory('wakelet');

/**
 * Poll Everywhere — embeds the presenter's currently active poll via
 * pollev-embeds.com.
 */
export const PollEverywhere: Story = createServiceStory('pollev');

/**
 * Wolfram Cloud published object framed as-is (non-public objects show a
 * login page inside the frame).
 */
export const WolframCloud: Story = createServiceStory('wolframcloud');

/**
 * Sketchfab model via the /embed rewrite (share pages deny framing); the id
 * is the 32-char hex tail of the slug.
 */
export const Sketchfab: Story = createServiceStory('sketchfab');

/**
 * OpenStreetMap — the export bbox is computed from the #map=zoom/lat/lon
 * fragment via Mercator math in the registry's id().
 */
export const OpenStreetMap: Story = createServiceStory('openstreetmap');
