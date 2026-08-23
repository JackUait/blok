# Security Policy

Thank you for looking. This page says where to send a vulnerability, how quickly
you will hear back, and which versions get a fix.

## Reporting a vulnerability

Report it privately, through GitHub:

**[Open a private report on `JackUait/blok`](https://github.com/JackUait/blok/security/advisories/new)**
— on the repository, that is *Security → Advisories → Report a vulnerability*.

Please do **not** open a public issue, a discussion, or a pull request for a
security problem. A public report is readable by everyone the moment you press
send, including people running the affected code.

Helpful things to include, as far as you have them:

- what an attacker can do, in one sentence
- the smallest steps that reproduce it
- the version or commit you tested
- for the service: the `--auth` mode and whether it was reachable from the
  internet

If you have a fix in mind, say so in the report. Do not open a pull request for
it — a pull request is public and describes the hole before it is patched.

## What happens next

| | |
| --- | --- |
| You get an acknowledgement | within **5 business days** |
| A fix is released, or a public advisory is published | within **90 days** of that acknowledgement |

If a fix is going to take longer than 90 days, the advisory is published anyway,
with whatever mitigation is available at the time. Silence past the window is
not an outcome we will use.

We will keep you updated as it moves, credit you in the advisory unless you would
rather we did not, and let you know before anything is published.

We ask the same in return: please give us the 90 days before you publish, and do
not test against anyone else's live deployment.

## Supported versions

Blok ships as one family — the editor, the framework adapters, the presets and
the server all carry the same version number and are released together.

**Only the current version receives fixes.** There are no long-term support
branches and no backports to older lines. If you are behind, upgrading to the
current version is the fix.

The current version is on the [releases
page](https://github.com/JackUait/blok/releases).

## Turning link previews off immediately

Nearly every server-side risk in this project lives in one feature: link
previews. To build a preview card, `blok-server` fetches the URL a user pasted.
That is the one place where something a user typed causes the server to make a
request of its own.

So there is a switch for it, and it does not wait for a release:

```bash
blok-server --no-unfurl
```

Restart with that flag and the preview route is not merely refused — it is not
registered at all, so nothing on the fetching path can be reached. Uploads keep
working. Nothing in your own app changes, and you do not redeploy it. Pasted
links keep working too: with no preview available, the block renders as a plain
link showing the domain, which is the same thing it does for the many sites that
serve no preview data.

This is the first thing to do on hearing about a preview-related problem, and the
thing you can undo by removing the flag once a fixed version is out.

## What is in scope

- `@bloklabs/core` and the framework adapters
- `@bloklabs/presets`
- `blok-server` (`packages/server/`) and its container image
- the documentation site, `blokeditor.com`

Out of scope: findings that need an attacker to already control the machine or
the browser profile, reports produced by a scanner with no working
reproduction, and anything about a third-party service Blok merely talks to
(report those to that service).
