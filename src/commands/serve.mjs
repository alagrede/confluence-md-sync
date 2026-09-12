// Local HTML preview of the mirrored markdown.
//
// The URL space mirrors the directory tree: /specs/home.md renders
// <serve root>/specs/home.md. Relative links and image paths inside the .md
// files therefore work as they are, with no rewriting.
//
// Nothing is generated on disk: files are read on every request, so a refresh
// is enough after an edit. No Confluence credentials are needed either — this
// is local file reading.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { parseArgs } from '../args.mjs';
import { loadConfig } from '../config.mjs';
import { markdownToHtml, readFrontmatter } from '../markdown/md-to-html.mjs';
import { mimeFor, resolveServedPath } from '../preview-files.mjs';
import { STYLE } from '../preview-style.mjs';

export const usage = `Usage: confluence-md-sync serve [options]

Serves the mirrored markdown as HTML on localhost. Needs no Confluence access.

Options:
  --port <n>   port to listen on (default from the config, else 4801;
               incremented if busy)
  --open       open the browser once listening
  --host <h>   interface to bind (default 127.0.0.1)
`;


function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export async function serve(argv) {
    const args = parseArgs(argv, { flags: ['--open'], options: ['--port', '--host'] });
    const config = await loadConfig();
    const root = config.serve.root;
    const host = args.options.host ?? '127.0.0.1';
    const basePort = args.options.port ? Number(args.options.port) : config.serve.port;

    if (!Number.isInteger(basePort) || basePort < 1 || basePort > 65535) {
        throw new Error(`--port expects a port number, got "${args.options.port}".`);
    }

    /** Absolute file path → the URL path it is served at. */
    const href = file => '/' + path.relative(root, file).split(path.sep).join('/');

    /**
     * Reading order for a mirror: the one in the index that `pull` regenerates,
     * which is Confluence's own tree order.
     * @returns {Promise<Map<string, {title: string, depth: number, rank: number}>>}
     */
    async function indexOrder(sourceDir) {
        const order = new Map();
        const indexPath = path.join(sourceDir, 'README.md');
        if (!existsSync(indexPath)) return order;
        const prefix = href(sourceDir);
        for (const line of (await readFile(indexPath, 'utf8')).split('\n')) {
            const match = line.match(/^(\s*)- \[([^\]]+)\]\(([^)]+\.md)\)/);
            if (!match) continue;
            order.set(path.posix.join(prefix, decodeURIComponent(match[3])), {
                title: match[2],
                depth: Math.floor(match[1].length / 2),
                rank: order.size,
            });
        }
        return order;
    }

    /** Every .md under a directory, excluding assets/ and README.md. */
    async function collectMarkdown(dir) {
        const found = [];
        if (!existsSync(dir)) return found;
        const scan = async current => {
            const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) =>
                a.name.localeCompare(b.name)
            );
            for (const entry of entries) {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== 'assets') await scan(full);
                    continue;
                }
                if (!entry.name.endsWith('.md') || entry.name === 'README.md') continue;
                found.push(full);
            }
        };
        await scan(dir);
        return found;
    }

    /**
     * Title of a page missing from the index: its frontmatter title, else its
     * first level-1 heading (hand-written pages carry no frontmatter), else the
     * file name.
     */
    async function titleOf(file) {
        try {
            const source = await readFile(file, 'utf8');
            const { title } = readFrontmatter(source);
            if (title) return title;
            const heading = markdownToHtml(source).headings.find(item => item.level === 1);
            if (heading) return heading.text;
        } catch {
            /* unreadable: fall back to the file name */
        }
        const base = path.basename(file, '.md');
        return base === 'index' ? path.basename(path.dirname(file)) : base;
    }

    /**
     * The directory is the source of truth; the index only supplies order and
     * titles. A file missing from the index — a page added in Confluence since
     * the last pull, or a stale index — stays visible, slotted right after its
     * siblings rather than at the end of the list where it would look like the
     * child of some other page.
     */
    async function mirrorSection(sourceDir) {
        const order = await indexOrder(sourceDir);
        const files = await collectMarkdown(sourceDir);

        // Rank of the last known entry in each directory, to hang unknowns off.
        const lastRankByDir = new Map();
        for (const [url, entry] of order) {
            const dir = path.posix.dirname(url);
            lastRankByDir.set(dir, Math.max(lastRankByDir.get(dir) ?? -1, entry.rank));
        }

        const items = [];
        const offsets = new Map();
        for (const file of files) {
            const url = href(file);
            const known = order.get(url);
            if (known) {
                items.push({ href: url, title: known.title, depth: known.depth, rank: known.rank });
                continue;
            }
            const dir = path.posix.dirname(url);
            const anchorRank = lastRankByDir.get(dir);
            const offset = (offsets.get(dir) ?? 0) + 1;
            offsets.set(dir, offset);
            items.push({
                href: url,
                title: await titleOf(file),
                depth: path.relative(sourceDir, file).split(path.sep).length - 1,
                // A fractional rank slides the page behind its siblings without
                // renumbering the rest. With no known sibling it goes last.
                rank: anchorRank === undefined ? Number.MAX_SAFE_INTEGER : anchorRank + offset / 1000,
            });
        }

        items.sort((a, b) => a.rank - b.rank || a.href.localeCompare(b.href));
        return items;
    }

    async function buildNav() {
        const sections = [];

        const landing = path.join(root, 'README.md');
        if (existsSync(landing)) {
            sections.push({
                label: null,
                items: [{ depth: 0, title: config.serve.title, href: href(landing) }],
            });
        }

        for (const source of config.sources) {
            const items = await mirrorSection(source.outDir);
            const index = path.join(source.outDir, 'README.md');
            sections.push({
                label: source.label,
                items: [
                    ...(existsSync(index) ? [{ depth: 0, title: 'Index', href: href(index) }] : []),
                    ...items,
                ],
            });
        }

        // Extra directories of hand-written markdown, declared in the config.
        // Skipped when the directory is absent, so a stale entry leaves no dead
        // link in the sidebar.
        for (const section of config.serve.sections) {
            if (!existsSync(section.dir)) continue;
            const index = path.join(section.dir, 'README.md');
            const items = [];
            if (existsSync(index)) items.push({ depth: 0, title: 'Overview', href: href(index) });
            for (const file of await collectMarkdown(section.dir)) {
                items.push({ depth: 0, title: await titleOf(file), href: href(file) });
            }
            if (items.length) sections.push({ label: section.label, items });
        }

        return sections;
    }

    function renderNav(nav, currentPath) {
        return nav
            .map(section => {
                const title = section.label ? `<h1>${escapeHtml(section.label)}</h1>` : '';
                const links = section.items
                    .map(item => {
                        const active = item.href === currentPath ? ' current' : '';
                        const depth = Math.min(item.depth, 3);
                        return `<a class="depth-${depth}${active}" href="${item.href}">${escapeHtml(
                            item.title
                        )}</a>`;
                    })
                    .join('');
                return title + links;
            })
            .join('');
    }

    function renderShell({ title, nav, currentPath, meta, toc, body }) {
        return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} — ${escapeHtml(config.serve.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<nav>${renderNav(nav, currentPath)}</nav>
<main><article>${meta}${toc}${body}</article></main>
</body>
</html>`;
    }

    function renderMeta(frontmatter) {
        const bits = [];
        if (frontmatter.confluence_url) {
            bits.push(`<span><a href="${escapeHtml(frontmatter.confluence_url)}">View in Confluence ↗</a></span>`);
        }
        if (frontmatter.version) bits.push(`<span>version ${escapeHtml(frontmatter.version)}</span>`);
        if (frontmatter.updated) bits.push(`<span>updated ${escapeHtml(frontmatter.updated.slice(0, 10))}</span>`);
        return bits.length ? `<div class="meta">${bits.join('')}</div>` : '';
    }

    function renderToc(headings) {
        const items = headings.filter(item => item.level === 2);
        if (items.length < 4) return '';
        const links = items.map(item => `<li><a href="#${item.id}">${escapeHtml(item.text)}</a></li>`).join('');
        return `<div class="toc"><strong>On this page</strong><ul>${links}</ul></div>`;
    }

    const server = createServer(async (request, response) => {
        try {
            await handle(request, response);
        } catch (error) {
            response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end(`Preview server error: ${error.message}`);
        }
    });

    async function handle(request, response) {
        const urlPath = request.url === '/' ? '/README.md' : request.url;
        const target = resolveServedPath(root, urlPath);

        if (!target) {
            response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Refused: outside the served directory, or a dotted path segment.');
            return;
        }

        const nav = await buildNav();

        let info = null;
        try {
            info = await stat(target);
        } catch {
            /* missing: handled just below */
        }

        if (info?.isDirectory()) {
            const index = path.join(target, 'README.md');
            if (existsSync(index)) {
                response.writeHead(302, { Location: href(index) });
                response.end();
                return;
            }
            info = null;
        }

        if (!info) {
            const currentPath = urlPath.split('?')[0];
            response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(
                renderShell({
                    title: 'Not found',
                    nav,
                    currentPath,
                    meta: '',
                    toc: '',
                    body:
                        `<h1>Not found</h1><p class="notfound"><code>${escapeHtml(currentPath)}</code> ` +
                        `matches no file under <code>${escapeHtml(path.basename(root))}/</code>.</p>`,
                })
            );
            return;
        }

        if (!target.endsWith('.md')) {
            const mime = mimeFor(target);
            // Refused rather than octet-streamed: see the allowlist's comment.
            if (!mime) {
                response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                response.end('Not a previewable file type.');
                return;
            }
            response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
            response.end(await readFile(target));
            return;
        }

        const source = await readFile(target, 'utf8');
        const frontmatter = readFrontmatter(source);
        const { html, headings } = markdownToHtml(source);

        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        response.end(
            renderShell({
                title: frontmatter.title || headings[0]?.text || path.basename(target),
                nav,
                currentPath: href(target),
                meta: renderMeta(frontmatter),
                toc: renderToc(headings),
                body: html,
            })
        );
    }

    /** Takes the first free port at or above the requested one. */
    function listen(port, attemptsLeft = 10) {
        server.once('error', error => {
            if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
                console.log(`Port ${port} is busy, trying ${port + 1}…`);
                listen(port + 1, attemptsLeft - 1);
                return;
            }
            console.error(error.message);
            process.exit(1);
        });
        server.listen(port, host, () => {
            const url = `http://${host}:${port}/`;
            console.log(`\nServing ${root}\n  → ${url}\n`);
            if (root === config.root) {
                // Only reachable with mirrors in unrelated trees. Dotted paths
                // and the type allowlist still apply, but it is worth saying.
                console.log(
                    'Note: this is the whole project directory, because the mirrors share\n' +
                        '      no closer parent. Set `serve.root` in the config to narrow it.\n'
                );
            }
            console.log('Ctrl+C to stop.');
            if (args.has('--open')) {
                const opener =
                    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
                spawn(opener, [url], { stdio: 'ignore', detached: true }).unref();
            }
        });
    }

    listen(basePort);
}
