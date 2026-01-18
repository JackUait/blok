import { Dom as $ } from '../dom';
import type { BlokEventMap } from '../events';
import { RedactorDomChanged } from '../events';
import type { RedactorDomChangedPayload } from '../events/RedactorDomChanged';
import type { EventsDispatcher } from '../utils/events';
import { isMutationBelongsToElement } from '../utils/mutations';

/**
 * Result of handling a mutation
 */
export interface MutationHandleResult {
  /**
   * Whether the mutation should trigger a block update event
   */
  shouldFireUpdate: boolean;

  /**
   * New tool root element if it was replaced, null otherwise
   */
  newToolRoot: HTMLElement | null;
}

/**
 * Handles mutation observation and filtering for a Block.
 * Watches for DOM changes via the blok event bus and detects tool root element changes.
 */
export class MutationHandler {
  /**
   * Callback reference for cleanup
   */
  private redactorDomChangedCallback: ((payload: RedactorDomChangedPayload) => void) | null = null;

  /**
   * @param getToolElement - Getter for the current tool element (may change over time)
   * @param blokEventBus - Event bus for subscribing to DOM changes
   * @param onMutation - Callback when a relevant mutation occurs
   */
  constructor(
    private readonly getToolElement: () => HTMLElement | null,
    private readonly blokEventBus: EventsDispatcher<BlokEventMap> | null,
    private readonly onMutation: (mutations: MutationRecord[] | undefined) => void
  ) {}

  /**
   * Start watching for mutations via the blok event bus
   */
  public watch(): void {
    this.redactorDomChangedCallback = (payload) => {
      const { mutations } = payload;
      const toolElement = this.getToolElement();

      if (toolElement === null) {
        return;
      }

      const blockMutations = mutations.filter(record => isMutationBelongsToElement(record, toolElement));

      if (blockMutations.length > 0) {
        this.onMutation(blockMutations);
      }
    };

    this.blokEventBus?.on(RedactorDomChanged, this.redactorDomChangedCallback);
  }

  /**
   * Stop watching for mutations
   */
  public unwatch(): void {
    if (this.redactorDomChangedCallback) {
      this.blokEventBus?.off(RedactorDomChanged, this.redactorDomChangedCallback);
      this.redactorDomChangedCallback = null;
    }
  }

  /**
   * Process a mutation event and determine if it should trigger an update.
   *
   * @param mutationsOrInputEvent - Mutation records, input event, or undefined for manual dispatch
   * @returns Result containing whether to fire update and any new tool root element
   */
  public handleMutation(mutationsOrInputEvent: MutationRecord[] | InputEvent | undefined): MutationHandleResult {
    const isManuallyDispatched = mutationsOrInputEvent === undefined;
    const isInputEventHandler = mutationsOrInputEvent instanceof InputEvent;
    const isMutationRecords = !isManuallyDispatched && !isInputEventHandler;

    const newToolRoot = isMutationRecords ? this.detectToolRootChange(mutationsOrInputEvent) : null;
    const shouldFireUpdate = this.shouldFireUpdate(mutationsOrInputEvent);

    return { shouldFireUpdate, newToolRoot };
  }

  /**
   * Detect if the tool's root element was replaced in the mutations.
   *
   * @param mutations - Mutation records to check
   * @returns New tool root element if replaced, null otherwise
   */
  public detectToolRootChange(mutations: MutationRecord[]): HTMLElement | null {
    const toolElement = this.getToolElement();

    if (toolElement === null) {
      return null;
    }

    for (const record of mutations) {
      const toolRootHasBeenUpdated = Array.from(record.removedNodes).includes(toolElement);

      if (!toolRootHasBeenUpdated) {
        continue;
      }

      const newToolElement = record.addedNodes[record.addedNodes.length - 1];

      if (newToolElement instanceof HTMLElement) {
        return newToolElement;
      }
    }

    return null;
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    this.unwatch();
  }

  /**
   * Determine if a mutation should trigger a block update event.
   * Filters out mutations that only affect mutation-free elements.
   */
  private shouldFireUpdate(mutationsOrInputEvent: MutationRecord[] | InputEvent | undefined): boolean {
    const isManuallyDispatched = mutationsOrInputEvent === undefined;
    const isInputEventHandler = mutationsOrInputEvent instanceof InputEvent;

    if (isManuallyDispatched || isInputEventHandler) {
      return true;
    }

    const everyRecordIsMutationFree = mutationsOrInputEvent.length > 0 && mutationsOrInputEvent.every((record) => {
      const { addedNodes, removedNodes, target } = record;
      const changedNodes = [
        ...Array.from(addedNodes),
        ...Array.from(removedNodes),
        target,
      ];

      return changedNodes.every((node) => {
        const elementToCheck: Element | null = !$.isElement(node)
          ? node.parentElement ?? null
          : node;

        if (elementToCheck === null) {
          return false;
        }

        return elementToCheck.closest('[data-blok-mutation-free="true"]') !== null;
      });
    });

    return !everyRecordIsMutationFree;
  }
}
