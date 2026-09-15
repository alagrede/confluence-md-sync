// Credential lookup. Kept separate from the Confluence client so the preview
// server never has to touch it: serving markdown needs no credentials at all.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/**
 * Files consulted, in order. The first value found for a given key wins, and
 * variables already exported in the shell always win over all of them — so a
 * one-off `CONFLUENCE_API_TOKEN=… confluence-md-sync pull` works as expected.
 */
export function envFileCandidates(cwd = process.cwd()) {
    return [
        process.env.CONFLUENCE_MD_SYNC_ENV,
        path.resolve(cwd, '.env'),
        path.join(homedir(), '.config/confluence-md-sync/env'),
    ].filter(Boolean);
}

/**
 * Decodes an env file as written on any platform: Notepad may add a UTF-8 BOM,
 * and Windows PowerShell 5's `>` / Out-File writes UTF-16 LE.
 */
export function readEnvFile(file) {
    const bytes = readFileSync(file);
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.toString('utf16le').slice(1);
    return bytes.toString('utf8').replace(/^﻿/, '');
}

/** Loads the candidate files into process.env without overwriting anything. */
export function loadEnv(cwd = process.cwd()) {
    const loaded = [];
    for (const file of envFileCandidates(cwd)) {
        if (!existsSync(file)) continue;
        loaded.push(file);
        // CRLF endings are the Windows default; a stray \r makes LINE miss every line.
        for (const line of readEnvFile(file).split(/\r?\n|\r/)) {
            const match = line.match(LINE);
            if (!match) continue;
            const [, key, rawValue] = match;
            if (process.env[key] !== undefined) continue;
            process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    return loaded;
}
