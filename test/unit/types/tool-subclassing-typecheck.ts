/**
 * Type-level tests for subclassing the published built-in tool classes.
 * Run with: tsc --noEmit --strict test/unit/types/tool-subclassing-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 *
 * Every built-in tool is published as a `declare class`, so consumers can
 * `class Sub extends Tool {}` (a single construct signature — no TS2510),
 * override its typed methods, register the class (or a subclass) in a tools
 * map, and use the class name as an instance-type annotation.
 */

import {
  Paragraph,
  Header,
  List,
  Table,
  Toggle,
  Divider,
  Spacer,
  Callout,
  Quote,
  ColumnList,
  Column,
  Database,
  DatabaseRow,
  Image,
  File,
  Audio,
  Video,
  Code,
  Embed,
  Bookmark,
} from '../../../types/tools-entry';
import type {
  ParagraphConstructorOptions,
  ParagraphData,
  ParagraphConfig,
  HeaderConstructorOptions,
  HeaderData,
  ListConstructorOptions,
  ListData,
  TableConstructorOptions,
  TableData,
  ToggleConstructorOptions,
  ToggleData,
  DividerConstructorOptions,
  SpacerConstructorOptions,
  SpacerData,
  CalloutConstructorOptions,
  CalloutData,
  QuoteConstructorOptions,
  QuoteData,
  ColumnListConstructorOptions,
  ColumnListData,
  ColumnConstructorOptions,
  ColumnData,
  DatabaseConstructorOptions,
  DatabaseData,
  DatabaseRowConstructorOptions,
  DatabaseRowData,
  ImageConstructorOptions,
  ImageData,
  FileConstructorOptions,
  FileData,
  AudioConstructorOptions,
  AudioData,
  VideoConstructorOptions,
  VideoData,
  CodeConstructorOptions,
  CodeData,
  EmbedConstructorOptions,
  EmbedData,
  BookmarkConstructorOptions,
  BookmarkData,
} from '../../../types/tools-entry';
import type { BlockToolConstructable, ToolSettings } from '../../../types';

// Each published tool class must be subclassable with one typed method override.
class SubParagraph extends Paragraph {
  public save(toolsContent: HTMLDivElement): ParagraphData {
    return super.save(toolsContent);
  }
}

class SubHeader extends Header {
  public validate(blockData: HeaderData): boolean {
    return super.validate(blockData);
  }
}

class SubList extends List {
  public save(): ListData {
    return super.save();
  }
}

class SubTable extends Table {
  public save(): TableData {
    return super.save();
  }
}

class SubToggle extends Toggle {
  public merge(data: ToggleData): void {
    super.merge(data);
  }
}

class SubDivider extends Divider {
  public render(): HTMLElement {
    return super.render();
  }
}

class SubSpacer extends Spacer {
  public save(): SpacerData {
    return super.save();
  }
}

class SubCallout extends Callout {
  public save(): CalloutData {
    return super.save();
  }
}

class SubQuote extends Quote {
  public merge(data: QuoteData): void {
    super.merge(data);
  }
}

class SubColumnList extends ColumnList {
  public save(): ColumnListData {
    return super.save();
  }
}

class SubColumn extends Column {
  public save(): ColumnData {
    return super.save();
  }
}

class SubDatabase extends Database {
  public save(blockContent: HTMLElement): DatabaseData {
    return super.save(blockContent);
  }
}

class SubDatabaseRow extends DatabaseRow {
  public save(block: HTMLElement): DatabaseRowData {
    return super.save(block);
  }
}

class SubImage extends Image {
  public save(block?: HTMLElement): ImageData {
    return super.save(block);
  }
}

class SubFile extends File {
  public save(): FileData {
    return super.save();
  }
}

class SubAudio extends Audio {
  public validate(data: AudioData): boolean {
    return super.validate(data);
  }
}

class SubVideo extends Video {
  public save(block?: HTMLElement): VideoData {
    return super.save(block);
  }
}

class SubCode extends Code {
  public merge(data: CodeData): void {
    super.merge(data);
  }
}

class SubEmbed extends Embed {
  public save(): EmbedData {
    return super.save();
  }
}

class SubBookmark extends Bookmark {
  public validate(data: BookmarkData): boolean {
    return super.validate(data);
  }
}

// Every subclass must remain assignable to BlockToolConstructable.
const _subclasses: BlockToolConstructable[] = [
  SubParagraph,
  SubHeader,
  SubList,
  SubTable,
  SubToggle,
  SubDivider,
  SubSpacer,
  SubCallout,
  SubQuote,
  SubColumnList,
  SubColumn,
  SubDatabase,
  SubDatabaseRow,
  SubImage,
  SubFile,
  SubAudio,
  SubVideo,
  SubCode,
  SubEmbed,
  SubBookmark,
];

void _subclasses;

// The classes themselves must be usable as ToolSettings.class / tools map values.
const _settings: ToolSettings = { class: Paragraph };
const _tools: Record<string, BlockToolConstructable> = {
  paragraph: Paragraph,
  header: Header,
  list: List,
  table: Table,
  toggle: Toggle,
  divider: Divider,
  spacer: Spacer,
  callout: Callout,
  quote: Quote,
  column_list: ColumnList,
  column: Column,
  database: Database,
  'database-row': DatabaseRow,
  image: Image,
  file: File,
  audio: Audio,
  video: Video,
  code: Code,
  embed: Embed,
  bookmark: Bookmark,
};

void _settings;
void _tools;

// The class names must double as instance-type annotations (declare class
// provides both the value and the type under the same name).
const _useInstances = (
  p: Paragraph,
  h: Header,
  l: List,
  t: Table,
  tg: Toggle,
  d: Divider,
  s: Spacer,
  c: Callout,
  q: Quote,
  cl: ColumnList,
  co: Column,
  db: Database,
  dbr: DatabaseRow,
  im: Image,
  fi: File,
  au: Audio,
  vi: Video,
  cd: Code,
  em: Embed,
  bm: Bookmark,
): void => {
  void p; void h; void l; void t; void tg; void d;
  void s; void c; void q; void cl; void co;
  void db; void dbr; void im; void fi; void au;
  void vi; void cd; void em; void bm;
};

void _useInstances;

// Every XConstructorOptions alias must be exported and match the constructor.
const _optionUsers = (
  p: ParagraphConstructorOptions,
  h: HeaderConstructorOptions,
  l: ListConstructorOptions,
  t: TableConstructorOptions,
  tg: ToggleConstructorOptions,
  d: DividerConstructorOptions,
  s: SpacerConstructorOptions,
  c: CalloutConstructorOptions,
  q: QuoteConstructorOptions,
  cl: ColumnListConstructorOptions,
  co: ColumnConstructorOptions,
  db: DatabaseConstructorOptions,
  dbr: DatabaseRowConstructorOptions,
  im: ImageConstructorOptions,
  fi: FileConstructorOptions,
  au: AudioConstructorOptions,
  vi: VideoConstructorOptions,
  cd: CodeConstructorOptions,
  em: EmbedConstructorOptions,
  bm: BookmarkConstructorOptions,
): unknown[] => [
  new Paragraph(p),
  new Header(h),
  new List(l),
  new Table(t),
  new Toggle(tg),
  new Divider(d),
  new Spacer(s),
  new Callout(c),
  new Quote(q),
  new ColumnList(cl),
  new Column(co),
  new Database(db),
  new DatabaseRow(dbr),
  new Image(im),
  new File(fi),
  new Audio(au),
  new Video(vi),
  new Code(cd),
  new Embed(em),
  new Bookmark(bm),
];

void _optionUsers;

// Zero-cast replica of the consumer pattern: a subclass with a widened config
// that forwards to super. Must compile without TS2510 and stay registrable.
class CustomParagraph extends Paragraph {
  constructor(
    options: Omit<ParagraphConstructorOptions, 'config'> & {
      config?: ParagraphConfig & { onEnter?: unknown };
    },
  ) {
    super(options);
  }
}

const _customParagraph: BlockToolConstructable = CustomParagraph;
const _customSettings: ToolSettings = { class: CustomParagraph };

void _customParagraph;
void _customSettings;
