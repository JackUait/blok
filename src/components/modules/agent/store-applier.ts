import * as Y from 'yjs';

import { DocSnapshot } from '../../../shared/agent/snapshot';
import { readPageFields, writePageField } from '../yjs/page-fields';
import { stripNul } from '../yjs/serializer';

import type { Edit, PlannedBlock } from '../../../../types/agent';
import type { RichText } from '../../../../types/rich-text';
import type { Attribution } from '../../../shared/agent/attribution';
import type { AgentApplier } from '../../../shared/agent/executor';
import type { Plan } from '../../../shared/agent/types';
import type { DocumentStore } from '../yjs/document-store';

export class StoreApplier implements AgentApplier {
  public readonly runtime: 'node-live' = 'node-live';
  private count = 0;
  private broken = false;
  private readonly unsubscribe: () => void;
  public readonly prepareInsert: AgentApplier['prepareInsert'];

  public constructor(
    private readonly store: DocumentStore,
    private readonly options: {
      /** Who the writes are credited to (agentAttribution). */
      attribution: Attribution;
      richTextFieldsFor(type: string): string[];
      htmlToSegments(html: string): RichText;
      /** Set only where the host prepares inserts, such as blok-mcp creating a page's document. */
      prepareInsert?: AgentApplier['prepareInsert'];
    }
  ) {
    this.prepareInsert = options.prepareInsert;
    this.unsubscribe = store.onAnyUpdate(() => {
      this.count++;
    });
  }

  public isReadOnly(): boolean {
    return this.broken;
  }

  public revision(): string {
    return `l${this.count}`;
  }

  public snapshot(): DocSnapshot {
    const blocks = this.store.toJSON().map(block => {
      const fields = this.options.richTextFieldsFor(block.type);

      return {
        ...block,
        data: Object.fromEntries(Object.entries(block.data).map(([key, value]): [string, unknown] => [
          key,
          fields.includes(key) && typeof value === 'string' ? this.options.htmlToSegments(value) : value,
        ])),
      };
    });

    return DocSnapshot.fromOutput({ ...readPageFields(this.store.page), blocks });
  }

  public apply(plan: Plan, _draft: DocSnapshot): Promise<void> {
    try {
      const at = Date.now();

      this.store.transact(() => {
        for (const edit of plan.edits) {
          this.applyOne(edit, at);
        }
        for (const id of plan.touched) {
          if (this.store.getBlockById(id) !== undefined) {
            this.store.updateBlockMetadata(id, at, this.options.attribution.by ?? null, this.options.attribution.with);
          }
        }
      }, 'local');
    } catch (error) {
      // Yjs keeps partial writes; the executor blocks later writes.
      this.broken = true;

      return Promise.reject(error);
    }

    return Promise.resolve();
  }

  public dispose(): void {
    this.unsubscribe();
  }

  private insertTree(block: PlannedBlock, parentId: string | null, afterId: string | null, at: number): void {
    // Same rule as YjsManager.withCreationStamp: an anonymous answer and its body name no creator.
    const anonymous = (block.type === 'database-row' && block.data.anonymous === true)
      || this.store.isInAnonymousAnswer(undefined, parentId);
    const { by, with: coAuthor } = this.options.attribution;

    this.store.addBlockAt({
      id: block.id,
      type: block.type,
      data: block.data,
      ...(block.tunes === undefined ? {} : { tunes: block.tunes }),
      createdAt: at,
      ...(anonymous || by === undefined ? {} : { createdBy: by, ...(coAuthor !== undefined && { createdWith: coAuthor }) }),
    }, { parentId, afterId });

    for (const [index, child] of block.children.entries()) {
      this.insertTree(child, block.id, block.children[index - 1]?.id ?? null, at);
    }
  }

  private childrenOf(id: string): string[] {
    return this.store.toJSON().find(block => block.id === id)?.content ?? [];
  }

  private applyOne(edit: Edit, at: number): void {
    switch (edit.op) {
      case 'insert':
        this.insertTree(edit.block, edit.parentId, edit.afterId, at);
        break;
      case 'remove': {
        if (edit.withChildren) {
          const walk = (id: string): string[] => [...this.childrenOf(id).flatMap(walk), id];

          walk(edit.id).forEach(id => this.store.removeBlock(id));
          break;
        }

        const placement = this.store.getPlacement(edit.id);
        const children = this.childrenOf(edit.id);

        for (const [index, child] of children.entries()) {
          this.store.moveBlockTo(child, {
            parentId: placement?.parentId ?? null,
            afterId: index === 0 ? placement?.afterId ?? null : children[index - 1] ?? null,
          });
        }
        this.store.removeBlock(edit.id);
        break;
      }
      case 'move':
        this.store.moveBlockTo(edit.id, { parentId: edit.parentId, afterId: edit.afterId });
        break;
      case 'setData':
        for (const [key, value] of Object.entries(edit.patch)) {
          this.store.updateBlockData(edit.id, key, value === null ? undefined : value);
        }
        break;
      case 'setRichText':
        this.store.updateBlockData(edit.id, edit.field, edit.value);
        break;
      case 'setTunes':
        Object.entries(edit.tunes).forEach(([name, value]) => {
          if (value === null) {
            // Native tune updates store null instead of deleting the key.
            const tunes: unknown = this.store.getBlockById(edit.id)?.get('tunes');

            if (tunes instanceof Y.Map) {
              tunes.delete(stripNul(name));
            }
          } else {
            this.store.updateBlockTune(edit.id, name, value);
          }
        });
        break;
      case 'replaceType':
        this.store.replaceBlockContent(edit.id, edit.type, edit.data);
        break;
      case 'setPageField':
        writePageField(this.store.page, edit.key, edit.value);
        break;
    }
  }
}
