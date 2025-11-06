/**
 * Declaration for external JS module @editorjs/delimiter
 */
declare module '@editorjs/delimiter' {
  interface DelimiterConfig {
    data?: Record<string, unknown>;
    readOnly?: boolean;
    api?: unknown;
    block?: unknown;
  }

  interface DelimiterInstance {
    render(): HTMLElement;
    save(block: HTMLElement): Record<string, unknown>;
  }

  interface DelimiterTool {
    toolbox?: unknown;
    pasteConfig?: unknown;
    conversionConfig?: unknown;
    isReadOnlySupported?: boolean;
    new (config: DelimiterConfig): DelimiterInstance;
  }

  const Delimiter: DelimiterTool;
  export default Delimiter;
}

