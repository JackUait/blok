export interface OutputBlockData {
  id: string;
  type: string;
  data: Record<string, unknown>;
  parent?: string;
  content?: string[];
}

export interface OutputData {
  version: string;
  blocks: OutputBlockData[];
}
