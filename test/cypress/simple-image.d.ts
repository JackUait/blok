/**
 * Declaration for external JS module @editorjs/simple-image
 */
declare module '@editorjs/simple-image' {
  interface SimpleImageConfig {
    data?: Record<string, unknown>;
    readOnly?: boolean;
    api?: unknown;
    block?: unknown;
  }

  interface SimpleImageInstance {
    render(): HTMLElement;
    save(block: HTMLElement): Record<string, unknown>;
  }

  interface SimpleImageTool {
    toolbox?: unknown;
    pasteConfig?: unknown;
    conversionConfig?: unknown;
    isReadOnlySupported?: boolean;
    new (config: SimpleImageConfig): SimpleImageInstance;
  }

  const Image: SimpleImageTool;
  export default Image;
}

