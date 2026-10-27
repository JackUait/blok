import type { AgentActor } from '../../types/agent';
import type { UploadContext, UploadedAsset } from '../../types/configs/uploader';
import type { BlokCustomToolsFile, ManifestOverrides } from '../../types/tool-manifest';

export interface BlokMcpOptions {
  transport: { kind: 'stdio' } | { kind: 'http'; listen: string; public?: boolean };
  auth: { kind: 'none' } | { kind: 'oauth'; issuer: string; audience: string; jwksUrl: string };
  sync?: { url: string; origin?: string };
  tickets?: { kind: 'secret'; secret: string } | { kind: 'url'; url: string; hostToken: string };
  authorize?: (principal: string, documentId: string, write: boolean) => Promise<boolean>;
  agentActor?: (principal: string, clientName: string) => AgentActor;
  source?: { kind: 'endpoint'; url: string; endpointAuth: string; list?: string } | { kind: 'files'; dir: string };
  manifest?: BlokCustomToolsFile;
  pageTitles?: 'off' | 'page-map';
  overrides?: ManifestOverrides;
  richTextFields?: Record<string, string[]>;
  schema?: 'envelope' | 'full' | 'mixed';
  handleIdleMs?: number;
  maxHandlesPerPrincipal?: number;
  principal?: string;
  uploads?: McpUploads;
  /**
   * False: the editors keep comments in the host's own system (a `comments` hook). Agent
   * comments would be invisible to people there, so the comment commands are unavailable.
   * On by default.
   */
  comments?: boolean;
}

/** The host's own uploader, which `<tool>.uploadFile` sends files through. */
export interface McpUploads {
  uploader: {
    uploadByFile(file: File, ctx: UploadContext): Promise<UploadedAsset & { size?: number; mimeType?: string }>;
    uploadByUrl?(url: string, ctx: UploadContext): Promise<UploadedAsset>;
  };
  /** A folder the agent may upload files from by path. stdio only. Absent: bytes only. */
  root?: string;
  /** Per kind, as a media tool's `types` and `maxSize`. Absent: the tool's defaults. */
  limits?: Partial<Record<'image' | 'video' | 'audio' | 'file', { types?: string[]; maxSize?: number }>>;
}

export const DEFAULTS: {
  handleIdleMs: 600_000;
  maxHandlesPerPrincipal: 8;
  schema: 'mixed';
  pageTitles: 'off';
  principal: 'local';
} = {
  handleIdleMs: 600_000,
  maxHandlesPerPrincipal: 8,
  schema: 'mixed',
  pageTitles: 'off',
  principal: 'local',
};
