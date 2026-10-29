/* eslint-disable no-restricted-syntax, max-depth -- ported line by line from parse5; restyling it risks behaviour the conformance suite would have to catch */
/**
 * The list of active formatting elements. Ported from parse5 (MIT, see NOTICE).
 */
import type { Attribute, TagToken } from './token';
import type { Element } from './tree';

//Const
const NOAH_ARK_CAPACITY = 3;

export enum EntryType {
    Marker,
    Element,
}

interface MarkerEntry {
    type: EntryType.Marker;
}

export interface ElementEntry {
    type: EntryType.Element;
    element: Element;
    token: TagToken;
}

export type Entry = MarkerEntry | ElementEntry;

const MARKER: MarkerEntry = { type: EntryType.Marker };

//List of formatting elements
export class FormattingElementList {
    entries: Entry[] = [];
    bookmark: Entry | null = null;

    //Noah Ark's condition
    //OPTIMIZATION: at first we try to find possible candidates for exclusion using
    //lightweight heuristics without thorough attributes check.
    private _getNoahArkConditionCandidates(
        newElement: Element,
        neAttrs: Attribute[],
    ): { idx: number; attrs: Attribute[] }[] {
        const candidates = [];

        const neAttrsLength = neAttrs.length;
        const neTagName = newElement.tagName;
        const neNamespaceURI = newElement.namespaceURI;

        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];

            if (entry.type === EntryType.Marker) {
                break;
            }

            const { element } = entry;

            if (
                element.tagName === neTagName &&
                element.namespaceURI === neNamespaceURI
            ) {
                const elementAttrs = element.attrs;

                if (elementAttrs.length === neAttrsLength) {
                    candidates.push({ idx: i, attrs: elementAttrs });
                }
            }
        }

        return candidates;
    }

    private _ensureNoahArkCondition(newElement: Element): void {
        if (this.entries.length < NOAH_ARK_CAPACITY) return;

        const neAttrs = newElement.attrs;
        const candidates = this._getNoahArkConditionCandidates(newElement, neAttrs);

        if (candidates.length < NOAH_ARK_CAPACITY) return;

        //NOTE: build attrs map for the new element, so we can perform fast lookups
        const neAttrsMap = new Map(neAttrs.map((neAttr: Attribute) => [neAttr.name, neAttr.value]));
        let validCandidates = 0;

        //NOTE: remove bottommost candidates, until Noah's Ark condition will not be met
        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i];

            // We know that `candidate.attrs.length === neAttrs.length`
            if (candidate.attrs.every((cAttr) => neAttrsMap.get(cAttr.name) === cAttr.value)) {
                validCandidates += 1;

                if (validCandidates >= NOAH_ARK_CAPACITY) {
                    this.entries.splice(candidate.idx, 1);
                }
            }
        }
    }

    //Mutations
    insertMarker(): void {
        this.entries.unshift(MARKER);
    }

    pushElement(element: Element, token: TagToken): void {
        this._ensureNoahArkCondition(element);

        this.entries.unshift({
            type: EntryType.Element,
            element,
            token,
        });
    }

    insertElementAfterBookmark(element: Element, token: TagToken): void {
        const bookmarkIdx = this.entries.indexOf(this.bookmark as Entry);

        this.entries.splice(bookmarkIdx, 0, {
            type: EntryType.Element,
            element,
            token,
        });
    }

    removeEntry(entry: Entry): void {
        const entryIndex = this.entries.indexOf(entry);

        if (entryIndex !== -1) {
            this.entries.splice(entryIndex, 1);
        }
    }

    /**
     * Clears the list of formatting elements up to the last marker.
     *
     * @see https://html.spec.whatwg.org/multipage/parsing.html#clear-the-list-of-active-formatting-elements-up-to-the-last-marker
     */
    clearToLastMarker(): void {
        const markerIdx = this.entries.indexOf(MARKER);

        if (markerIdx === -1) {
            this.entries.length = 0;
        } else {
            this.entries.splice(0, markerIdx + 1);
        }
    }

    //Search
    getElementEntryInScopeWithTagName(tagName: string): ElementEntry | null {
        const entry = this.entries.find(
            (entry) => entry.type === EntryType.Marker || entry.element.tagName === tagName,
        );

        return entry && entry.type === EntryType.Element ? entry : null;
    }

    getElementEntry(element: Element): ElementEntry | undefined {
        return this.entries.find(
            (entry): entry is ElementEntry => entry.type === EntryType.Element && entry.element === element,
        );
    }
}
