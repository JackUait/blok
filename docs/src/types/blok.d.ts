export interface BlokEditor {
  save: () => Promise<unknown>;
  render: (data: unknown) => Promise<void>;
  clear: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  focus: (atEnd?: boolean) => boolean;
  destroy: () => void;
  blocks: unknown;
  caret: unknown;
  saver: unknown;
  toolbar: unknown;
  inlineToolbar: unknown;
  events: unknown;
}

export interface BlokModule {
  Blok: new (config: unknown) => BlokEditor;
  Header: unknown;
  Paragraph: unknown;
  List: unknown;
  Bold: unknown;
  Italic: unknown;
  Link: unknown;
}

declare module '/dist/full.mjs' {
  const blok: BlokModule;
  export default blok;
}
