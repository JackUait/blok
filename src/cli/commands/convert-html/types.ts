export interface OutputBlockData {
  id: string;
  type: string;
  data: Record<string, unknown>;
  parent?: string;
  content?: string[];
  stretched?: number | null;
  key?: string | null;
  width?: number | null;
}

export interface OutputData {
  version: string;
  blocks: OutputBlockData[];
}
