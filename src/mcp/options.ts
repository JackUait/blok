import type { AgentActor } from '../../types/agent';
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
  schema?: 'envelope' | 'full';
  handleIdleMs?: number;
  maxHandlesPerPrincipal?: number;
  principal?: string;
}

export const DEFAULTS: {
  handleIdleMs: 600_000;
  maxHandlesPerPrincipal: 8;
  schema: 'envelope';
  pageTitles: 'off';
  principal: 'local';
} = {
  handleIdleMs: 600_000,
  maxHandlesPerPrincipal: 8,
  schema: 'envelope',
  pageTitles: 'off',
  principal: 'local',
};
