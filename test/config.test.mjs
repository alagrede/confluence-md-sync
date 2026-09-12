import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseArgs, UsageError } from '../src/args.mjs';
import {
    assertSyncable,
    commonAncestor,
    findConfigFile,
    loadConfig,
    ConfigError,
    PLACEHOLDER_ROOT_ID,
} from '../src/config.mjs';

async function project(config) {
    const root = await mkdtemp(path.join(tmpdir(), 'cms-test-'));
    if (config !== null) {
        await writeFile(path.join(root, 'confluence-md-sync.config.mjs'), config, 'utf8');
    }
    return root;
}

test('--only accepts both a separate value and an = form', () => {
    const spec = { flags: ['--dry-run'], options: ['--only'] };
    assert.equal(parseArgs(['--only', 'home'], spec).options.only, 'home');
    assert.equal(parseArgs(['--only=home'], spec).options.only, 'home');
});

test('an unknown option is rejected rather than ignored', () => {
    // A silently ignored `--dry-runn` on push would publish for real.
    assert.throws(() => parseArgs(['--dry-runn'], { flags: ['--dry-run'] }), UsageError);
});

test('an option with no value is rejected', () => {
    assert.throws(() => parseArgs(['--only'], { options: ['--only'] }), UsageError);
    assert.throws(() => parseArgs(['--only', '--apply'], { options: ['--only'], flags: ['--apply'] }), UsageError);
});

test('commonAncestor finds the deepest shared directory', () => {
    assert.equal(commonAncestor(['/a/b/c', '/a/b/d']), path.resolve('/a/b'));
    assert.equal(commonAncestor(['/a/b', '/a/b']), path.resolve('/a/b'));
});

test('the config file is found from a nested directory', async () => {
    const root = await project('export default { sources: [{ rootId: "1", outDir: "docs/specs" }] };');
    const nested = path.join(root, 'docs', 'specs');
    await mkdir(nested, { recursive: true });
    assert.equal(findConfigFile(nested), path.join(root, 'confluence-md-sync.config.mjs'));
});

test('relative paths resolve against the config file, not the working directory', async () => {
    const root = await project('export default { sources: [{ rootId: "42", outDir: "docs/specs" }] };');
    const config = await loadConfig({ cwd: path.join(root) });
    assert.equal(config.root, root);
    assert.equal(config.sources[0].outDir, path.join(root, 'docs/specs'));
    assert.equal(config.sources[0].rootId, '42');
});

test('the serve root defaults to the directory containing the mirror', async () => {
    const root = await project('export default { sources: [{ rootId: "1", outDir: "docs/specs" }] };');
    const config = await loadConfig({ cwd: root });
    assert.equal(config.serve.root, path.join(root, 'docs'));
    assert.equal(config.serve.port, 4801);
});

test('two mirrors share a serve root', async () => {
    const root = await project(
        'export default { sources: [{ rootId: "1", outDir: "docs/a" }, { rootId: "2", outDir: "docs/b" }] };'
    );
    const config = await loadConfig({ cwd: root });
    assert.equal(config.serve.root, path.join(root, 'docs'));
});

test('a legacy `export const SOURCES` config still loads', async () => {
    const root = await project('export const SOURCES = [{ rootId: "7", outDir: "docs/specs" }];');
    const config = await loadConfig({ cwd: root });
    assert.equal(config.sources[0].rootId, '7');
});

test('a JSON config loads', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cms-test-'));
    await writeFile(
        path.join(root, 'confluence-md-sync.config.json'),
        JSON.stringify({ sources: [{ rootId: '9', outDir: 'docs/specs' }] }),
        'utf8'
    );
    const config = await loadConfig({ cwd: root });
    assert.equal(config.sources[0].rootId, '9');
});

test('an outDir escaping the project is refused', async () => {
    const root = await project('export default { sources: [{ rootId: "1", outDir: "../elsewhere" }] };');
    await assert.rejects(() => loadConfig({ cwd: root }), ConfigError);
});

test('a source with no rootId is refused with the offending index', async () => {
    const root = await project('export default { sources: [{ outDir: "docs" }] };');
    await assert.rejects(() => loadConfig({ cwd: root }), /sources\[0\] has no `rootId`/);
});

test('a serve.root that does not contain a mirror is refused', async () => {
    const root = await project(
        'export default { sources: [{ rootId: "1", outDir: "docs/specs" }], serve: { root: "other" } };'
    );
    await assert.rejects(() => loadConfig({ cwd: root }), /does not contain/);
});

test('the init placeholder is named, not left to fail as an HTTP error', async () => {
    const root = await project(`export default { sources: [{ rootId: '${PLACEHOLDER_ROOT_ID}', outDir: 'docs' }] };`);
    const config = await loadConfig({ cwd: root });
    // loadConfig accepts it — serve must work before a rootId is filled in.
    assert.equal(config.sources[0].rootId, PLACEHOLDER_ROOT_ID);
    assert.throws(() => assertSyncable(config), /still the placeholder/);
});

test('the serve root never silently widens to the whole project', async () => {
    // With outDir 'docs' the parent is the project root, and the preview would
    // otherwise sit on top of the source tree — .env included.
    const root = await project("export default { sources: [{ rootId: '1', outDir: 'docs' }] };");
    const config = await loadConfig({ cwd: root });
    assert.equal(config.serve.root, path.join(root, 'docs'));
    assert.notEqual(config.serve.root, config.root);
});

test('mirrors in unrelated trees still resolve to a root containing both', async () => {
    const root = await project(
        "export default { sources: [{ rootId: '1', outDir: 'docs/a' }, { rootId: '2', outDir: 'other/b' }] };"
    );
    const config = await loadConfig({ cwd: root });
    assert.equal(config.serve.root, config.root);
});
