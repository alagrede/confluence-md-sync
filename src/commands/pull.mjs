// Confluence → local markdown. The output directory is a mirror: every page is
// rewritten to match Confluence, and referenced attachments are downloaded into the
// neighbouring assets/ folders. Nothing hand-written in the mirror survives a
// pull — changes that should last are published with `push`.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../args.mjs';
import { assertSyncable, loadConfig } from '../config.mjs';
import { ConfluenceClient } from '../confluence/client.mjs';
import { storageToMarkdown, isolateImages } from '../confluence/storage-to-md.mjs';
import { renderMarkdownFile, quoteYaml } from '../markdown/markdown-file.mjs';
import { slug, safeFilename, encodePath } from '../markdown/slug.mjs';

export const usage = `Usage: confluence-md-sync pull [options]

Replaces the mirror with the current state of Confluence. Read-only on
Confluence — it only ever issues GET requests.

Options:
  --only <pattern>   only rewrite files whose path contains <pattern>
  --dry-run          write nothing, report what would change
  --force-assets     re-download attachments that are already present
  --quiet            list only the files that changed
`;

/** Relative to the project root, for readable log lines. */
const display = (config, file) => path.relative(config.root, file) || '.';

export async function pull(argv) {
    const args = parseArgs(argv, {
        flags: ['--dry-run', '--force-assets', '--quiet'],
        options: ['--only'],
    });
    await runPull({
        dryRun: args.has('--dry-run'),
        forceAssets: args.has('--force-assets'),
        quiet: args.has('--quiet'),
        only: args.options.only ?? null,
    });
}

/**
 * The pull itself, also run by `push` to refresh what it just published.
 * `pageIds`, when given, restricts writing to those pages the same way `--only`
 * restricts it to matching paths: the tree is still walked in full.
 */
export async function runPull({ dryRun = false, forceAssets = false, quiet = false, only = null, pageIds = null } = {}) {
    const config = await loadConfig();
    assertSyncable(config);
    const client = new ConfluenceClient({ cwd: config.root });

    const stats = { created: 0, updated: 0, unchanged: 0, skipped: 0, assets: 0, missing: [] };
    const selected = (mdPath, page) => (!only || mdPath.includes(only)) && (!pageIds || pageIds.has(String(page.id)));
    const seenFiles = new Set();

    const attachmentsByPage = new Map();
    async function attachmentsOf(pageId) {
        if (!attachmentsByPage.has(pageId)) {
            const map = new Map();
            for (const attachment of await client.getAttachments(pageId)) map.set(attachment.title, attachment);
            attachmentsByPage.set(pageId, map);
        }
        return attachmentsByPage.get(pageId);
    }

    /**
     * Resolves the `@@CIMGn@@` and `@@CFILEn@@` tokens: downloads each
     * referenced attachment and replaces the token with a markdown image or
     * link relative to the file.
     */
    async function resolveAttachments(markdown, { imageRefs, fileRefs }, page, mdPath, assetsDir) {
        let out = markdown;
        const own = await attachmentsOf(page.id);
        const written = new Map();

        /** Downloads the attachment once per page; null when it cannot be found. */
        async function localPath(ref) {
            if (written.has(ref.filename)) return written.get(ref.filename);
            let attachment = own.get(ref.filename);
            if (!attachment && ref.pageTitle) {
                // Attached to a different page than the one showing it.
                const other = await client.findPageByTitle(page.space?.key, ref.pageTitle);
                if (other?.id) attachment = (await attachmentsOf(other.id)).get(ref.filename);
            }
            if (!attachment) return null;

            const target = path.join(assetsDir, safeFilename(ref.filename));
            if (forceAssets || !existsSync(target)) {
                if (!dryRun) {
                    await mkdir(assetsDir, { recursive: true });
                    await writeFile(target, await client.download(attachment._links.download));
                }
                stats.assets++;
            }
            const relative = encodePath(path.relative(path.dirname(mdPath), target));
            written.set(ref.filename, relative);
            return relative;
        }

        for (let index = 0; index < imageRefs.length; index++) {
            const ref = imageRefs[index];
            const token = `@@CIMG${index}@@`;
            if (!out.includes(token)) continue; // image swallowed by a dropped macro

            if (ref.externalUrl) {
                out = out.replace(token, `![${ref.alt || 'image'}](${ref.externalUrl})`);
                continue;
            }
            const relative = await localPath(ref);
            if (!relative) {
                stats.missing.push(`${page.title} → ${ref.filename}`);
                out = out.replace(token, `_[missing image: ${ref.filename}]_`);
                continue;
            }
            const alt = (ref.alt || ref.filename).replace(/\.(png|jpe?g|gif|svg|webp|bmp)$/i, '');
            out = out.replace(token, `![${alt}](${relative})`);
        }

        for (let index = 0; index < fileRefs.length; index++) {
            const ref = fileRefs[index];
            const token = `@@CFILE${index}@@`;
            if (!out.includes(token)) continue;

            const relative = await localPath(ref);
            if (!relative) {
                stats.missing.push(`${page.title} → ${ref.filename}`);
                out = out.replace(token, `_[missing file: ${ref.filename}]_`);
                continue;
            }
            out = out.replace(token, `[${ref.label || ref.filename}](${relative})`);
        }
        return out;
    }

    /** Writes the file, reporting whether it changed. */
    async function writePage(mdPath, page, body) {
        seenFiles.add(mdPath);
        const existing = existsSync(mdPath) ? await readFile(mdPath, 'utf8') : null;

        const content = renderMarkdownFile({
            frontmatter: {
                title: quoteYaml(page.title),
                confluence_id: quoteYaml(page.id),
                confluence_url: `${client.baseUrl}${page._links?.webui ?? ''}`,
                space: page.space?.key ?? '?',
                version: page.version?.number ?? '?',
                updated: page.version?.when ?? '?',
            },
            body: `# ${page.title}\n\n${body}`,
        });

        if (existing === content) {
            stats.unchanged++;
            if (!quiet) console.log(`   =  ${display(config, mdPath)}`);
            return;
        }
        if (!dryRun) {
            await mkdir(path.dirname(mdPath), { recursive: true });
            await writeFile(mdPath, content, 'utf8');
        }
        if (existing === null) {
            stats.created++;
            console.log(`   +  ${display(config, mdPath)}`);
        } else {
            stats.updated++;
            console.log(`   ~  ${display(config, mdPath)}`);
        }
    }

    const index = [];

    async function walk(parentId, dir, depth, outDir) {
        for (const child of await client.getChildren(parentId)) {
            const page = await client.getPage(child.id);
            const grandChildren = await client.getChildren(child.id);
            const name = slug(page.title);
            const hasChildren = grandChildren.length > 0;
            const mdPath = hasChildren ? path.join(dir, name, 'index.md') : path.join(dir, `${name}.md`);
            const assetsDir = hasChildren ? path.join(dir, name, 'assets') : path.join(dir, 'assets', name);

            // The conversion is local and costs no network call, so we always run
            // it: it yields the image count used by the index. Only writing the
            // file and downloading attachments are subject to --only.
            const converted = storageToMarkdown(page.body?.storage?.value ?? '');
            const { markdown, imageRefs, fileRefs } = converted;

            if (selected(mdPath, page)) {
                const body = isolateImages(await resolveAttachments(markdown, converted, page, mdPath, assetsDir));
                await writePage(mdPath, page, body);
            } else {
                // Outside the pattern: mark it seen so it is not reported as orphaned.
                seenFiles.add(mdPath);
                stats.skipped++;
                if (!quiet) console.log(`   ·  ${display(config, mdPath)}   (outside ${only ? '--only' : 'the selection'})`);
            }

            // The index describes the mirror: a page that --only skipped and that
            // was never pulled is left out, otherwise it would link nowhere.
            if (existsSync(mdPath) || (!dryRun && selected(mdPath, page))) {
                index.push({
                    depth,
                    title: page.title,
                    relative: encodePath(path.relative(outDir, mdPath)),
                    url: `${client.baseUrl}${page._links?.webui ?? ''}`,
                    images: imageRefs.length,
                    files: fileRefs.length,
                });
            }

            if (hasChildren) await walk(child.id, path.join(dir, name), depth + 1, outDir);
        }
    }

    async function writeIndex(root, outDir) {
        const mdPath = path.join(outDir, 'README.md');
        const rootUrl = `${client.baseUrl}${root._links?.webui ?? ''}`;
        const body = [
            `Markdown export of the Confluence pages under [${root.title}](${rootUrl})` +
                `${root.space?.key ? ` (space ${root.space.key})` : ''}, in Confluence's own tree order. ` +
                `Screenshots, mockups and attached files are downloaded into the \`assets/\` folders.`,
            '',
            'Regenerated by `confluence-md-sync pull`. Edits made here do not survive the next pull.',
            '',
            ...index.map(
                entry =>
                    `${'  '.repeat(entry.depth)}- [${entry.title}](${entry.relative}) — ${entry.images} image(s)` +
                    `${entry.files ? `, ${entry.files} file(s)` : ''} — [Confluence](${entry.url})`
            ),
        ].join('\n');

        await writePage(mdPath, root, body);
    }

    for (const source of config.sources) {
        const root = await client.getPage(source.rootId);
        console.log(
            `\n${root.title}${root.space?.key ? ` (${root.space.key})` : ''} → ` +
                `${display(config, source.outDir)}${dryRun ? '   [dry run]' : ''}\n`
        );
        index.length = 0;
        await walk(source.rootId, source.outDir, 0, source.outDir);
        await writeIndex(root, source.outDir);
    }

    console.log(
        `\n${stats.created} created, ${stats.updated} updated, ${stats.unchanged} unchanged` +
            (only || pageIds ? `, ${stats.skipped} outside the ${only ? 'pattern' : 'selection'}` : '') +
            `, ${stats.assets} attachment(s) downloaded.`
    );
    if (only) console.log(`--only pattern: "${only}". The index README.md was regenerated for the whole mirror.`);
    if (stats.missing.length) {
        console.log(`\nUnresolved attachments:\n  ${stats.missing.join('\n  ')}`);
    }

    // .md files that no longer match any page. Nothing is deleted; they are
    // only reported, so the removal stays a reviewed `git rm`.
    const orphans = [];
    for (const source of config.sources) {
        if (!existsSync(source.outDir)) continue;
        const scan = async dir => {
            for (const entry of await readdir(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== 'assets') await scan(full);
                } else if (entry.name.endsWith('.md') && !seenFiles.has(full)) {
                    orphans.push(display(config, full));
                }
            }
        };
        await scan(source.outDir);
    }
    if (orphans.length) {
        console.log(`\nNo matching Confluence page (review, then \`git rm\`):\n  ${orphans.join('\n  ')}`);
    }

    if (dryRun) console.log('\nNothing written: --dry-run.');
}
