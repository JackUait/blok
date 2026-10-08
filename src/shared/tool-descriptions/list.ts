import type { BlockToolDescription } from '../../../types/tools/tool-description';
import { RICH_TEXT_GUIDANCE } from './paragraph';
import { richText } from './rich-text';

export const LIST_DATA = {
  type: 'object',
  description: 'One list item. A list is a run of sibling `list` blocks, not a single block.',
  required: ['text', 'style'],
  additionalProperties: false,
  properties: {
    text: richText('Rich text of the item.'),
    style: { type: 'string', enum: ['unordered', 'ordered', 'checklist'] },
    checked: { type: 'boolean', description: 'Checklist state. Only emitted for style "checklist".' },
    start: { type: 'integer', description: 'Starting number of an ordered run. Omitted when 1.' },
    depth: { type: 'integer', minimum: 1, description: 'Nesting level. Omitted at root.' },
  },
};

const LIST_KINDS = ['unordered', 'ordered', 'checklist'];

export const describeList = (config: Record<string, unknown> = {}): BlockToolDescription => {
  const candidates: unknown[] = Array.isArray(config.styles) ? config.styles : [];
  const styles = candidates.filter((style): style is string =>
    typeof style === 'string' && LIST_KINDS.includes(style));
  const allowed = styles.length > 0 ? styles : LIST_KINDS;
  const preferred = typeof config.defaultStyle === 'string' && allowed.includes(config.defaultStyle)
    ? config.defaultStyle
    : undefined;
  const style = preferred ?? (allowed.includes('unordered') ? 'unordered' : allowed[0] ?? 'unordered');

  return {
    summary: 'One list item. A list is a run of sibling list blocks.',
    guidance: `${RICH_TEXT_GUIDANCE} Insert one list block per item. Nest an item by inserting it as a child of the item above. For rendered, structurally nested items, depth is derived from nesting on save. Set start only on the first item of an ordered run.`,
    data: styles.length === 0
      ? LIST_DATA
      : { ...LIST_DATA, properties: { ...LIST_DATA.properties, style: { type: 'string', enum: styles } } },
    defaultData: { text: [], style },
    examples: [{ text: [{ text: 'Buy milk' }], style, ...(style === 'checklist' ? { checked: false } : {}) }],
    summaryFields: ['style', 'checked', 'start'],
  };
};
