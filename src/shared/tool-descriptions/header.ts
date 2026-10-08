import type { BlockToolDescription } from '../../../types/tools/tool-description';
import { COLOR_PRESET_NAMES, RICH_TEXT_GUIDANCE } from './paragraph';
import { richText } from './rich-text';

export const HEADER_DATA = {
  type: 'object',
  description: 'A heading. Toggle headings own the blocks that reference them as `parent`.',
  required: ['text', 'level'],
  additionalProperties: false,
  properties: {
    text: richText('Rich text of the heading.'),
    level: { type: 'integer', minimum: 1, maximum: 6 },
    isToggleable: { type: 'boolean', description: 'Heading collapses/expands its children.' },
    isOpen: { type: 'boolean', deprecated: true, description: 'Ignored. Open state is personal and never saved.' },
    textColor: { type: 'string' },
    backgroundColor: { type: 'string' },
    anchor: { type: 'string', description: 'Anchor id rendered as the heading element\'s `id`.' },
  },
};

export const describeHeader = (config: Record<string, unknown> = {}): BlockToolDescription => {
  const candidates: unknown[] = Array.isArray(config.levels) ? config.levels : [];
  const levels = candidates.filter((level): level is number =>
    typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 6);
  const allowed = levels.length > 0 ? levels : [1, 2, 3, 4, 5, 6];
  const preferred = typeof config.defaultLevel === 'number' && allowed.includes(config.defaultLevel)
    ? config.defaultLevel
    : undefined;
  const level = preferred ?? allowed[1] ?? allowed[0] ?? 2;

  return {
    summary: 'A heading. With isToggleable it collapses and owns the blocks nested under it.',
    guidance: `${RICH_TEXT_GUIDANCE} Turn a heading into a toggle heading, or back, with block.convert, never by writing isToggleable: turning it off must release its children. textColor and backgroundColor take a preset name: ${COLOR_PRESET_NAMES}.`,
    data: levels.length === 0
      ? HEADER_DATA
      : { ...HEADER_DATA, properties: { ...HEADER_DATA.properties, level: { type: 'integer', enum: levels } } },
    defaultData: { text: [], level },
    examples: [{ text: [{ text: 'Roadmap' }], level }],
    summaryFields: ['level', 'isToggleable'],
    viewState: ['isOpen'],
    guardedFields: { isToggleable: 'block.convert' },
  };
};
