# confluence-md-sync

Mirror Confluence pages as markdown, read them in your browser, and publish
your edits back.

Confluence is where the rest of the company reads documentation. Markdown in
git is where it can be diffed, reviewed in a pull request, and read by tooling.
This keeps both, in both directions:

```
Confluence  ──  pull  ──▶  docs/specs/*.md  ──▶  serve  (localhost preview)
                                  │
                push ◀────────────┘   (after you edit a file)
```

**Node ≥ 18, and zero dependencies** — the code imports only `node:*` builtins
and the global `fetch`. Nothing to audit, nothing to keep up to date.

## Quickstart

From nothing to reading your Confluence docs in git:

```sh
npm install --save-dev @alagrede/confluence-md-sync
npx confluence-md-sync init          # writes confluence-md-sync.config.mjs
```

Then two things to fill in, both explained below:

1. your `rootId` in `confluence-md-sync.config.mjs` — [What gets synced](#2-what-gets-synced);
2. your credentials in `~/.config/confluence-md-sync/env` — [Credentials](#1-credentials).

```sh
npx confluence-md-sync pull --dry-run    # safe: GETs only, writes nothing
npx confluence-md-sync pull              # write the mirror
npx confluence-md-sync serve --open      # read it in the browser
git add docs/ && git commit -m "Mirror Confluence specs"
```

That last step is the point of the whole tool: the mirror belongs in git, so
from now on every Confluence edit arrives as a reviewable `git diff`.

## Install

```sh
npm install --save-dev @alagrede/confluence-md-sync
# or:  yarn add -D @alagrede/confluence-md-sync
```

> **Mind the scope.** The unscoped `confluence-md-sync` on npm is an unrelated
> project by another author. This one is `@alagrede/confluence-md-sync`. The
> command it installs is still called `confluence-md-sync`.

Straight from git works too, if you would rather track the default branch:

```sh
npm install --save-dev git+https://github.com/alagrede/confluence-md-sync.git
```

To hack on it instead of consuming it:

```sh
git clone https://github.com/alagrede/confluence-md-sync.git
cd confluence-md-sync && npm test      # no install step: there are no deps
```

### The four commands

| Command | What it does |
| --- | --- |
| `init` | write a starter config file in the current directory |
| `pull` | replace the local mirror with Confluence's current state |
| `push` | publish edited mirror files back to their Confluence pages |
| `serve` | browse the mirror as HTML on localhost, with no credentials |

`confluence-md-sync --help` lists them; `confluence-md-sync <command> --help`
gives one command's options. `--version` prints the version.

Wiring them into your `package.json` is what makes them habitual:

```json
{
    "scripts": {
        "docs:pull": "confluence-md-sync pull",
        "docs:push": "confluence-md-sync push",
        "docs:serve": "confluence-md-sync serve"
    }
}
```

The rest of this README uses the `yarn docs:*` form.

## Configure

### 1. Credentials

Three environment variables:

```sh
CONFLUENCE_BASE_URL=https://your-org.atlassian.net/wiki
CONFLUENCE_EMAIL=you@example.com
CONFLUENCE_API_TOKEN=…
```

Create the token at
<https://id.atlassian.com/manage-profile/security/api-tokens>. It is a
*personal* token: it carries your own rights, so `push` can only write to pages
you can already edit.

They are looked up in this order, first value found wins:

1. variables already exported in the shell;
2. the file named by `$CONFLUENCE_MD_SYNC_ENV`;
3. `./.env` at the project root;
4. `~/.config/confluence-md-sync/env`.

Option 4 keeps the token out of the repository entirely, which is the safest
default:

```sh
mkdir -p ~/.config/confluence-md-sync
cat >> ~/.config/confluence-md-sync/env <<'EOF'
CONFLUENCE_BASE_URL=https://your-org.atlassian.net/wiki
CONFLUENCE_EMAIL=you@example.com
CONFLUENCE_API_TOKEN=your-token
EOF
```

If you use `./.env` instead, **make sure `.env` is in your `.gitignore` first.**
A missing variable stops the command with the name of the one that is missing
and an example, before writing anything.

### 2. What gets synced

`confluence-md-sync.config.mjs` at the root of your project:

```js
export default {
    sources: [
        {
            rootId: '1845363038',
            outDir: 'docs/specs',
            label: 'Specifications',
        },
    ],
};
```

`rootId` is the id of the page or folder you want to mirror, read straight out
of its Confluence URL — either shape works:

```
…/spaces/HANDBOOK/folder/1845363038        → rootId: '1845363038'
…/spaces/HANDBOOK/pages/1845363038/Home    → rootId: '1845363038'
```

The root is **not** written as a page itself: its children become the mirror,
and the root supplies the title and link of the generated `README.md` index.
So point it at the parent of what you want, not at a leaf. Following one more
tree means adding one more entry to `sources`.

Paths in the config are resolved **against the config file**, not against your
shell's working directory, and the file is what marks the project root. So the
commands behave identically from anywhere in the repository — and they find the
config by walking up from wherever you ran them.

See [`examples/confluence-md-sync.config.mjs`](examples/confluence-md-sync.config.mjs)
for every option, including the preview server's.

## One directory, two directions

`outDir` is the **mirror of Confluence**. `pull` replaces it wholesale, and it
is also the starting point for `push` when you fix a page from the repository.

**The consequence worth internalising: nothing hand-written in the mirror
survives a `pull`.** A correction is only safe once published. So the cycle is
`pull`, edit, `push --apply`, `pull`.

Content that must *not* go to Confluence — working notes, a gap analysis —
does not belong in `outDir`. Put it elsewhere in the repository (and show it in
the preview server with `serve.sections`), or in a ticket.

## Read the docs in your browser

```sh
yarn docs:serve                 # http://127.0.0.1:4801
yarn docs:serve --open          # …and open the browser
yarn docs:serve --port 5000     # another port (incremented if busy)
yarn docs:serve --host 0.0.0.0  # expose on the network (see the note below)
```

A local server renders the `.md` files as HTML: a sidebar listing every
section, tables, screenshots, a per-page table of contents, and a link back to
the Confluence page with its version number. Light and dark follow the reader's
system setting.

Nothing is generated on disk and there are no build artifacts to ignore — files
are read on every request, so refreshing is enough after an edit.

The URL space mirrors the directory tree: `/specs/home.md` renders
`docs/specs/home.md`. Relative links between documents and image paths
therefore work as they are, with no rewriting.

The server binds `127.0.0.1` only, and serves three kinds of thing and nothing
else: markdown rendered to HTML, files whose extension is on a fixed asset
allowlist (images, PDF, Office documents, CSS, JSON, txt, csv), and nothing at all otherwise —
an unknown extension is a 404 rather than an `application/octet-stream`
download. Paths escaping the served root are refused, as is any path with a
dotted segment, so `.env` and `.git/` stay unreachable even when the root is
wider than the mirror (see `serve.root` in the example config).

It needs **no Confluence access**: this is local file reading. The credentials
above concern `pull` and `push` only — which makes `serve` the thing to hand to
a teammate who just wants to read.

`--host 0.0.0.0` makes it reachable from the network. There is no
authentication of any kind, so use it for a quick demo on a trusted network and
nothing more.

## Pull pages from Confluence

```sh
yarn docs:pull                  # replace the mirror with Confluence's state
yarn docs:pull --only home      # only rewrite paths containing "home"
yarn docs:pull --dry-run        # say what would change, write nothing
yarn docs:pull --force-assets   # re-download attachments already present
yarn docs:pull --quiet          # list only the files that changed
```

| Option | Effect |
| --- | --- |
| `--only <pattern>` | only rewrite files whose path contains `<pattern>` |
| `--dry-run` | write nothing, report what would change |
| `--force-assets` | re-download attachments already present |
| `--quiet` | list only the files that changed |

A run looks like this:

```
Room management (HANDBOOK) → docs/specs

   +  docs/specs/home.md
   ~  docs/specs/booking/index.md
   =  docs/specs/booking/rules.md
   +  docs/specs/README.md

2 created, 1 updated, 1 unchanged, 7 attachment(s) downloaded.
```

`+` created, `~` updated, `=` unchanged, `·` skipped by `--only`.

`pull` is **read-only on Confluence**: it only ever issues `GET` requests, so
it is safe to run.

It walks the tree down from `rootId`, converts each page to markdown,
downloads the referenced attachments, and writes a file only when it actually
changed. Images become `![](…)`; other attached files (PDF, spreadsheets,
documents…), whether linked in the text or embedded with a file preview macro,
become ordinary links `[label](assets/…)` to the downloaded copy. Run it twice in a row and everything is reported unchanged.

**Naming.** A page **with** children becomes `<slug>/index.md`, its attachments
in `<slug>/assets/`. A page **without** children becomes `<slug>.md`, its
attachments in `assets/<slug>/`. The slug comes from the title — so a renamed page, or one
that gains its first child, **changes path**.

**Nothing is ever deleted.** Files that no longer match any page are listed at
the end of the run, for you to review and then `git rm`. Same for attachments
the script could not resolve.

### Updating one page at a time

`--only <pattern>` limits rewriting to files whose path contains the pattern —
the same filter as on `push`, so `--only home` targets `docs/specs/home.md`.
Useful when unpublished corrections live in the mirror: they must not be
overwritten, but you still want to fetch a page someone added in Confluence.

```sh
yarn docs:pull --only summary --dry-run   # check the scope
yarn docs:pull --only summary             # rewrite only that one
```

Skipped pages are marked `·  (outside --only)` in the report and counted
separately. They are **not** flagged as orphans.

**The `README.md` index is always regenerated**, even with `--only`: the whole
Confluence tree is walked in every case, only writing is filtered. That is what
puts the preview server's sidebar back in the right order after a page is
added.

The index describes the **local mirror**: a page that exists in Confluence but
that `--only` skipped and that was never pulled does not appear in it,
otherwise it would link to a file that is not there.

## Publish a corrected page back

The use case: a review says a page states something false, you fix the `.md` in
the mirror, you publish.

```sh
# 1. start from an up-to-date mirror
yarn docs:pull

# 2. edit docs/specs/…/the-page.md

# 3. see what would be published — dry run by default
yarn docs:push --only the-page

# 4. publish
yarn docs:push --only the-page --apply

# 5. refresh the version numbers in the frontmatter
yarn docs:pull
```

| Option | Effect |
| --- | --- |
| *(default)* | dry run: says what would be published |
| `--apply` | actually publish |
| `--only <pattern>` | only handle files whose path contains `<pattern>` |
| `--force` | override the version and modification guards |
| `--print` | print the generated storage format |

### What `push` replaces, and the three guards

`push` **replaces the page body** with the rendered markdown. This is not a
merge: whatever the page held in macros, layouts or column widths is lost — the
markdown export does not carry it.

Hence three refusals, all overridable with `--force`:

1. **Dry run by default.** `--apply` is required to write.
2. **Version gap.** If the page moved in Confluence since your `pull`, that
   page is refused (exit code `2`): run `pull` first, or you would overwrite
   someone else's work.
3. **No local modification.** A page whose text is identical to Confluence's is
   skipped. Without this check, a repository-wide `push --apply` would flatten
   the formatting of every page nobody had touched.

Guard 3 compares the text with images excluded and links to attached files
reduced to their label: in the file they are asset paths, on the page they are
attachment references, so only the prose is comparable. Adding an image without changing a word is therefore not seen as a
modification — use `--force` in that case.

Images and linked files already attached to the page are reused by name; those
added locally are uploaded as attachments before publishing. A link to a local
file becomes an attachment link — a file preview macro comes back as a plain
link, like every other macro the markdown does not carry.

The mirror's `README.md` is not a Confluence page: `push` ignores it.

## Troubleshooting

| Message | What it means |
| --- | --- |
| `Missing environment variable(s): …` | credentials not found — the message lists every file it looked in |
| `HTTP 401` or `HTTP 403` | wrong email/token pair, or no access to that space |
| `HTTP 404` on the rootId | wrong id, or an id from a different site than `CONFLUENCE_BASE_URL` |
| `rootId` is still the placeholder | `init` ran, but the config was never filled in |
| `No confluence-md-sync.config.mjs found` | run from outside the project, or `init` never ran |
| Mirror contains only `README.md` | the root has no child pages — you pointed at a leaf |
| `Unknown option: --dry-runn` | a typo, refused rather than ignored; `push` would otherwise have published |
| `push` exits with code `2` | a guard blocked at least one page; the report above says which |
| `Port 4801 is busy, trying 4802…` | normal, it walks up to the next free port |

## Accepted limits

- **storage → markdown loses information**: macros, layouts, column widths.
  Enough to read and to review, not enough to rebuild the page identically —
  which is exactly why guard 3 exists.
- **markdown → storage covers** headings, paragraphs, fenced code blocks,
  lists (2 levels), tables, images, bold, italics, inline code, links and
  horizontal rules. Anything else comes out as escaped text rather than being
  silently dropped — visible in the `push` dry run, and fixable, instead of
  vanishing.
- **Blockquotes are one-way.** Confluence's `info` / `note` / `warning` panels
  pull as blockquotes, but markdown → storage has no blockquote case, so
  pushing one back produces a paragraph starting with a literal `>`:

  ```
  panel in Confluence   →   > **INFO** Mind the delay          (pull)
  that line             →   <p>&gt; <strong>INFO</strong> …    (push)
  ```

  So: editing the prose *around* a panel is fine, but a page whose panels you
  care about is better corrected in Confluence directly. Guard 3 is what stops
  this happening to pages you never touched.
- **A space may appear next to bold or italics.** Confluence has no delimiters,
  so `<strong>Document applicable:</strong>Ce document` is an ordinary page —
  but `**Document applicable:**Ce document` is *plain text* to every markdown
  reader: a closing `**` preceded by punctuation and followed by a letter
  cannot close anything (CommonMark's flanking rules). The pull inserts the one
  space that makes it render, and moves a space that sat inside the markers
  outside them. Prose asterisks are left alone — `3 * 4 * 5` never becomes an
  italic.
- **No automatic deletion, in either direction.** A page deleted in Confluence
  leaves its file behind; a file deleted here does not delete the page.
- **Confluence Cloud REST v1.** Not tested against Confluence Server /
  Data Center.

## Use the converters as a library

The two converters are pure, dependency-free functions over strings, usable
without the CLI — for a CI check that a page round-trips, a one-off migration,
or a bot that posts markdown to Confluence:

```js
import { storageToMarkdown, markdownToStorage } from '@alagrede/confluence-md-sync';

const { markdown, imageRefs, fileRefs } = storageToMarkdown(page.body.storage.value);
const storage = markdownToStorage('## Scope\n\nA **bold** claim.');
```

`storageToMarkdown` returns the markdown with `@@CIMGn@@` tokens where images
were and `@@CFILEn@@` tokens where other attachments were, plus the matching
`imageRefs` and `fileRefs` — so the caller decides where the files go.
`markdownToStorage` takes two resolver callbacks: one maps a markdown image path
to an attachment name, the other does the same for a link target.

See [`src/index.mjs`](src/index.mjs) for the full surface.

## Layout

```
bin/cli.mjs                    entry point, subcommand dispatch
src/config.mjs                 config discovery, path resolution
src/env.mjs                    credential lookup
src/args.mjs                   argument parsing (rejects what it doesn't know)
src/commands/pull.mjs          walk the tree, convert, write
src/commands/push.mjs          publish a mirror file back
src/commands/serve.mjs         HTML preview server
src/commands/init.mjs          starter config
src/confluence/client.mjs      minimal Confluence client (auth, GET, attachments, update)
src/confluence/storage-to-md.mjs   Confluence → markdown
src/confluence/md-to-storage.mjs   markdown → Confluence
src/markdown/md-to-html.mjs    markdown → HTML, for the browser
src/markdown/markdown-file.mjs frontmatter and body
src/markdown/slug.mjs          file names derived from titles
src/preview-files.mjs          what the preview server may serve, and as what
src/preview-style.mjs          the preview server's stylesheet
test/                          node:test suites, no framework
```

## Contributing

```sh
npm test          # node --test, no test framework
```

The converters carry the risk in this project, so they carry the tests: 79 of
them, over entities, nested lists, tables, macros, image tokenisation, path
refusals, and a markdown → storage → markdown round trip.

## License

MIT
