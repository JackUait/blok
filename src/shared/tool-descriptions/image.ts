import type { BlockToolDescription, ToolActionDeclaration } from '../../../types/tools/tool-description';
import { ALIGNMENT } from './rich-text';
import { urlSourceAction } from './url-action';

export const IMAGE_DATA = {
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: {
    url: { type: 'string', description: 'http(s) or blob: source.' },
    variants: {
      type: 'array',
      description: 'Every rendition, best format first. Ignored unless it contains `url`, the most compatible one.',
      items: {
        type: 'object',
        required: ['url', 'mimeType'],
        additionalProperties: false,
        properties: { url: { type: 'string' }, mimeType: { type: 'string' } },
      },
    },
    caption: { type: 'string', description: 'Plain text.' },
    captionVisible: { type: 'boolean' },
    alt: { type: 'string' },
    fileName: { type: 'string' },
    width: { type: 'number', minimum: 10, maximum: 100, description: 'Percent of the container.' },
    alignment: { type: 'string', enum: ALIGNMENT },
    size: { type: 'string', enum: ['sm', 'md', 'lg', 'full'], description: 'Preset; overrides `width` when present.' },
    frame: { type: 'string', enum: ['none', 'border', 'shadow'] },
    rounded: { type: 'boolean' },
    // Fractional for an SVG whose viewBox is (see dimensions-from-svg.ts).
    naturalWidth: { type: 'number', description: 'Intrinsic pixel width, cached after first load.' },
    naturalHeight: { type: 'number' },
    crop: {
      type: 'object',
      description: 'Non-destructive crop, in percent of the intrinsic image. Omitted for an uncropped rectangle. With `rotation`, `flipX` or `straighten` set, it is in percent of the turned image\'s box.',
      required: ['x', 'y', 'w', 'h'],
      additionalProperties: false,
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        w: { type: 'number' },
        h: { type: 'number' },
        shape: { type: 'string', enum: ['rect', 'circle', 'ellipse'] },
      },
    },
    rotation: { type: 'number', enum: [0, 90, 180, 270], description: 'Clockwise quarter turn, applied after the mirror. Omitted for 0.' },
    flipX: { type: 'boolean', description: 'Mirror left to right, before the turn. Omitted for false.' },
    straighten: { type: 'number', minimum: -45, maximum: 45, description: 'Clockwise degrees, after the turn. Omitted for 0.' },
    filter: {
      type: 'string',
      minLength: 1,
      description: 'Colour look: a built-in preset (vivid, noir, sepia, …) or a host filter name from the image tool\'s `filters` config. Omitted for "none".',
    },
    filterStrength: { type: 'number', minimum: 0, maximum: 100, description: 'How strongly `filter` applies. Omitted for 100 and when there is no filter.' },
    adjust: {
      type: 'object',
      description: 'Colour adjustments, each -100..100. Zero entries are omitted, and so is an empty object.',
      additionalProperties: false,
      properties: {
        brightness: { type: 'number', minimum: -100, maximum: 100 },
        contrast: { type: 'number', minimum: -100, maximum: 100 },
        saturation: { type: 'number', minimum: -100, maximum: 100 },
      },
    },
    markup: {
      type: 'array',
      description: 'Drawings, shapes and text over the image, back to front. Omitted when empty. Coordinates are fractions (0..1) of the turned image\'s box, before crop and straighten. Sizes are fractions of that box\'s shorter side.',
      maxItems: 500,
      items: {
        anyOf: [
          {
            type: 'object',
            description: 'A freehand stroke.',
            required: ['id', 'type', 'color', 'points', 'size'],
            additionalProperties: false,
            properties: {
              id: { type: 'string', description: 'Unique within the image.' },
              type: { type: 'string', enum: ['pen', 'highlighter'] },
              color: { type: 'string', pattern: '^#[0-9a-f]{6}$' },
              points: { type: 'array', items: { type: 'number' }, description: 'Flat x, y, pressure triples. Pressure is 0..1.' },
              size: { type: 'number', exclusiveMinimum: 0, maximum: 0.5, description: 'Stroke width.' },
              cut: { type: 'string', enum: ['start', 'end', 'both'], description: 'Ends the eraser cut. Omitted when none.' },
            },
          },
          {
            type: 'object',
            description: 'A shape between two corners. Rect and ellipse fill the box they span; line and arrow join the points.',
            required: ['id', 'type', 'color', 'x1', 'y1', 'x2', 'y2', 'size'],
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['rect', 'rounded-rect', 'ellipse', 'line', 'arrow', 'bubble', 'star', 'polygon', 'spotlight', 'magnifier'] },
              color: { type: 'string', pattern: '^#[0-9a-f]{6}$' },
              x1: { type: 'number' },
              y1: { type: 'number' },
              x2: { type: 'number' },
              y2: { type: 'number' },
              size: { type: 'number', exclusiveMinimum: 0, maximum: 0.5, description: 'Stroke width.' },
              fill: { type: 'boolean', description: 'Rect and ellipse only: a translucent fill. Omitted for false.' },
              rotation: { type: 'number', description: 'Star and polygon only: clockwise degrees. Omitted for 0.' },
              tx: { type: 'number', description: 'Bubble only: where the tail points.' },
              ty: { type: 'number' },
            },
          },
          {
            type: 'object',
            description: 'A text label.',
            required: ['id', 'type', 'color', 'x', 'y', 'text', 'size'],
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['text'] },
              color: { type: 'string', pattern: '^#[0-9a-f]{6}$' },
              x: { type: 'number', description: 'Centre of the text block.' },
              y: { type: 'number' },
              text: { type: 'string', maxLength: 2000, description: 'Plain text; a newline breaks the line.' },
              size: { type: 'number', exclusiveMinimum: 0, maximum: 0.5, description: 'Font size.' },
              style: { type: 'string', enum: ['plain', 'outline', 'background'], description: 'Omitted for "plain".' },
              rotation: { type: 'number', description: 'Clockwise degrees about the centre. Omitted for 0.' },
            },
          },
        ],
      },
    },
  },
};

const filterNames = (filters: unknown[]): string[] => filters
  .map((entry): unknown => {
    if (typeof entry === 'string') {
      return entry;
    }

    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry) && 'name' in entry) {
      return entry.name;
    }

    return undefined;
  })
  .filter((name): name is string => typeof name === 'string' && name !== '' && name !== 'none');

// The saved item shapes without `id`: the action mints ids. Derived, so the two stay one source.
const NEW_MARKUP_ITEMS = IMAGE_DATA.properties.markup.items.anyOf.map(branch => ({
  ...branch,
  required: branch.required.filter(key => key !== 'id'),
  properties: Object.fromEntries(Object.entries(branch.properties).filter(([key]) => key !== 'id')),
}));

const PERCENT = { type: 'number', minimum: 0, maximum: 100 };

export const IMAGE_ACTIONS: ToolActionDeclaration[] = [
  urlSourceAction('setSource', 'Set or replace the image from a URL.'),
  {
    name: 'crop',
    summary: 'Crop the image to a rectangle given in percent of the turned image. The full rectangle removes the crop.',
    target: 'block',
    args: {
      type: 'object',
      required: ['rect'],
      additionalProperties: false,
      properties: {
        rect: {
          type: 'object',
          required: ['x', 'y', 'w', 'h'],
          additionalProperties: false,
          properties: { x: PERCENT, y: PERCENT, w: PERCENT, h: PERCENT },
        },
        shape: { enum: ['rect', 'circle', 'ellipse'] },
      },
    },
    mirrors: [],
  },
  {
    name: 'rotate',
    summary: 'Turn the image clockwise by quarter turns. The crop and drawings turn with it.',
    target: 'block',
    args: { type: 'object', required: ['turns'], additionalProperties: false, properties: { turns: { enum: [1, 2, 3] } } },
    mirrors: [],
  },
  {
    name: 'flip',
    summary: 'Mirror the image left to right. The crop and drawings mirror with it.',
    target: 'block',
    args: { type: 'object', additionalProperties: false, properties: {} },
    mirrors: [],
  },
  {
    name: 'straighten',
    summary: 'Tilt the image by a few degrees clockwise. The crop shrinks so no empty corner shows.',
    target: 'block',
    preconditions: ['naturalWidth and naturalHeight are known.'],
    args: {
      type: 'object',
      required: ['degrees'],
      additionalProperties: false,
      properties: { degrees: { type: 'number', minimum: -45, maximum: 45 } },
    },
    mirrors: [],
  },
  {
    name: 'addMarkup',
    summary: 'Draw shapes, strokes or text labels over the image. Returns their markup ids.',
    target: 'block',
    args: {
      type: 'object',
      required: ['items'],
      additionalProperties: false,
      properties: { items: { type: 'array', minItems: 1, maxItems: 500, items: { anyOf: NEW_MARKUP_ITEMS } } },
    },
    result: {
      type: 'object',
      required: ['markupIds'],
      properties: { markupIds: { type: 'array', items: { type: 'string' } } },
    },
    mirrors: [],
  },
  {
    name: 'updateMarkup',
    summary: 'Change fields of one markup item. Its id and type stay.',
    target: 'block',
    args: {
      type: 'object',
      required: ['markupId', 'patch'],
      additionalProperties: false,
      properties: {
        markupId: { type: 'string' },
        patch: { type: 'object', description: 'Fields to change, in the saved markup shape.' },
      },
    },
    mirrors: [],
  },
  {
    name: 'removeMarkup',
    summary: 'Remove markup items by id, or all of them.',
    target: 'block',
    // Flat, with oneOf over `required` only: core adds `id` to these properties for the block target.
    args: {
      type: 'object',
      additionalProperties: false,
      properties: {
        markupIds: { type: 'array', minItems: 1, items: { type: 'string' } },
        all: { const: true },
      },
      oneOf: [{ required: ['markupIds'] }, { required: ['all'] }],
    },
    mirrors: [],
  },
];

export const describeImage = (config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'An image with optional caption, crop, turn, colour look and drawings.',
  guidance: 'Insert it with url set; replace the picture with image.setSource, which also copies it to the host. Crop, rotate, flip and straighten with image.crop, image.rotate, image.flip and image.straighten: each also turns crop and markup. Add or change drawings with image.addMarkup, image.updateMarkup and image.removeMarkup. caption and alt are plain text.',
  data: Array.isArray(config.filters)
    ? { ...IMAGE_DATA, properties: { ...IMAGE_DATA.properties, filter: { type: 'string', enum: filterNames(config.filters) } } }
    : IMAGE_DATA,
  summaryFields: ['alignment', 'size', 'width'],
  findFields: ['caption'],
  guardedFields: { markup: 'image.*Markup' },
  actions: IMAGE_ACTIONS,
});
