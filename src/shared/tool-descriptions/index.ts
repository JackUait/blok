import type { BlockToolDescription } from '../../../types/tools/tool-description';
import { describeParagraph } from './paragraph';

export { COLOR_PRESET_NAMES, RICH_TEXT_GUIDANCE } from './paragraph';

export const BUILT_IN_BLOCK_DESCRIPTIONS: Readonly<Record<string, (config?: Record<string, unknown>) => BlockToolDescription>> = {
  paragraph: describeParagraph,
};
