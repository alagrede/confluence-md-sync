// Writes a starter config next to the project's package.json, so the first run
// of `pull` has something to read.
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../args.mjs';
import { CONFIG_NAMES, findConfigFile } from '../config.mjs';

export const usage = `Usage: confluence-md-sync init [options]

Creates ${CONFIG_NAMES[0]} in the current directory.

Options:
  --force   overwrite an existing config file
`;

const TEMPLATE = `// Which Confluence trees are mirrored, and where.
//
// Paths are relative to this file, so the commands behave the same whatever
// directory they are run from. Credentials live outside this file: see
// CONFLUENCE_BASE_URL / CONFLUENCE_EMAIL / CONFLUENCE_API_TOKEN in the README.

export default {
    sources: [
        {
            // The id in the Confluence URL of the page or folder to mirror:
            // …/spaces/SPACE/folder/123456789 → rootId: '123456789'
            rootId: 'REPLACE_ME',

            // Where the markdown mirror is written. Everything in here is
            // overwritten by \`pull\`, so keep hand-written notes elsewhere.
            outDir: 'docs/specs',

            // Sidebar heading in the preview server. Optional.
            // label: 'Specifications',
        },
    ],

    serve: {
        // port: 4801,
        // title: 'Documentation',

        // Directory served from. Defaults to the closest directory containing
        // every outDir above — 'docs' for the single source above.
        // root: 'docs',

        // Extra directories of hand-written markdown to show in the sidebar.
        // They are never touched by pull or push.
        // sections: [{ label: 'Design notes', dir: 'docs/notes' }],
    },
};
`;

export async function init(argv) {
    const args = parseArgs(argv, { flags: ['--force'] });
    const target = path.resolve(process.cwd(), CONFIG_NAMES[0]);

    if (existsSync(target) && !args.has('--force')) {
        console.error(`${CONFIG_NAMES[0]} already exists here. Use --force to overwrite it.`);
        process.exitCode = 1;
        return;
    }

    // A config file further up the tree would shadow-compete with this one:
    // warn rather than silently create a second root.
    const existing = findConfigFile(process.cwd());
    if (existing && path.dirname(existing) !== process.cwd()) {
        console.log(`Note: ${existing} already configures a project containing this directory.\n`);
    }

    await writeFile(target, TEMPLATE, 'utf8');
    console.log(`Created ${path.relative(process.cwd(), target)}.

Next:
  1. Replace rootId with the id from your Confluence URL.
  2. Export CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN
     (shell, ./.env, or ~/.config/confluence-md-sync/env).
  3. confluence-md-sync pull --dry-run`);
}
