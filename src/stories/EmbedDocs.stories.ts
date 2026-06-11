import type { Meta, StoryObj } from '@storybook/html-vite';

import { Embed, type EmbedData } from '../tools/link/embed';
import { EMBED_SERVICES, matchEmbedService } from '../tools/link/registry';

import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData } from '@/types';

interface EmbedDocsArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

const DEFAULT_WIDTH = 580;
const DEFAULT_HEIGHT = 320;

/**
 * One canonical source URL per docs/productivity embed service.
 * Each URL is a positive sample proven to match its registry entry
 * in test/unit/tools/link/registry.test.ts.
 */
const SAMPLE_SOURCES: Record<string, string> = {
  figma: 'https://www.figma.com/design/KEY123/My-File',
  googledrive: 'https://drive.google.com/file/d/FILEID/view?usp=sharing',
  googledrivefolder: 'https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv?usp=sharing',
  googledocspublished: 'https://docs.google.com/document/d/e/2PACX-1vQpBF5Z9a02DALDxXD652Vic622H/pub',
  googledocs: 'https://docs.google.com/document/d/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv/edit?usp=sharing',
  googlesheets: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0',
  googleslides: 'https://docs.google.com/presentation/d/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv/edit?usp=sharing',
  googleforms: 'https://docs.google.com/forms/d/e/1FAIpQLSdummyFormId123/viewform?usp=sf_link',
  drawio: 'https://app.diagrams.net/?lightbox=1&highlight=0000ff&edit=_blank&layers=1&nav=1#Uhttps%3A%2F%2Fraw.githubusercontent.com%2Fjgraph%2Fdrawio%2Fmaster%2FTEMPLATE.drawio',
};

/**
 * Resolves a sample source URL through the registry and builds the exact
 * block data Embed.onPaste would produce. Throws at module init when the
 * URL fails to match or is claimed by a different service, so a broken
 * sample never renders a misleading story.
 */
const buildEmbedData = (service: string): EmbedData => {
  const source = SAMPLE_SOURCES[service];
  const match = matchEmbedService(source);

  if (match === null) {
    throw new Error(`Sample URL for "${service}" did not match any embed service: ${source}`);
  }

  if (match.service !== service) {
    throw new Error(`Sample URL for "${service}" was claimed by "${match.service}": ${source}`);
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
 * Wraps a single embed block's data into editor OutputData.
 */
const createEmbedOutputData = (service: string): OutputData => ({
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: `embed-docs-${service}`,
      type: 'embed',
      data: buildEmbedData(service),
    },
  ],
});

/**
 * Creates an editor container with the Embed tool registered.
 */
const createEditor = (args: EmbedDocsArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: {
    embed: { class: Embed },
  },
});

const meta: Meta<EmbedDocsArgs> = {
  title: 'Tools/Embed/Docs',
  tags: ['autodocs'],
  args: {
    minHeight: 600,
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<EmbedDocsArgs>;

/**
 * Builds a story rendering one live embed block for the given service.
 */
const createServiceStory = (service: string): Story => ({
  args: {
    data: createEmbedOutputData(service),
  },
});

/** Figma design file embedded via embed.figma.com. */
export const Figma: Story = createServiceStory('figma');

/** Google Drive file preview. */
export const GoogleDrive: Story = createServiceStory('googledrive');

/** Google Drive folder embedded as a list view. */
export const GoogleDriveFolder: Story = createServiceStory('googledrivefolder');

/** Google Docs "publish to the web" document. */
export const GoogleDocsPublished: Story = createServiceStory('googledocspublished');

/** Google Docs document preview. */
export const GoogleDocs: Story = createServiceStory('googledocs');

/** Google Sheets spreadsheet preview. */
export const GoogleSheets: Story = createServiceStory('googlesheets');

/** Google Slides presentation in embedded player mode. */
export const GoogleSlides: Story = createServiceStory('googleslides');

/** Google Forms embedded viewform. */
export const GoogleForms: Story = createServiceStory('googleforms');

/** draw.io / diagrams.net diagram on the frameable viewer host. */
export const DrawIo: Story = createServiceStory('drawio');
