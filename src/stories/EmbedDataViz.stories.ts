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
  datawrapper: 'https://datawrapper.dwcdn.net/t4fiQ/3/',
  flourish: 'https://public.flourish.studio/visualisation/63832/',
  ourworldindata: 'https://ourworldindata.org/grapher/life-expectancy?tab=chart&country=~USA',
  geogebra: 'https://www.geogebra.org/m/UjjwuM8p',
  scratch: 'https://scratch.mit.edu/projects/1090231983/',
  kahoot: 'https://create.kahoot.it/details/science-trivia/adda1047-572f-40d1-8217-ae06019dafac',
  genially: 'https://view.genially.com/65da9accbbb01e0014a797ae/interactive-content-basic-interactive-presentation',
  infogram: 'https://infogram.com/state-of-gaming-2018-1h0r6rgog7zw2ek',
  arcgisstorymaps: 'https://storymaps.arcgis.com/stories/cea22a609a1d4cccb8d54c650b595bc4',
  felt: 'https://felt.com/map/Current-Fires-National-Interagency-Fire-Center-Qh5RZ9AwpRXeQS9BDJiPa7nD',
  p5js: 'https://editor.p5js.org/allison.parrish/sketches/_OVObj6oE',
  wakelet: 'https://wakelet.com/wake/LgK6vvQ9SLuUnY_L2Ft-u',
  pollev: 'https://pollev.com/polleverywhere',
  wolframcloud: 'https://www.wolframcloud.com/obj/blog-posts/Published/TheNewWorldOfNotebookPublishing.nb',
  sketchfab: 'https://sketchfab.com/3d-models/astronaut-glb-4d1f078f5461493ba066cf35278ae9e6',
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
