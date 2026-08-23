# @bloklabs/server

A small Go sidecar for [Blok](https://blokeditor.com). It answers the two requests a rich-text editor cannot make from the browser — storing an uploaded file, and reading the title/description/image of a pasted link — so you do not write a backend for either.

It stores no documents. There is no database, and nothing here is a hosted service you depend on: you run it.

## Run it

```bash
npx @bloklabs/server --listen 127.0.0.1:4000
```

The npm package is a wrapper. On first run it downloads the binary for your platform from the matching GitHub release, checks it against the release's `checksums.txt`, and caches it. If your network blocks that download, the container image is the same build:

```bash
docker run -p 4000:4000 ghcr.io/jackuait/blok-server --listen 0.0.0.0:4000
```

## Point the editor at it

```ts
import { Blok } from '@bloklabs/core';

new Blok({
  holder: 'editor',
  uploader: {
    async uploadByFile(file) {
      const body = new FormData();

      body.append('file', file);

      const res = await fetch('http://127.0.0.1:4000/upload', { method: 'POST', body });

      return res.json();
    },
  },
});
```

The response shapes match what Blok's own parsers already expect, so nothing on the editor side needs configuring beyond the URL.

## Routes

| Route | What it does |
| --- | --- |
| `GET /health` | Liveness plus the running version |
| `GET /unfurl?url=…` | Title, description and image for a pasted link |
| `POST /upload` | Stores an uploaded file, returns where it landed |
| `POST /upload-by-url` | Fetches a remote URL server-side and re-hosts it |

Both routes that fetch a URL the browser supplied go through one SSRF-guarded HTTP client, so a pasted `http://169.254.169.254/…` cannot reach your cloud metadata endpoint.

## Access modes

`--auth` picks who may call the service, and the process refuses to start on a combination that would leave it open:

- `none` — no check, and therefore only allowed to bind loopback.
- `proxy` — trusts every caller, for when something in front of it already authenticated them; loopback only for the same reason.
- `ticket` — each request carries a short-lived pass your app signs with the shared secret. The only mode allowed to bind a public address.

Storage is a local directory by default (`--storage-dir`), or any S3-compatible bucket via `--s3-bucket` and friends. Credentials are read from `BLOK_S3_ACCESS_KEY` / `BLOK_S3_SECRET_KEY` — never from flags, which land in process listings.

## Docs

Full flag reference and deployment notes: [https://blokeditor.com/docs](https://blokeditor.com/docs)
