import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../contexts/I18nContext";
import { useTheme } from "../../hooks/useTheme";

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
type BlokToolsModule = {
  Header: unknown; Paragraph: unknown; List: unknown;
};

export const EditorWrapper: React.FC<{
  onEditorReady?: (editor: BlokEditorInstance) => void;
}> = ({ onEditorReady }) => {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const [mods, setMods] = useState<{ react: BlokReactModule; tools: BlokToolsModule } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;

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
          // @ts-expect-error - /dist/full.mjs is served by Vite, not resolvable at compile time
          import("/dist/full.mjs") as Promise<BlokToolsModule>,
        ]);
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
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--demo-text-muted, #666)" }}>
          <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>{t("demo.editorWrapper.failedToLoad")}</p>
          <p style={{ fontSize: 14 }}>{t("demo.editorWrapper.buildHint")} <code>npm run build</code></p>
          <p style={{ fontSize: 12, marginTop: "1rem" }}>{t("demo.editorWrapper.errorPrefix")} {error}</p>
        </div>
      </div>
    );
  }

  if (mods === null) {
    return (
      <div className="blok-editor">
        <div className="editor-placeholder">
          <div className="placeholder-content"><p>{t("demo.editorWrapper.loading")}</p></div>
        </div>
      </div>
    );
  }

  const { BlokEditor } = mods.react;
  const { Header, Paragraph, List } = mods.tools;

  return (
    <BlokEditor
      ref={handleEditorRef}
      className="blok-editor"
      theme={resolvedTheme}
      tools={{
        header: { class: Header, config: { placeholder: t("demo.headerPlaceholder"), levels: [1, 2, 3, 4], defaultLevel: 2 }, inlineToolbar: ["bold", "italic", "link"] },
        paragraph: { class: Paragraph, inlineToolbar: ["bold", "italic", "link"], config: { preserveBlank: true, placeholder: t("demo.paragraphPlaceholder") } },
        list: { class: List, inlineToolbar: true, config: { defaultStyle: "unordered" } },
      }}
      data={{
        blocks: [
          { id: "welcome-block", type: "header", data: { text: t("demo.welcomeTitle"), level: 2 } },
          { id: "intro-block", type: "paragraph", data: { text: t("demo.welcomeParagraph") } },
          { id: "features-list", type: "list", data: { style: "unordered", items: [t("demo.welcomeListItem1"), t("demo.welcomeListItem2"), t("demo.welcomeListItem3"), t("demo.welcomeListItem4")] } },
        ],
      }}
    />
  );
};
