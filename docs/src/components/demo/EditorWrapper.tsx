import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../contexts/I18nContext";
import { useTheme } from "../../hooks/useTheme";
import { Typo } from "../common/Typo";
import { assertEditorModulesComplete } from "./assertEditorModules";
import {
  buildEditorSettingsProps,
  DEFAULT_EDITOR_SETTINGS,
  type EditorSettings,
} from "./editor-settings";

interface BlokEditorInstance {
  save: () => Promise<unknown>;
  clear: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

// BlokEditor + tools are served from the parent /dist build by Vite at runtime.
type BlokReactModule = {
  BlokEditor: React.ForwardRefExoticComponent<
    Record<string, unknown> & React.RefAttributes<BlokEditorInstance | null>
  >;
};
type BlokToolsModule = Record<string, unknown>;

/**
 * Fake uploader for the media tools: the docs site has no upload backend, so
 * files are kept in-memory as object URLs — enough to try every media block.
 */
const objectUrlUploader = {
  uploader: {
    uploadByFile: async (file: File) => ({
      url: URL.createObjectURL(file),
      fileName: file.name,
      size: file.size,
      mimeType: file.type,
    }),
  },
};

export const EditorWrapper: React.FC<{
  onEditorReady?: (editor: BlokEditorInstance) => void;
  /** Playground settings from the /demo settings panel. */
  settings?: EditorSettings;
}> = ({ onEditorReady, settings = DEFAULT_EDITOR_SETTINGS }) => {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const [mods, setMods] = useState<{ react: BlokReactModule; tools: BlokToolsModule } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;

  const hostRef = useRef<HTMLDivElement>(null);

  // Alignment is creation-time config, but recreating the editor to change it
  // flashes the content — re-stamp the live wrapper's attribute instead. The
  // initial render is covered by the style prop at creation.
  useEffect(() => {
    hostRef.current
      ?.querySelector('[data-blok-content-align]')
      ?.setAttribute('data-blok-content-align', settings.contentAlign);
  }, [settings.contentAlign]);

  // Fires when BlokEditor attaches/detaches its instance to the forwarded ref.
  // Using a callback ref (not onReady) guarantees the instance is committed
  // before we hand it to the consumer — onReady fires before the ref commits.
  const handleEditorRef = useCallback((instance: BlokEditorInstance | null) => {
    if (instance) {
      onEditorReadyRef.current?.(instance);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [react, tools] = await Promise.all([
          // @ts-expect-error - /dist/react.mjs is served by Vite, not resolvable at compile time
          import("/dist/react.mjs") as Promise<BlokReactModule>,
          // @ts-expect-error - /dist/tools.mjs is served by Vite, not resolvable at compile time
          import("/dist/tools.mjs") as Promise<BlokToolsModule>,
        ]);
        assertEditorModulesComplete(react, tools);
        if (active) setMods({ react, tools });
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : t("common.unknownError"));
        }
      }
    })();
    return () => { active = false; };
  }, [t]);

  if (error) {
    return (
      <div className="blok-editor">
        <div className="px-8 py-12 text-center text-muted-foreground">
          <p className="mb-2 font-semibold text-foreground">
            <Typo>{t("demo.editorWrapper.failedToLoad")}</Typo>
          </p>
          <p className="text-sm">
            <Typo>{t("demo.editorWrapper.buildHint")}</Typo>{" "}
            <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">npm run build</code>
          </p>
          <p className="mt-4 text-xs text-muted-foreground/80">{t("demo.editorWrapper.errorPrefix")} {error}</p>
        </div>
      </div>
    );
  }

  if (mods === null) {
    return (
      <div className="blok-editor min-h-[24rem]">
        <div className="editor-placeholder flex min-h-[24rem] items-center justify-center p-8">
          <div className="flex flex-col items-center gap-4 text-center text-muted-foreground">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <rect
                width="64"
                height="64"
                rx="16"
                fill="url(#placeholder-gradient)"
                opacity="0.12"
              />
              <rect
                x="14"
                y="18"
                width="36"
                height="28"
                rx="6"
                stroke="url(#placeholder-gradient)"
                strokeWidth="2"
              />
              <rect x="18" y="24" width="16" height="2" rx="1" fill="#F07B4B" />
              <rect x="18" y="30" width="12" height="2" rx="1" fill="#D4A4B8" />
              <rect x="18" y="36" width="20" height="2" rx="1" fill="#F89042" opacity="0.6" />
              <defs>
                <linearGradient
                  id="placeholder-gradient"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#F07B4B" />
                  <stop offset="100%" stopColor="#D4A4B8" />
                </linearGradient>
              </defs>
            </svg>
            <p className="text-sm font-medium"><Typo>{t("demo.editorWrapper.loading")}</Typo></p>
          </div>
        </div>
      </div>
    );
  }

  const { BlokEditor } = mods.react;
  const {
    Paragraph, Header, List, Table, Toggle, Callout,
    Database, DatabaseRow, Divider, Quote, Code,
    Image, File: FileTool, Audio, Video, ColumnList, Column,
    Embed, Bookmark,
    Bold, Italic, Underline, Strikethrough,
    InlineCode, Equation, Link, Marker,
  } = mods.tools;

  const { props: settingsProps, deps: settingsDeps } = buildEditorSettingsProps(settings, resolvedTheme);

  return (
    // The host div carries the toolbar-hiding class (the core's hideToolbar
    // config is dead, and recreating the editor to toggle chrome would flash
    // the content) and anchors the runtime alignment re-stamping above.
    <div ref={hostRef} className={settings.hideToolbar ? 'demo-toolbar-hidden' : undefined}>
    <BlokEditor
      ref={handleEditorRef}
      className="blok-editor"
      {...settingsProps}
      deps={settingsDeps}
      tools={{
        // Block tools — the editor's full feature surface, mirroring the dev
        // playground (index.html) configuration.
        paragraph: { class: Paragraph, inlineToolbar: true, config: { preserveBlank: true, placeholder: t("demo.paragraphPlaceholder") } },
        header: { class: Header, inlineToolbar: true, config: { placeholder: t("demo.headerPlaceholder"), levels: [1, 2, 3, 4], defaultLevel: 2 } },
        list: { class: List, inlineToolbar: true, config: { defaultStyle: "unordered" } },
        table: Table,
        toggle: { class: Toggle, inlineToolbar: true },
        callout: { class: Callout, inlineToolbar: true },
        database: Database,
        "database-row": DatabaseRow,
        divider: Divider,
        quote: { class: Quote, inlineToolbar: true },
        code: { class: Code, inlineToolbar: false },
        image: Image,
        file: { class: FileTool, config: objectUrlUploader },
        video: { class: Video, config: objectUrlUploader },
        audio: { class: Audio, config: objectUrlUploader },
        column_list: ColumnList,
        column: Column,
        // Link-paste tools. Embed works standalone; Bookmark is contract-only
        // and needs a metadata backend at `endpoint`.
        embed: Embed,
        bookmark: { class: Bookmark, config: { endpoint: "/unfurl" } },
        // Inline tools
        bold: Bold,
        italic: Italic,
        underline: Underline,
        strikethrough: Strikethrough,
        inlineCode: InlineCode,
        equation: Equation,
        link: Link,
        marker: Marker,
      }}
      data={{
        blocks: [
          { id: "welcome-block", type: "header", data: { text: t("demo.welcomeTitle"), level: 2 } },
          { id: "intro-block", type: "paragraph", data: { text: t("demo.welcomeParagraph") } },
          { id: "features-list", type: "list", data: { style: "unordered", items: [t("demo.welcomeListItem1"), t("demo.welcomeListItem2"), t("demo.welcomeListItem3"), t("demo.welcomeListItem4")] } },
        ],
      }}
    />
    </div>
  );
};
