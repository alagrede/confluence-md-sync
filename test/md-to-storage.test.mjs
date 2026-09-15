import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdownToStorage } from '../src/confluence/md-to-storage.mjs';
import { storageToMarkdown } from '../src/confluence/storage-to-md.mjs';

test('headings and paragraphs', () => {
    assert.equal(markdownToStorage('## Title\n\nBody text.'), '<h2>Title</h2>\n<p>Body text.</p>');
});

test('consecutive lines join into one paragraph', () => {
    assert.equal(markdownToStorage('one\ntwo'), '<p>one two</p>');
});

test('inline marks', () => {
    assert.equal(
        markdownToStorage('a **b** *c* `d`'),
        '<p>a <strong>b</strong> <em>c</em> <code>d</code></p>'
    );
});

test('markup inside a code span is not interpreted', () => {
    assert.equal(markdownToStorage('`a *b* [c](d)`'), '<p><code>a *b* [c](d)</code></p>');
});

test('XML special characters are escaped', () => {
    assert.equal(markdownToStorage('a < b & c > d'), '<p>a &lt; b &amp; c &gt; d</p>');
});

test('a link label may contain one pair of brackets', () => {
    assert.equal(
        markdownToStorage('[[TICKET-108] Some screen](https://example.com/x)'),
        '<p><a href="https://example.com/x">[TICKET-108] Some screen</a></p>'
    );
});

test('nested lists put the child <ul> inside its parent <li>', () => {
    // Confluence reformats the list on first edit if the <ul> is a sibling.
    assert.equal(
        markdownToStorage('- one\n  - deep\n- two'),
        '<ul><li>one<ul><li>deep</li></ul></li><li>two</li></ul>'
    );
});

test('tables render a header row of <th>', () => {
    assert.equal(
        markdownToStorage('| A | B |\n| --- | --- |\n| 1 | 2 |'),
        '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>'
    );
});

test('a fenced block becomes the code macro, keeping its line breaks', () => {
    const storage = markdownToStorage('```js\nlet a = 1;\nlet b = 2;\n```');
    assert.match(storage, /ac:name="code"/);
    assert.match(storage, /<ac:parameter ac:name="language">js<\/ac:parameter>/);
    assert.match(storage, /\[CDATA\[let a = 1;\nlet b = 2;\]\]/);
});

test('a fence with no language emits no language parameter', () => {
    assert.doesNotMatch(markdownToStorage('```\nplain\n```'), /ac:parameter/);
});

test('a horizontal rule becomes <hr />', () => {
    assert.equal(markdownToStorage('---'), '<hr />');
});

test('an image resolves through the callback', () => {
    const storage = markdownToStorage('![Home](assets/home.png)', (link, alt) => {
        assert.equal(link, 'assets/home.png');
        assert.equal(alt, 'Home');
        return { filename: 'home.png', alt };
    });
    assert.equal(
        storage,
        '<p><ac:image ac:alt="Home"><ri:attachment ri:filename="home.png" /></ac:image></p>'
    );
});

test('an unresolved image is dropped rather than left broken', () => {
    assert.equal(markdownToStorage('![x](missing.png)', () => null), '');
});

test('an external image reference uses ri:url', () => {
    assert.equal(
        markdownToStorage('![x](y)', () => ({ url: 'https://example.com/a.png' })),
        '<p><ac:image><ri:url ri:value="https://example.com/a.png" /></ac:image></p>'
    );
});

test('prose survives a markdown → storage → markdown round trip', () => {
    const source = [
        '## Scope',
        '',
        'A **bold** claim, an *aside*, and `code`.',
        '',
        '- first',
        '  - nested',
        '- second',
        '',
        '| Field | Type |',
        '| --- | --- |',
        '| name | text |',
    ].join('\n');

    const { markdown } = storageToMarkdown(markdownToStorage(source));
    assert.equal(markdown, source);
});

test('a link resolved to an attachment becomes an attachment link', () => {
    const files = { 'assets/page/spec%20v2.pdf': 'spec v2.pdf' };
    assert.equal(
        markdownToStorage('See [the spec](assets/page/spec%20v2.pdf) or [site](https://x.y).', undefined, link =>
            files[link] ?? null
        ),
        '<p>See <ac:link><ri:attachment ri:filename="spec v2.pdf" /><ac:link-body>the spec</ac:link-body></ac:link>' +
            ' or <a href="https://x.y">site</a>.</p>'
    );
});

test('file links are resolved in list items and table cells too', () => {
    const resolve = link => (link === 'a.xlsx' ? 'a.xlsx' : null);
    assert.match(markdownToStorage('- [A](a.xlsx)', undefined, resolve), /<li><ac:link><ri:attachment ri:filename="a.xlsx"/);
    assert.match(
        markdownToStorage('| h |\n| --- |\n| [A](a.xlsx) |', undefined, resolve),
        /<td><ac:link><ri:attachment ri:filename="a.xlsx"/
    );
});

test('an inline image is never resolved as a file', () => {
    let asked = false;
    markdownToStorage('text ![a](a.png) text', undefined, () => {
        asked = true;
        return 'a.png';
    });
    assert.equal(asked, false);
});
