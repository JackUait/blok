import type { FC } from 'react';
import { useRef, useState, useCallback } from 'react';
import type { DemoConfig } from './api-data';
import type { BlokEditorInstance } from '@/types/blok';
import { MiniBlokEditor } from './MiniBlokEditor';
import type { MiniBlokEditorContainer } from './MiniBlokEditor';
import { DemoControls } from './DemoControls';
import { DemoOutput } from './DemoOutput';

export interface ApiMethodDemoProps {
  demo?: DemoConfig;
}

/**
 * Demo section for an API method
 * Combines the mini editor with action buttons and output display
 */
export const ApiMethodDemo: FC<ApiMethodDemoProps> = ({ demo }) => {
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const [editor, setEditor] = useState<BlokEditorInstance | null>(null);
  const [output, setOutput] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const handleEditorReady = useCallback((editorInstance: BlokEditorInstance) => {
    setEditor(editorInstance);
  }, []);

  const handleOutputChange = useCallback(
    (newOutput: { message: string; type: 'success' | 'error' } | null) => {
      setOutput(newOutput);
    },
    []
  );

  const handleReset = useCallback(() => {
    // Access the reset method from the DOM element
    const container = editorContainerRef.current as MiniBlokEditorContainer | null;
    if (container?.reset) {
      container.reset();
    }
    setOutput(null);
  }, []);

  if (!demo) {
    return null;
  }

  return (
    <div className="api-method-demo">
      <div ref={editorContainerRef}>
        <MiniBlokEditor
          initialState={demo.initialState}
          onEditorReady={handleEditorReady}
        />
      </div>
      <DemoControls
        actions={demo.actions}
        editor={editor}
        onOutputChange={handleOutputChange}
        onReset={handleReset}
      />
      <DemoOutput output={output} />
    </div>
  );
};
