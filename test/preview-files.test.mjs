import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { mimeFor, resolveServedPath } from '../src/preview-files.mjs';

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
