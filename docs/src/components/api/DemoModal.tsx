import type { FC } from "react";
import { useEffect, useRef, useCallback, useState } from "react";
import type { DemoConfig } from "./api-data";
import type { BlokEditorInstance } from "@/types/blok";
import { MiniBlokEditor, type MiniBlokEditorContainer } from "./MiniBlokEditor";
import { DemoControls } from "./DemoControls";
import { DemoOutput } from "./DemoOutput";

export interface DemoModalProps {
  demo: DemoConfig;
  methodName: string;
  onClose: () => void;
}

/**
 * Fullscreen modal for interactive API demos
 * Provides a larger editor and more space for experimentation
 */
export const DemoModal: FC<DemoModalProps> = ({ demo, methodName, onClose }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const [editor, setEditor] = useState<BlokEditorInstance | null>(null);
  const [output, setOutput] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  useEffect(() => {
    // Focus close button when modal opens
    closeButtonRef.current?.focus();

    // Handle escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    // Prevent body scroll
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleEditorReady = useCallback(
    (editorInstance: BlokEditorInstance) => {
      setEditor(editorInstance);
    },
    [],
  );

  const handleOutputChange = useCallback(
    (newOutput: { message: string; type: "success" | "error" } | null) => {
      setOutput(newOutput);
    },
    [],
  );

  const handleReset = useCallback(() => {
    const container =
      editorContainerRef.current as MiniBlokEditorContainer | null;
    if (container?.reset) {
      container.reset();
    }
    setOutput(null);
  }, []);

  return (
    <div
      className="demo-modal-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-modal-title"
    >
      <div ref={modalRef} className="demo-modal">
        <div className="demo-modal-header">
          <h2 id="demo-modal-title" className="demo-modal-title">
            Try it: <code>{methodName}</code>
          </h2>
          <button
            ref={closeButtonRef}
            className="demo-modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 6L6 18M6 6l12 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="demo-modal-content">
          <div ref={editorContainerRef} className="demo-modal-editor">
            <MiniBlokEditor
              initialState={demo.initialState}
              onEditorReady={handleEditorReady}
            />
          </div>
          <div className="demo-modal-controls">
            <DemoControls
              actions={demo.actions}
              editor={editor}
              onOutputChange={handleOutputChange}
              onReset={handleReset}
            />
            <DemoOutput output={output} />
          </div>
        </div>
      </div>
    </div>
  );
};
