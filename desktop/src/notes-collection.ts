import type { AgentBatch, AgentResult } from '../../types/agent';
import type { AgentTurnOptions } from '../../types/api/agent';
import type { OutputData } from '../../types/data-formats/output-data';
import type { DatabaseData } from '../../types/tools/database';
import { workspaceKey, type WorkspaceRef } from './workspace-registry';

export interface NotesCollection { pageId: string; databaseId: string }
const registryKey = (ref: WorkspaceRef): string => `blok:desktop:notes:v1:${workspaceKey(ref)}`;

/** A local navigation preference, not a second content store. */
export function readNotesCollection(ref: WorkspaceRef): NotesCollection | null {
  const raw = localStorage.getItem(registryKey(ref));
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('pageId' in value) || !('databaseId' in value)
    || typeof value.pageId !== 'string' || !value.pageId || typeof value.databaseId !== 'string' || !value.databaseId) {
    throw new Error('La référence de la collection Notes est invalide.');
  }
  return { pageId: value.pageId, databaseId: value.databaseId };
}

export function rememberNotesCollection(ref: WorkspaceRef, collection: NotesCollection): void {
  localStorage.setItem(registryKey(ref), JSON.stringify(collection));
}

/** Only seed a newly created page; never replace an existing document with this. */
export function createNotesDocument(databaseId: string): OutputData {
  const data: DatabaseData = {
    title: 'Notes', fullPage: true,
    schema: [
      { id: 'title', name: 'Nom', type: 'title', position: 'a0' },
      { id: 'created', name: 'Date de création', type: 'createdTime', position: 'a1' },
    ],
    views: [
      { id: 'table', name: 'Tableau', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['created'] },
      { id: 'list', name: 'Liste', type: 'list', position: 'a1', sorts: [], filters: [], visibleProperties: ['created'] },
    ],
    activeViewId: 'table',
  };
  return { title: 'Notes', blocks: [{ id: databaseId, type: 'database', data }] };
}

interface NotesEditor {
  isReady: Promise<unknown>;
  agent: { begin(options: AgentTurnOptions): { execute(batch: AgentBatch): Promise<AgentResult>; end(): void } };
  blocks: { getById(id: string): { name: string; call(method: string, args?: Record<string, unknown>): void } | null };
}

/** Native row creation supplies timestamps, templates and the editable row body. */
export async function addNote(editor: NotesEditor, databaseId: string, isCurrent: () => boolean = () => true): Promise<string> {
  await editor.isReady;
  if (!isCurrent()) throw new Error('La page a changé avant la création de la note.');
  const database = editor.blocks.getById(databaseId);
  if (database?.name !== 'database') throw new Error('La base Notes est introuvable dans cette page.');
  const turn = editor.agent.begin({ agent: { id: 'desktop-notes', name: 'Notes' }, attributeTo: 'user' });
  try {
    const result = await turn.execute({ commands: [{ name: 'database.addRow', args: { id: databaseId } }] });
    if (!result.ok) throw new Error(result.error.message);
    const row = result.results[0];
    if (!row || typeof row !== 'object' || !('rowId' in row) || typeof row.rowId !== 'string') {
      throw new Error('La note a été créée sans référence utilisable. Vérifiez la collection avant de réessayer.');
    }
    if (isCurrent()) database.call('openRow', { rowId: row.rowId, mode: 'full', explicit: true });
    return row.rowId;
  } finally {
    turn.end();
  }
}
