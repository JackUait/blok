import type { AgentActor } from '../../types/agent';

export const safeClientName = (raw: string | undefined): string => {
  const cleaned = (raw ?? '').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);

  return cleaned === '' ? 'mcp-client' : cleaned;
};

export const defaultAgentActor = (principal: string, clientName: string): AgentActor => ({
  id: `agent:${principal}:${clientName}`,
  name: `${clientName} (for ${principal})`,
  kind: 'agent',
  onBehalfOf: principal,
});

/**
 * The name peers see in presence. Browsers label an agent "<name> for <person>"
 * themselves (03 §3.10), so the default actor's "(for …)" suffix is left off.
 * A host's own agentActor name is published as given.
 */
export const agentPresenceName = (input: { customActor: boolean; clientName: string; actor: AgentActor }): string =>
  input.customActor ? input.actor.name : input.clientName;
