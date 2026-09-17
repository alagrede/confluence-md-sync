// Local markdown → Confluence. Publishes the body of a mirror file to its page.
//
// WARNING: this is a replacement, not a merge. Whatever the page held in macros,
// layouts or column widths is lost, because the markdown export does not carry
// it. Hence the three guards: dry run by default, refusal when the page moved
// since the last pull, and refusal when the local file was not edited.
import { existsSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../args.mjs';
import { assertSyncable, loadConfig } from '../config.mjs';
import { ConfluenceClient, MIME_BY_EXTENSION } from '../confluence/client.mjs';
import { markdownToStorage } from '../confluence/md-to-storage.mjs';
import { storageToMarkdown } from '../confluence/storage-to-md.mjs';
import { parseMarkdownFile } from '../markdown/markdown-file.mjs';
import { safeFilename } from '../markdown/slug.mjs';
import { runPull } from './pull.mjs';

export const usage = `Usage: confluence-md-sync push [options]

Publishes edited mirror files back to their Confluence pages. Replaces the page
body with the rendered markdown; macros and layouts the markdown cannot carry
are lost. Published pages are then pulled again, so their files carry the new
version number and publication date.

Options:
  --apply            actually publish (without it, nothing is written)
  --only <pattern>   only handle files whose path contains <pattern>
  --force            publish despite a version gap or an unmodified file
  --print            print the generated storage format
  --no-pull          do not pull the published pages afterwards

Exit code 2 means at least one page was blocked by a guard.
`;

/** `[label](target)` not preceded by `!`, the label allowing one level of brackets. */
const LINK = /(?<!!)\[((?:[^[\]]|\[[^[\]]*\])+)\]\(([^)\s]+)\)/g;

/** A link target that can be a local file: not a URL, an anchor, or another page. */
const isLocalFileTarget = target => !/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^#|\.md(#|$)/i.test(target);

/**
 * Compares the file's prose to the live page to tell whether anyone actually
 * edited the markdown. Images are removed from the comparison and links to
 * attached files are reduced to their label: in the file they are asset paths,
 * on the page they are attachment references — only the text is comparable.
 */
export function sameProse(localBody, live) {
    const normalize = text =>
        text
            .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
            .replace(/@@CIMG\d+@@/g, '')
            // What pull writes for an attachment it could not find.
            .replace(/_\[missing image: [^\]]*\]_/g, '')
            .replace(/_\[missing file: ([^\]]*)\]_/g, '[$1]')
            .replace(LINK, (whole, label, target) => (isLocalFileTarget(target) ? `[${label}]` : whole))
            .replace(/\s+/g, ' ')
            .trim();
    const liveText = live.markdown.replace(/@@CFILE(\d+)@@/g, (_, index) => {
        const ref = live.fileRefs[Number(index)];
        return `[${ref.label || ref.filename}]`;
    });
    return normalize(localBody) === normalize(liveText);
}

export async function push(argv) {
    const args = parseArgs(argv, {
        flags: ['--apply', '--force', '--print', '--no-pull'],
        options: ['--only'],
    });
    const apply = args.has('--apply');
    const force = args.has('--force');
    const print = args.has('--print');
    const refresh = !args.has('--no-pull');
    const only = args.options.only ?? null;

    const config = await loadConfig();
    assertSyncable(config);
    const client = new ConfluenceClient({ cwd: config.root });
    const display = file => path.relative(config.root, file) || '.';

    /** Every .md in the mirror except README (a local index, not a page). */
    async function collectCandidates(outDir) {
        const found = [];
        const scan = async dir => {
            for (const entry of await readdir(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== 'assets') await scan(full);
                    continue;
                }
                if (!entry.name.endsWith('.md') || entry.name === 'README.md') continue;
                if (only && !full.includes(only)) continue;
                found.push({ mdPath: full, ...parseMarkdownFile(await readFile(full, 'utf8')) });
            }
        };
        if (existsSync(outDir)) await scan(outDir);
        return found;
    }

    const summary = { pushed: 0, skipped: 0, blocked: 0, unchanged: 0, attachments: 0 };
    /** Page id → { mdPath, version } for every page actually published. */
    const published = new Map();

    for (const source of config.sources) {
        const candidates = await collectCandidates(source.outDir);
        console.log(
            `\n${candidates.length} page(s) in ${display(source.outDir)}` +
                `${apply ? '' : '   [dry run — nothing will be written]'}\n`
        );
        if (apply) {
            console.log('   Page bodies will be replaced by the rendered markdown.');
            console.log('   Macros and layouts the markdown does not carry will be lost.\n');
        }

        for (const candidate of candidates) {
            const { mdPath, frontmatter, body } = candidate;
            const pageId = frontmatter.confluence_id;
            if (!pageId) {
                console.log(`   !  ${display(mdPath)} — no confluence_id in the frontmatter, skipped`);
                summary.skipped++;
                continue;
            }

            let page;
            try {
                page = await client.getPage(pageId);
            } catch (error) {
                console.log(`   !  ${display(mdPath)} — ${error.message}`);
                summary.blocked++;
                continue;
            }

            if (page.type !== 'page') {
                console.log(`   !  ${display(mdPath)} — target is of type "${page.type}", not a page`);
                summary.skipped++;
                continue;
            }

            const liveVersion = page.version?.number;
            if (String(liveVersion) !== String(frontmatter.version) && !force) {
                console.log(
                    `   ⨯  ${display(mdPath)}\n` +
                        `      The page is at version ${liveVersion}, this file was pulled at version ${frontmatter.version}.\n` +
                        `      Run \`pull\` before publishing (or --force to override).`
                );
                summary.blocked++;
                continue;
            }

            const live = storageToMarkdown(page.body?.storage?.value ?? '');
            if (sameProse(body, { ...live, markdown: `# ${page.title}\n\n${live.markdown}` }) && !force) {
                summary.unchanged++;
                continue;
            }

            // Images already attached to the page are referenced by name; those
            // added locally are uploaded first. Pull writes attachments under
            // safeFilename(title), so a local name matches either form.
            const attached = new Map();
            for (const { title } of await client.getAttachments(pageId)) {
                attached.set(safeFilename(title), title);
                attached.set(title, title);
            }
            const localDir = path.dirname(mdPath);
            const images = new Map();
            for (const [, link] of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
                if (/^[a-z]+:/i.test(link) || images.has(link)) continue;
                const filePath = path.resolve(localDir, decodeURIComponent(link));
                const filename = path.basename(filePath);
                if (attached.has(filename)) {
                    images.set(link, attached.get(filename));
                    continue;
                }
                if (!existsSync(filePath)) {
                    console.log(`      missing image, dropped from the publication: ${link}`);
                    images.set(link, null);
                    continue;
                }
                if (apply) {
                    await client.uploadAttachment(
                        pageId,
                        filename,
                        await readFile(filePath),
                        MIME_BY_EXTENSION[path.extname(filename).toLowerCase()] ?? 'application/octet-stream'
                    );
                }
                images.set(link, filename);
                summary.attachments++;
            }

            // Links to local files (PDF, spreadsheets…) become attachment links
            // the same way. A target that is neither attached nor on disk stays
            // an ordinary link.
            const files = new Map();
            for (const [, , link] of body.matchAll(LINK)) {
                if (!isLocalFileTarget(link) || files.has(link)) continue;
                let filePath;
                try {
                    filePath = path.resolve(localDir, decodeURIComponent(link));
                } catch {
                    continue; // malformed percent-encoding: not one of our asset paths
                }
                const filename = path.basename(filePath);
                if (attached.has(filename)) {
                    files.set(link, attached.get(filename));
                    continue;
                }
                if (!existsSync(filePath) || !statSync(filePath).isFile()) {
                    files.set(link, null);
                    continue;
                }
                if (apply) {
                    await client.uploadAttachment(
                        pageId,
                        filename,
                        await readFile(filePath),
                        MIME_BY_EXTENSION[path.extname(filename).toLowerCase()] ?? 'application/octet-stream'
                    );
                }
                attached.set(filename, filename);
                files.set(link, filename);
                summary.attachments++;
            }

            // The level-1 heading belongs to the page itself, not to its body.
            const withoutTitle = body.replace(/^#\s+.*\n+/, '');
            const storage = markdownToStorage(
                withoutTitle,
                (link, alt) => {
                    const filename = images.get(link);
                    return filename ? { filename, alt } : null;
                },
                link => files.get(link) ?? null
            );

            if (print) console.log(`\n----- ${display(mdPath)} -----\n${storage}\n-----\n`);

            if (!apply) {
                console.log(
                    `   →  ${display(mdPath)}\n      ${page.title} (v${liveVersion}) — ` +
                        `${storage.length} characters, ${[...images.values()].filter(Boolean).length} image(s), ` +
                        `${[...files.values()].filter(Boolean).length} file(s)`
                );
                summary.pushed++;
                continue;
            }

            const updated = await client.updatePage({
                id: page.id,
                title: page.title,
                type: page.type,
                spaceKey: page.space.key,
                version: liveVersion,
                storage,
            });
            const newVersion = updated?.version?.number ?? liveVersion + 1;
            console.log(`   ✓  ${page.title} → v${newVersion}`);
            published.set(String(page.id), { mdPath, version: newVersion });
            summary.pushed++;
        }
    }

    console.log(
        `\n${summary.pushed} page(s) ${apply ? 'published' : 'to publish'}, ` +
            `${summary.unchanged} unmodified locally, ` +
            `${summary.blocked} blocked, ${summary.skipped} skipped.`
    );
    if (!apply && summary.pushed) {
        console.log('\nRe-run with --apply to publish.');
    }

    if (published.size && refresh) await refreshPublished(published, display);
    else if (published.size) console.log('\nRun `pull` to refresh the version numbers in the frontmatter.');
    if (summary.blocked) process.exitCode = 2;
}

/**
 * Pulls the pages just published, and only those: other files in the mirror
 * may hold edits that were blocked or not selected, and must survive.
 */
async function refreshPublished(published, display) {
    console.log(`\nRefreshing ${published.size} published page(s) from Confluence…`);
    try {
        await runPull({ quiet: true, pageIds: new Set(published.keys()) });
    } catch (error) {
        // The pages are published at this point: a failed refresh is not a failed push.
        console.log(`\n   !  Refresh failed: ${error.message}\n      Run \`pull\` to update the frontmatter.`);
        return;
    }

    // Pull writes a page at the path its title dictates. A file that was moved
    // or renamed locally is not that path, and still holds the old version.
    for (const { mdPath, version } of published.values()) {
        const { frontmatter } = parseMarkdownFile(await readFile(mdPath, 'utf8'));
        if (String(frontmatter.version) !== String(version)) {
            console.log(
                `   !  ${display(mdPath)} is still at version ${frontmatter.version}: ` +
                    'pull writes this page elsewhere. Run `pull` and review the result.'
            );
        }
    }
}
