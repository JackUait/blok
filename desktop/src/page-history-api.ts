import type {LooseOutputData} from '../../types';
import type {AgentRestorePreview} from '../../types/agent';

export interface HistoryPoint {lineage: string; sequence: number}
export interface HistoryVersion extends HistoryPoint {savedAt: number | null; startedAt: number | null; actors: string[]}
export interface HistoryList {lineages: Array<{lineage: string; current: boolean}>; versions: HistoryVersion[]}
export type HistoryDocument = LooseOutputData & {page?: {title?: string; icon?: string}};
export type RestorePlan = AgentRestorePreview & {expectRevision: string};
export interface PageHistoryApi {
  list(group: string, signal?: AbortSignal): Promise<HistoryList>;
  read(point: HistoryPoint, signal?: AbortSignal): Promise<HistoryDocument>;
  preview(point: HistoryPoint, signal?: AbortSignal): Promise<RestorePlan>;
  restore(point: HistoryPoint, plan: Pick<RestorePlan, 'expectRevision' | 'guards'>, key: string): Promise<void>;
}
const messages: Record<number, string> = {
  401:'Votre session a expiré. Reconnectez-vous pour consulter l’historique.',
  403:'Vous n’avez pas accès à cet historique ou à sa restauration.',
  404:'Cette version n’est plus disponible ou n’est plus conservée.',
  409:'La restauration ne peut pas être appliquée. Actualisez son aperçu.',
  412:'La page a changé depuis cet aperçu. Vérifiez de nouveau la restauration.',
  413:'Cette version est trop volumineuse pour être restaurée.',
  501:'L’historique n’est pas disponible sur ce serveur.',
};
function path(point: HistoryPoint): string {
  if (!point.lineage || point.lineage === '.' || point.lineage === '..' || !Number.isSafeInteger(point.sequence) || point.sequence < 0) throw new Error('Version invalide.');
  return `${encodeURIComponent(point.lineage)}/${point.sequence}`;
}
export function createPageHistoryApi(options: {server: string; doc: string; ticket(): Promise<string>}): PageHistoryApi {
  const base = `${options.server}/sync/${encodeURIComponent(options.doc)}/history`;
  const send = async (suffix: string, init: RequestInit = {}, retry = true): Promise<Response> => {
    const token = await options.ticket();
    const response = await fetch(`${base}${suffix}`, {...init, headers:{...init.headers,Authorization:`Bearer ${token}`}});
    if (response.status === 401 && retry) return send(suffix,init,false);
    if (!response.ok) throw new Error(messages[response.status] ?? 'Impossible de charger l’historique. Réessayez.');
    return response;
  };
  return {
    async list(group,signal) {
      const body = await (await send(`?group=${encodeURIComponent(group)}`,{signal})).json() as HistoryList;
      if (!Array.isArray(body.versions) || !Array.isArray(body.lineages)) throw new Error('Historique illisible.');
      return body;
    },
    async read(point,signal) {
      const body = await (await send(`/${path(point)}`,{signal})).json() as HistoryDocument;
      if (!Array.isArray(body.blocks)) throw new Error('Cette version est illisible.');
      return body;
    },
    async preview(point,signal) {
      const body = await (await send(`/${path(point)}/restore/preview`,{method:'POST',signal})).json() as RestorePlan;
      if (!body.expectRevision || !/^[^"\r\n]+:\d+$/.test(body.expectRevision) || !Array.isArray(body.guards) || !Array.isArray(body.wouldUndo?.blocks) || !Array.isArray(body.wouldUndo?.page) || typeof body.fits !== 'boolean') throw new Error('Impossible de vérifier cette restauration.');
      return body;
    },
    async restore(point,plan,key) {
      if (!/^[^"\r\n]+:\d+$/.test(plan.expectRevision)) throw new Error('La restauration doit être prévisualisée.');
      await send(`/${path(point)}/restore`,{method:'POST',headers:{'Content-Type':'application/json','Blok-Idempotency-Key':key,'If-Match':`"${plan.expectRevision}"`},body:JSON.stringify({confirm:[...new Set(plan.guards.map(guard=>guard.kind))]})});
    },
  };
}
