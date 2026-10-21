import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { push } from '../src/commands/push.mjs';
import { runPull } from '../src/commands/pull.mjs';

// Root 1 → A (10), B (20) → C (30), D (40).
const TREE = { 1: [10, 20, 40], 10: [], 20: [30], 30: [], 40: [] };
const TITLES = { 1: 'Root', 10: 'A', 20: 'B', 30: 'C', 40: 'D' };

const page = id => ({
    id: String(id),
    type: 'page',
    title: TITLES[id],
    space: { key: 'S' },
    version: { number: 1, when: '2026-01-01' },
    body: { storage: { value: `<p>Body of ${TITLES[id]}</p>` } },
    _links: { webui: `/pages/${id}` },
});

/** Runs `fn` in a project holding `config`, against a fake Confluence; returns the requested paths and the log. */
async function withConfluence(config, files, fn) {
    const root = await mkdtemp(path.join(tmpdir(), 'cms-exclude-'));
    await writeFile(path.join(root, 'confluence-md-sync.config.mjs'), `export default ${JSON.stringify(config)};`);
    for (const [name, content] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(root, name)), { recursive: true });
        await writeFile(path.join(root, name), content);
    }

    const requested = [];
    const log = [];
    const saved = { fetch: globalThis.fetch, log: console.log, cwd: process.cwd(), env: { ...process.env } };
    Object.assign(process.env, {
        CONFLUENCE_BASE_URL: 'https://example.test/wiki',
        CONFLUENCE_EMAIL: 'me@example.test',
        CONFLUENCE_API_TOKEN: 'token',
    });
    globalThis.fetch = async url => {
        const { pathname } = new URL(url);
        requested.push(pathname);
        const [, id, kind] = pathname.match(/\/content\/(\d+)(?:\/child\/(\w+))?$/);
        const json =
            kind === 'page'
                ? { results: TREE[id].map(child => ({ id: String(child), title: TITLES[child] })) }
                : kind === 'attachment'
                  ? { results: [] }
                  : page(id);
        return new Response(JSON.stringify(json));
    };
    console.log = (...args) => log.push(args.join(' '));
    process.chdir(root);
    try {
        await fn(root);
    } finally {
        globalThis.fetch = saved.fetch;
        console.log = saved.log;
        process.chdir(saved.cwd);
        process.env = saved.env;
    }
    return { requested, log: log.join('\n') };
}

const fetchedPages = requested =>
    requested.map(pathname => pathname.match(/\/content\/(\d+)$/)?.[1]).filter(Boolean);

test('pull leaves an excluded page and its descendants out, without reporting them as orphans', async () => {
    let root;
    const { requested, log } = await withConfluence(
        { sources: [{ rootId: '1', outDir: 'docs', exclude: ['20', 'docs/d.md'] }] },
        // A file of the excluded subtree, from an earlier pull or written by hand.
        { 'docs/b/c.md': 'kept as is' },
        async dir => {
            root = dir;
            await runPull({ quiet: true });
        }
    );

    assert.deepEqual(fetchedPages(requested).sort(), ['1', '10']);
    assert.equal(existsSync(path.join(root, 'docs/a.md')), true);
    assert.equal(existsSync(path.join(root, 'docs/b/index.md')), false);
    assert.equal(existsSync(path.join(root, 'docs/d.md')), false);
    assert.equal(await readFile(path.join(root, 'docs/b/c.md'), 'utf8'), 'kept as is');

    const index = await readFile(path.join(root, 'docs/README.md'), 'utf8');
    assert.match(index, /\[A\]/);
    assert.doesNotMatch(index, /\[B\]|\[C\]|\[D\]/);
    assert.match(log, /2 excluded/);
    assert.doesNotMatch(log, /No matching Confluence page/);
});

test('push never fetches a page excluded by exclude, its descendants, or pushExclude', async () => {
    const file = (id, title) =>
        `---\ntitle: "${title}"\nconfluence_id: "${id}"\nversion: 1\n---\n\n# ${title}\n\nEdited locally.\n`;
    const { requested, log } = await withConfluence(
        { sources: [{ rootId: '1', outDir: 'docs', exclude: ['20'], pushExclude: ['docs/d.md'] }] },
        {
            'docs/a.md': file(10, 'A'),
            'docs/b/index.md': file(20, 'B'),
            'docs/b/c.md': file(30, 'C'),
            'docs/d.md': file(40, 'D'),
        },
        () => push(['--force'])
    );

    assert.deepEqual(fetchedPages(requested), ['10']);
    assert.match(log, /docs\/b\/c\.md — excluded in the config/);
    assert.match(log, /1 page\(s\) to publish/);
});
