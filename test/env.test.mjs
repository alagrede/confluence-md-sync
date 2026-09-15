import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadEnv } from '../src/env.mjs';

const KEYS = ['CMS_TEST_URL', 'CMS_TEST_EMAIL', 'CMS_TEST_TOKEN'];
const CONTENT = ['CMS_TEST_URL=https://x.atlassian.net/wiki', 'CMS_TEST_EMAIL="me@x.io"', 'CMS_TEST_TOKEN=abc', ''];

async function loadFrom(bytes) {
    const root = await mkdtemp(path.join(tmpdir(), 'cms-env-'));
    await writeFile(path.join(root, '.env'), bytes);
    for (const key of KEYS) delete process.env[key];
    loadEnv(root);
    return KEYS.map(key => process.env[key]);
}

const EXPECTED = ['https://x.atlassian.net/wiki', 'me@x.io', 'abc'];

test('a .env with LF endings is loaded', async () => {
    assert.deepEqual(await loadFrom(CONTENT.join('\n')), EXPECTED);
});

test('a .env saved on Windows with CRLF endings is loaded', async () => {
    assert.deepEqual(await loadFrom(CONTENT.join('\r\n')), EXPECTED);
});

test('a .env with a UTF-8 BOM is loaded', async () => {
    assert.deepEqual(await loadFrom('﻿' + CONTENT.join('\r\n')), EXPECTED);
});

test('a .env written as UTF-16 LE by Windows PowerShell is loaded', async () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(CONTENT.join('\r\n'), 'utf16le')]);
    assert.deepEqual(await loadFrom(bytes), EXPECTED);
});
