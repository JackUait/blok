# Page metadata in a host

A `page` block is an owning pointer. Save only its opaque `pageId` in the parent document. Keep `{ pageId, title, icon, version }` in a host-owned record. The page body remains a separate Blok document. Do not reconstruct a title or an icon from the editor's own title.

Configure the page tool with a stable, title-free `href(pageId)`, an access-filtered `resolve(pageId)`, and `subscribe(pageId, notify)`. Return `null` for a missing page, `{ access: 'none' }` for a denied page, and `undefined` while unresolved. Call each subscriber when the page's title, icon, path, or access changes. Fan out local writes in the same tab as well as server events in other tabs and devices. A title change must redraw the open header and tree and invalidate the page pointers.

## Canonical title writes

The open page shows its title through Blok's built-in title. Pass `pageTitle: { onChange: (title, change) => wired?.change(title, change) }` in the config, where `wired` is what `wireTitle` returned. `paint` shows a title wherever the page's title appears, the editor included. Guard its editor write with `title.get() !== value`, so a save's echo never cuts the user's undo step. The host API below uses a compare-and-swap write. `loadPage` must enforce access and reject when it is lost. `saveTitle` must atomically reject an `expectedVersion` that is no longer current and return the accepted title and new version only after a durable write. The host broadcasts that accepted change to other tabs. `notify` invalidates this tab's page-pointer subscribers, including during an optimistic edit or rollback.

```ts
import type { Title, TitleChange } from '@bloklabs/core';

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
  editor: { title: Title },
  paint: (title: string) => void,
  showError: () => void
): Promise<{ change: (title: string, change: TitleChange) => void; stop: () => void }> {
  let accepted = await host.loadPage(pageId);
  let displayed = accepted.title;
  let latestWrite = 0;
  let latestRead = 0;
  let pending = 0;
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();

  editor.title.set(accepted.title, { record: false });
  paint(accepted.title);

  function showAccepted(): void {
    if (stopped) return;
    displayed = accepted.title;
    editor.title.set(displayed, { record: false });
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
      if (pending === 0 && (newer || editor.title.get() !== accepted.title || displayed !== accepted.title)) {
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
    // Call it from pageTitle.onChange.
    change: (title, { source, record }) => {
      // Our own record:false write: the value came from the host.
      if (source === 'api' && record === false) return;
      if (source === 'remote') {
        refreshFromHost();
        return;
      }
      changeTitle(title);
    },
    stop,
  };
}
```

The queue sends rapid edits in order, using the latest accepted version for each request. After a failed latest write, a successful authorized reload restores the accepted title in the header, tree, and pointer subscribers and reports the error. An older failure cannot roll back a newer optimistic edit.

If the reload also fails, this example clears the title and stops subscriptions rather than displaying metadata without a fresh access verdict. The host must retry `wireTitle` after access can be checked again; until then, render a neutral unavailable state.

The editor's title is only what the page shows, plus its Undo/Redo and collaboration copy. Bootstrap it from the host record with `title.set(value, { record: false })`, not the other way around. That write makes no undo step, and its `onChange` (source `api`, `record: false`) is skipped, so the host's value is never saved back. A `remote` change reloads the host record and never saves the editor's value as canonical. A user, Undo or Redo change is saved. The peer that originated an edit must write it to the host. A production host still needs an explicit conflict policy for edits from different devices. It must not silently overwrite a peer's accepted title after a version conflict.

On access loss, clear the open page and stop this wiring before showing another title. Recheck access for every server event and every save. An inaccessible page's `resolve` result must be `{ access: 'none' }`, even if this tab held an earlier allowed title. The playground's `localStorage` registry demonstrates same-profile tab notifications only. It merges stored records before each write, but it has no atomic version check for simultaneous edits. It cannot prove cross-device authority or enforce access. In local mode the registry follows every title change the editor reports, a peer's `remote` one included.

The executable acceptance check runs against a reference host instead:

- `scripts/dev-page-host.mjs` is a dev-only host. It keeps `{ pageId, title, icon, version }` and per-user access, saves titles with compare-and-swap, and sends page-id-only events. `yarn serve` starts it, and `?host=remote` makes the playground use it.
- `src/playground/remote-page-host.ts` runs a typed copy of the `wireTitle` sample above against that host. The code block in this file is still not compiled; keep the two in step.
- `test/playwright/tests/tools/page-real-host.spec.ts` checks two users in separate browser contexts and a second tab. It covers rename, Undo, a rejected stale save, a failed save, access loss, a stale resolve after a denial, and reload.

What it does not prove:

- The C# sidecar's live socket revocation in standalone mode. The spec runs with collaboration off.
- Persistence across devices or restarts. The host is in memory on one machine.
- Real authentication. The host trusts an `X-Dev-User` header.
- Access to page bodies. The playground still keeps bodies in each profile's `localStorage`.

## Importing page pointers

Notion clipboard page records can contain an ID and title without the page body. The V3 parser maps a subpage record to an ID-only owning `page` pointer, but the editor's singleton paste path can convert it to a non-owning link. Neither path imports the body or creates a host page. Do not treat the foreign ID as a local page until the host resolves an existing page or imports the body and remaps the ID. The host's `href` must not generate a local route for an unknown foreign ID. Do not create an empty host page merely because the pasted record has a title. If import is unavailable, the host may offer a link to the Notion page instead. A `page-link` remains non-owning and cannot create the target page.
