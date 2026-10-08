import type { BlockToolDescription } from '../../../types/tools/tool-description';
import { describeAudio } from './audio';
import { describeBookmark } from './bookmark';
import { describeCallout } from './callout';
import { describeCode } from './code';
import { describeColumnList } from './column-list';
import { describeColumn } from './column';
import { describeDatabase } from './database';
import { describeDatabaseRow } from './database-row';
import { describeDivider } from './divider';
import { describeEmbed } from './embed';
import { describeFile } from './file';
import { describeHeader } from './header';
import { describeImage } from './image';
import { describeList } from './list';
import { describePage } from './page';
import { describePageLink } from './page-link';
import { describeParagraph } from './paragraph';
import { describeQuote } from './quote';
import { describeSpacer } from './spacer';
import { describeTab } from './tab';
import { describeTable } from './table';
import { describeTableOfContents } from './table-of-contents';
import { describeTabs } from './tabs';
import { describeToggle } from './toggle';
import { describeVideo } from './video';

export { COLOR_PRESET_NAMES, RICH_TEXT_GUIDANCE } from './paragraph';

export const BUILT_IN_BLOCK_DESCRIPTIONS: Readonly<Record<string, (config?: Record<string, unknown>) => BlockToolDescription>> = {
  paragraph: describeParagraph,
  header: describeHeader,
  list: describeList,
  toggle: describeToggle,
  callout: describeCallout,
  quote: describeQuote,
  code: describeCode,
  divider: describeDivider,
  spacer: describeSpacer,
  table_of_contents: describeTableOfContents,
  column_list: describeColumnList,
  column: describeColumn,
  tabs: describeTabs,
  tab: describeTab,
  image: describeImage,
  video: describeVideo,
  audio: describeAudio,
  file: describeFile,
  embed: describeEmbed,
  bookmark: describeBookmark,
  page: describePage,
  'page-link': describePageLink,
  table: describeTable,
  database: describeDatabase,
  'database-row': describeDatabaseRow,
};
