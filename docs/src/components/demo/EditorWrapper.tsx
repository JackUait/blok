import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../contexts/I18nContext";
import { useTheme } from "../../hooks/useTheme";

interface BlokEditor {
  save: () => Promise<unknown>;
  clear: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  destroy?: () => void;
  theme: { set: (mode: "dark" | "light" | "auto") => void };
}

interface BlokModule {
  Blok: new (config: unknown) => BlokEditor;
  Header: unknown;
  Paragraph: unknown;
  List: unknown;
  Bold: unknown;
  Italic: unknown;
  Link: unknown;
}

export const EditorWrapper: React.FC<{
  onEditorReady?: (editor: BlokEditor) => void;
}> = ({ onEditorReady }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<BlokEditor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();

  // Use a ref so the init effect can read the current theme without re-running
  const resolvedThemeRef = useRef(resolvedTheme);
  resolvedThemeRef.current = resolvedTheme;

  // Use a ref to store the latest callback without triggering re-runs
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;

  // Use a ref to access t inside the one-time effect without adding it as a dependency
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const editorState = { editor: null as BlokEditor | null, isMounted: true };

    const initEditor = async () => {
      if (!containerRef.current || !editorState.isMounted) return;

      try {
        // Import the full bundle which includes all tools (resolved by Vite at runtime)
        // @ts-expect-error - /dist/full.mjs is served by Vite, not resolvable at compile time
        const module = (await import("/dist/full.mjs")) as BlokModule;

        if (!editorState.isMounted || !containerRef.current) return;

        // Make tools available globally for the editor config
        (window as unknown as Record<string, unknown>).BlokHeader =
          module.Header;
        (window as unknown as Record<string, unknown>).BlokParagraph =
          module.Paragraph;
        (window as unknown as Record<string, unknown>).BlokList = module.List;
        (window as unknown as Record<string, unknown>).BlokBold = module.Bold;
        (window as unknown as Record<string, unknown>).BlokItalic =
          module.Italic;
        (window as unknown as Record<string, unknown>).BlokLink = module.Link;

        // Create the editor
        const BlokClass = module.Blok;
        editorState.editor = new BlokClass({
          holder: containerRef.current,
          theme: resolvedThemeRef.current,
          tools: {
            header: {
              class: module.Header,
              config: {
                placeholder: tRef.current("demo.headerPlaceholder"),
                levels: [1, 2, 3, 4],
                defaultLevel: 2,
              },
              inlineToolbar: ["bold", "italic", "link"],
            },
            paragraph: {
              class: module.Paragraph,
              inlineToolbar: ["bold", "italic", "link"],
              config: {
                preserveBlank: true,
                placeholder: tRef.current("demo.paragraphPlaceholder"),
              },
            },
            list: {
              class: module.List,
              inlineToolbar: true,
              config: {
                defaultStyle: "unordered",
              },
            },
          },
          data: {
            blocks: [
              {
                id: "welcome-block",
                type: "header",
                data: {
                  text: tRef.current("demo.welcomeTitle"),
                  level: 2,
                },
              },
              {
                id: "intro-block",
                type: "paragraph",
                data: {
                  text: tRef.current("demo.welcomeParagraph"),
                },
              },
              {
                id: "features-list",
                type: "list",
                data: {
                  style: "unordered",
                  items: [
                    tRef.current("demo.welcomeListItem1"),
                    tRef.current("demo.welcomeListItem2"),
                    tRef.current("demo.welcomeListItem3"),
                    tRef.current("demo.welcomeListItem4"),
                  ],
                },
              },
            ],
          },
          onChange: () => {
            // Optional: Auto-save indicator
            console.log("Content changed");
          },
          onReady: () => {
            console.log("Blok editor is ready!");
          },
        });

        const { editor, isMounted } = editorState;
        const shouldDestroy = !isMounted && editor?.destroy;

        if (shouldDestroy) {
          editor.destroy?.();
          return;
        }

        if (!isMounted) {
          return;
        }

        editorRef.current = editor;
        setLoading(false);
        if (editor) {
          onEditorReadyRef.current?.(editor);
        }
      } catch (err) {
        if (editorState.isMounted) {
          const errorMessage =
            err instanceof Error ? err.message : tRef.current("common.unknownError");
          setError(errorMessage);
          setLoading(false);
        }
      }
    };

    void initEditor();

    return () => {
      editorState.isMounted = false;
      // Cleanup: destroy the editor instance
      const currentEditor = editorRef.current;
      if (currentEditor?.destroy) {
        currentEditor.destroy();
        editorRef.current = null;
      }
    };
  }, []); // Empty deps array - only run once

  // Sync docs theme changes to the editor instance
  useEffect(() => {
    editorRef.current?.theme.set(resolvedTheme);
  }, [resolvedTheme]);

  if (error) {
    return (
      <div className="blok-editor">
        <div
          style={{
            padding: "2rem",
            textAlign: "center",
            color: "var(--demo-text-muted, #666)",
          }}
        >
          <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
            {t("demo.editorWrapper.failedToLoad")}
          </p>
          <p style={{ fontSize: 14 }}>
            {t("demo.editorWrapper.buildHint")} <code>npm run build</code>
          </p>
          <p style={{ fontSize: 12, marginTop: "1rem" }}>{t("demo.editorWrapper.errorPrefix")} {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="blok-editor">
      {loading && (
        <div className="editor-placeholder">
          <div className="placeholder-content">
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
            <p>{t("demo.editorWrapper.loading")}</p>
          </div>
        </div>
      )}
    </div>
  );
};
