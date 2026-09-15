import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { assetHeaders, isAttachment, isLocalHost, mimeFor, resolveServedPath } from '../src/preview-files.mjs';

const ROOT = path.resolve('/srv/docs');
const resolve = urlPath => resolveServedPath(ROOT, urlPath);

test('a plain path resolves inside the root', () => {
    assert.equal(resolve('/specs/home.md'), path.join(ROOT, 'specs/home.md'));
});

test('the root itself resolves', () => {
    assert.equal(resolve('/'), ROOT);
});

test('a query string is ignored', () => {
    assert.equal(resolve('/specs/home.md?v=2'), path.join(ROOT, 'specs/home.md'));
});

test('a percent-encoded space resolves, matching encodePath output', () => {
    assert.equal(resolve('/assets/my%20image.png'), path.join(ROOT, 'assets/my image.png'));
});

test('traversal out of the root is refused', () => {
    assert.equal(resolve('/../secrets.js'), null);
    assert.equal(resolve('/specs/../../secrets.js'), null);
});

test('encoded traversal is refused', () => {
    assert.equal(resolve('/%2e%2e/secrets.js'), null);
    assert.equal(resolve('/%2E%2E%2Fsecrets.js'), null);
});

test('malformed percent-encoding is refused rather than throwing', () => {
    assert.equal(resolve('/%zz'), null);
});

test('a NUL byte is refused', () => {
    assert.equal(resolve('/specs/home.md%00.png'), null);
});

test('a dotted segment is refused at any depth', () => {
    // The served root can be wider than the mirror, so "inside the root" is
    // not enough: .env once came back with a 200 and the API token in it.
    assert.equal(resolve('/.env'), null);
    assert.equal(resolve('/specs/.env'), null);
    assert.equal(resolve('/.git/config'), null);
    assert.equal(resolve('/.ssh/id_rsa'), null);
    assert.equal(resolve('/%2Eenv'), null);
});

test('a legitimate name merely containing a dot is allowed', () => {
    assert.equal(resolve('/specs/v1.2-notes.md'), path.join(ROOT, 'specs/v1.2-notes.md'));
});

test('documentation assets are on the allowlist', () => {
    assert.equal(mimeFor('a.png'), 'image/png');
    assert.equal(mimeFor('a.PNG'), 'image/png');
    assert.equal(mimeFor('a.pdf'), 'application/pdf');
    assert.equal(mimeFor('a.svg'), 'image/svg+xml');
});

test('anything else has no type, so the server refuses it', () => {
    // An octet-stream fallback here is what served .env and source files.
    for (const file of ['.env', 'secrets.js', 'app.mjs', 'id_rsa', 'dump.sql', 'a.exe', 'noext']) {
        assert.equal(mimeFor(file), null, `${file} must not be servable`);
    }
});

test('only a file inside an assets/ folder is an attachment', () => {
    assert.equal(isAttachment(ROOT, path.join(ROOT, 'specs/assets/home/archive.zip')), true);
    assert.equal(isAttachment(ROOT, path.join(ROOT, 'specs/home/assets/video.mp4')), true);
    assert.equal(isAttachment(ROOT, path.join(ROOT, 'specs/archive.zip')), false);
    assert.equal(isAttachment(ROOT, path.join(ROOT, 'assets.key')), false, 'a file called assets is not a folder');
    assert.equal(isAttachment(ROOT, path.join(ROOT, 'my-assets/server.key')), false);
});

test('an attachment downloads, off the allowlist', () => {
    const headers = assetHeaders(ROOT, path.join(ROOT, 'specs/assets/home/Export Jira.zip'), '127.0.0.1:4801');
    assert.equal(headers['Content-Type'], 'application/octet-stream');
    assert.equal(headers['Content-Disposition'], "attachment; filename*=UTF-8''Export%20Jira.zip");
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
});

test('outside assets/, a type off the allowlist is still refused', () => {
    assert.equal(assetHeaders(ROOT, path.join(ROOT, 'secrets.js'), '127.0.0.1:4801'), null);
    assert.equal(assetHeaders(ROOT, path.join(ROOT, 'specs/dump.sql'), 'localhost:4801'), null);
});

test('an allowlisted type is served as itself, and an SVG in a sandbox', () => {
    assert.equal(assetHeaders(ROOT, path.join(ROOT, 'a.png'), 'example.com')['Content-Type'], 'image/png');
    const svg = assetHeaders(ROOT, path.join(ROOT, 'specs/assets/home/diagram.svg'), '127.0.0.1:4801');
    assert.equal(svg['Content-Security-Policy'], 'sandbox');
    assert.equal(svg['Content-Disposition'], undefined);
});

test('an attachment is refused to a public host name: DNS rebinding', () => {
    assert.equal(isLocalHost('127.0.0.1:4801'), true);
    assert.equal(isLocalHost('localhost:4801'), true);
    assert.equal(isLocalHost('[::1]:4801'), true);
    assert.equal(isLocalHost('192.168.1.20:4801'), true, '--host 0.0.0.0, reached by IP');
    assert.equal(isLocalHost('my-mac.local:4801'), true);
    assert.equal(isLocalHost('rebind.evil.example:4801'), false);
    assert.equal(isLocalHost(undefined), false);
    assert.equal(assetHeaders(ROOT, path.join(ROOT, 'specs/assets/home/archive.zip'), 'rebind.evil.example:4801'), null);
});
