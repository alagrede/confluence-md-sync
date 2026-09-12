#!/usr/bin/env node
// Single entry point. Subcommands are imported lazily so that `serve` never
// loads the Confluence client, and so a missing credential cannot break `init`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../src/args.mjs';
import { ConfigError } from '../src/config.mjs';
import { ConfluenceError } from '../src/confluence/client.mjs';

const COMMANDS = {
    pull: () => import('../src/commands/pull.mjs').then(m => ({ run: m.pull, usage: m.usage })),
    push: () => import('../src/commands/push.mjs').then(m => ({ run: m.push, usage: m.usage })),
    serve: () => import('../src/commands/serve.mjs').then(m => ({ run: m.serve, usage: m.usage })),
    init: () => import('../src/commands/init.mjs').then(m => ({ run: m.init, usage: m.usage })),
};

const HELP = `confluence-md-sync — mirror Confluence pages as markdown, and publish them back.

Usage: confluence-md-sync <command> [options]

Commands:
  pull     replace the local mirror with the current state of Confluence
  push     publish edited mirror files back to their Confluence pages
  serve    browse the mirrored markdown as HTML on localhost
  init     create a starter config file in the current directory

Run \`confluence-md-sync <command> --help\` for a command's options.

Configuration:
  confluence-md-sync.config.mjs   which Confluence trees are mirrored, and where
  CONFLUENCE_BASE_URL             https://your-org.atlassian.net/wiki
  CONFLUENCE_EMAIL                your Atlassian account email
  CONFLUENCE_API_TOKEN            id.atlassian.com/manage-profile/security/api-tokens

  Credentials are read from the shell, then ./.env, then
  ~/.config/confluence-md-sync/env. The first value found wins.
`;

function version() {
    const packageJson = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(readFileSync(packageJson, 'utf8')).version;
}

async function main(argv) {
    const [name, ...rest] = argv;

    if (!name || name === 'help' || name === '--help' || name === '-h') {
        console.log(HELP);
        return;
    }
    if (name === '--version' || name === '-v') {
        console.log(version());
        return;
    }

    const load = COMMANDS[name];
    if (!load) {
        console.error(`Unknown command: ${name}\n`);
        console.error(HELP);
        process.exitCode = 1;
        return;
    }

    const command = await load();
    if (rest.includes('--help') || rest.includes('-h')) {
        console.log(command.usage);
        return;
    }
    await command.run(rest);
}

try {
    await main(process.argv.slice(2));
} catch (error) {
    // These three carry messages written for the person running the command;
    // anything else is a bug and deserves its stack trace.
    if (error instanceof UsageError || error instanceof ConfigError || error instanceof ConfluenceError) {
        console.error(error.message);
        process.exit(1);
    }
    throw error;
}
