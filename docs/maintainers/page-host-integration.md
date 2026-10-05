# Page metadata in a host

A `page` block is an owning pointer. Save only its opaque `pageId` in the parent document. Keep `{ pageId, title, icon, version }` in a host-owned record. The page body remains a separate Blok document. Do not reconstruct a title or an icon from `history.track()`.

Configure the page tool with a stable, title-free `href(pageId)`, an access-filtered `resolve(pageId)`, and `subscribe(pageId, notify)`. Return `null` for a missing page, `{ access: 'none' }` for a denied page, and `undefined` while unresolved. Call each subscriber when the page's title, icon, path, or access changes. Fan out local writes in the same tab as well as server events in other tabs and devices. A title change must redraw the open header and tree and invalidate the page pointers.

## Canonical title writes

The host API below uses a compare-and-swap write. `loadPage` must enforce access and reject when it is lost. `saveTitle` must atomically reject an `expectedVersion` that is no longer current and return the accepted title and new version only after a durable write. The host broadcasts that accepted change to other tabs. `notify` invalidates this tab's page-pointer subscribers, including during an optimistic edit or rollback.

```ts
import type { History } from '@bloklabs/core';

type PageRecord = {
  pageId: string;
  title: string;
  icon?: string;
  version: number;
};

type PageHost = {
  loadPage(pageId: string): Promise<PageRecord>;
  saveTitle(pageId: string, title: string, expectedVersion: number): Promise<PageRecord>;
  subscribe(pageId: string, notify: () => void): () => void;
  notify(pageId: string): void;
};

async function wireTitle(
  pageId: string,
  host: PageHost,
  history: History,
  paint: (title: string) => void,
  showError: () => void
): Promise<{ input: (title: string, typing: boolean) => void; stop: () => void }> {
  let accepted = await host.loadPage(pageId);
  let displayed = accepted.title;
  let latestWrite = 0;
  let latestRead = 0;
  let pending = 0;
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();

  const tracked = history.track<string>('title', (value, { source }) => {
    if (source === 'remote') {
      refreshFromHost();
      return;
    }
    changeTitle(value ?? '');
  });
  tracked.set(accepted.title, { record: false });
  paint(accepted.title);

  function showAccepted(): void {
    if (stopped) return;
    displayed = accepted.title;
    tracked.set(displayed, { record: false });
    paint(displayed);
    host.notify(pageId);
  }

  function changeTitle(next: string): void {
    if (stopped || next === displayed) return;
    const ticket = ++latestWrite;

    displayed = next;
    paint(next);
    host.notify(pageId);
    pending += 1;
    queue = queue.then(async () => {
      try {
        if (stopped) return;
        const saved = await host.saveTitle(pageId, next, accepted.version);

        if (saved.version > accepted.version) accepted = saved;
        if (ticket === latestWrite) showAccepted();
      } catch {
        try {
          const current = await host.loadPage(pageId);

          if (current.version > accepted.version) accepted = current;
          // A rejected earlier request must not replace a later local edit.
          if (ticket === latestWrite && !stopped) {
            showAccepted();
            showError();
          }
        } catch {
          if (!stopped) {
            stop();
            paint('');
            host.notify(pageId);
            showError();
          }
        }
      } finally {
        pending -= 1;
      }
    });
  }

  function refreshFromHost(): void {
    const order = ++latestRead;

    void host.loadPage(pageId).then((record) => {
      if (stopped || order !== latestRead) return;
      const newer = record.version > accepted.version;
      if (newer) accepted = record;
      if (pending === 0 && (newer || tracked.get() !== accepted.title || displayed !== accepted.title)) {
        showAccepted();
      }
    }).catch(() => {
      if (stopped || order !== latestRead) return;
      stop();
      paint('');
      host.notify(pageId);
    });
  }

  const unsubscribe = host.subscribe(pageId, refreshFromHost);

  function stop(): void {
    stopped = true;
    latestRead += 1;
    unsubscribe();
  }

  return {
    input: (title, typing) => {
      tracked.set(title, { typing });
      changeTitle(title);
    },
    stop,
  };
}
```

The queue sends rapid edits in order, using the latest accepted version for each request. After a failed latest write, a successful authorized reload restores the accepted title in the header, tree, and pointer subscribers and reports the error. An older failure cannot roll back a newer optimistic edit.

If the reload also fails, this example clears the title and stops subscriptions rather than displaying metadata without a fresh access verdict. The host must retry `wireTitle` after access can be checked again; until then, render a neutral unavailable state.

The history value is only an Undo/Redo and collaboration mirror; bootstrap it from the host record, not the other way around. A remote mirror event reloads the host record and never writes the mirror value as canonical. The peer that originated an edit must write it to the host. A production host still needs an explicit conflict policy for edits from different devices. It must not silently overwrite a peer's accepted title after a version conflict.

On access loss, clear the open page and stop this wiring before showing another title. Recheck access for every server event and every save. An inaccessible page's `resolve` result must be `{ access: 'none' }`, even if this tab held an earlier allowed title. The playground's `localStorage` registry demonstrates same-profile tab notifications only. It merges stored records before each write, but it has no atomic version check for simultaneous edits. It cannot prove cross-device authority or enforce access. Real-host acceptance remains blocked until authorized and denied users are checked across tabs and devices through rename, Undo, rejected save, access loss, reload, and a stale resolve.

## Importing page pointers

Notion clipboard page records can contain an ID and title without the page body. The V3 parser maps a subpage record to an ID-only owning `page` pointer, but the editor's singleton paste path can convert it to a non-owning link. Neither path imports the body or creates a host page. Do not treat the foreign ID as a local page until the host resolves an existing page or imports the body and remaps the ID. The host's `href` must not generate a local route for an unknown foreign ID. Do not create an empty host page merely because the pasted record has a title. If import is unavailable, the host may offer a link to the Notion page instead. A `page-link` remains non-owning and cannot create the target page.
