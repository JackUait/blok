interface ImportMetaEnv {
  readonly MODE: "test" | "development" | "production";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  cPreview: {
    show: (output: any, holder: Element) => void;
  };
}
