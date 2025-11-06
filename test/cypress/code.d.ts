/**
 * Declaration for external JS module @editorjs/code
 */
declare module '@editorjs/code' {
  interface CodeConfig {
    data?: Record<string, unknown>;
    readOnly?: boolean;
    api?: unknown;
    block?: unknown;
  }

  interface CodeInstance {
    render(): HTMLElement;
    save(block: HTMLElement): Record<string, unknown>;
  }

  interface CodeTool {
    toolbox?: unknown;
    pasteConfig?: unknown;
    conversionConfig?: unknown;
    isReadOnlySupported?: boolean;
    new (config: CodeConfig): CodeInstance;
  }

  const Code: CodeTool;
  export default Code;
}

