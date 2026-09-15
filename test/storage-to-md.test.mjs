import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isolateImages, storageToMarkdown } from '../src/confluence/storage-to-md.mjs';

const md = storage => storageToMarkdown(storage).markdown;

test('empty storage yields empty markdown', () => {
    assert.deepEqual(storageToMarkdown(''), { markdown: '', imageRefs: [], fileRefs: [] });
});

test('headings become ATX headings', () => {
    assert.equal(md('<h1>One</h1><h3>Three</h3>'), '# One\n\n### Three');
});

test('inline marks', () => {
    assert.equal(md('<p>A <strong>b</strong> <em>c</em> <code>d</code></p>'), 'A **b** *c* `d`');
});

test('bold glued to the text after it still renders', () => {
    // Confluence has no delimiters, so `<strong>Label:</strong>Text` is an
    // ordinary page — and `**Label:**Text` is plain text to every reader.
    assert.equal(
        md('<p><strong>Document applicable:</strong>Ce document</p>'),
        '**Document applicable:** Ce document'
    );
    assert.equal(md('<p><strong>Etat des lieux :</strong>Version 1</p>'), '**Etat des lieux :** Version 1');
});

test('a space inside a bold run moves outside it instead of being trimmed away', () => {
    assert.equal(md('<p><strong>Texte </strong>suite</p>'), '**Texte** suite');
});

test('links keep their href', () => {
    assert.equal(md('<p><a href="https://example.com/x">label</a></p>'), '[label](https://example.com/x)');
});

test('nested lists are indented, not flattened', () => {
    // A parent <li> closes after its children, so a naive per-item conversion
    // duplicates the child text inside the parent.
    assert.equal(md('<ul><li>one<ul><li>deep</li></ul></li><li>two</li></ul>'), '- one\n  - deep\n- two');
});

test('tables get a separator row', () => {
    assert.equal(
        md('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'),
        '| A | B |\n| --- | --- |\n| 1 | 2 |'
    );
});

test('named and numeric entities are decoded', () => {
    assert.equal(md('<p>caf&eacute; &amp; cr&#232;me &mdash; 100&nbsp;%</p>'), 'café & crème — 100 %');
});

test('an unknown entity is left alone rather than mangled', () => {
    assert.equal(md('<p>&fnord; stays</p>'), '&fnord; stays');
});

test('the code macro becomes a fenced block with its language', () => {
    const storage =
        '<ac:structured-macro ac:name="code">' +
        '<ac:parameter ac:name="language">sql</ac:parameter>' +
        '<ac:plain-text-body><![CDATA[select 1;]]></ac:plain-text-body>' +
        '</ac:structured-macro>';
    assert.equal(md(storage), '```sql\nselect 1;\n```');
});

test('a panel macro becomes a blockquote', () => {
    const storage =
        '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>heads up</p>' +
        '</ac:rich-text-body></ac:structured-macro>';
    assert.equal(md(storage), '> **INFO** heads up');
});

test('an unsupported macro is dropped, not emitted as garbage', () => {
    assert.equal(md('<p>before</p><ac:structured-macro ac:name="toc" /><p>after</p>'), 'before\n\nafter');
});

test('images become tokens, collected as references in order', () => {
    const result = storageToMarkdown(
        '<p><ac:image ac:alt="Home"><ri:attachment ri:filename="home.png" /></ac:image></p>' +
            '<p><ac:image><ri:url ri:value="https://example.com/logo.png" /></ac:image></p>'
    );
    assert.equal(result.markdown, '@@CIMG0@@\n\n@@CIMG1@@');
    assert.equal(result.imageRefs.length, 2);
    assert.equal(result.imageRefs[0].filename, 'home.png');
    assert.equal(result.imageRefs[0].alt, 'Home');
    assert.equal(result.imageRefs[1].externalUrl, 'https://example.com/logo.png');
});

test('an image attribute is decoded once, so round trips are stable', () => {
    const { imageRefs } = storageToMarkdown(
        '<ac:image ac:alt="Caf&eacute;"><ri:attachment ri:filename="caf&eacute;.png" /></ac:image>'
    );
    assert.equal(imageRefs[0].filename, 'café.png');
    assert.equal(imageRefs[0].alt, 'Café');
});

test('an image inside a table cell survives the cell stripping', () => {
    const result = storageToMarkdown(
        '<table><tr><td><ac:image><ri:attachment ri:filename="a.png" /></ac:image></td><td>text</td></tr></table>'
    );
    assert.match(result.markdown, /\| @@CIMG0@@ \| text \|/);
});

test('isolateImages puts an image on its own line but leaves table rows alone', () => {
    assert.equal(isolateImages('text ![a](a.png) more'), 'text\n\n![a](a.png)\n\nmore');
    assert.equal(isolateImages('| ![a](a.png) | b |'), '| ![a](a.png) | b |');
});

test('a page link keeps its title', () => {
    assert.equal(md('<p><ac:link><ri:page ri:content-title="Other page" /></ac:link></p>'), '[Other page]');
});

test('a page link does not swallow the text before it', () => {
    assert.equal(
        md('<p>A <ac:link><ri:user ri:account-id="x" /></ac:link> B <ac:link><ri:page ri:content-title="P" /></ac:link></p>'),
        'A  B [P]'
    );
});

test('links to attachments become file tokens with their label', () => {
    const result = storageToMarkdown(
        '<p>See <ac:link><ri:attachment ri:filename="spec.pdf" />' +
            '<ac:plain-text-link-body><![CDATA[the spec]]></ac:plain-text-link-body></ac:link>' +
            ' and <ac:link><ri:attachment ri:filename="data.xlsx" /></ac:link>.</p>' +
            '<p>Then <ac:link><ri:page ri:content-title="Other" /></ac:link></p>'
    );
    assert.equal(result.markdown, 'See @@CFILE0@@ and @@CFILE1@@.\n\nThen [Other]');
    assert.deepEqual(result.fileRefs, [
        { filename: 'spec.pdf', pageTitle: undefined, label: 'the spec' },
        { filename: 'data.xlsx', pageTitle: undefined, label: undefined },
    ]);
});

test('a rich link body gives its text as the label', () => {
    const { fileRefs } = storageToMarkdown(
        '<ac:link><ri:attachment ri:filename="a.docx" /><ac:link-body><strong>Doc</strong></ac:link-body></ac:link>'
    );
    assert.equal(fileRefs[0].label, 'Doc');
});

test('an attachment of another page keeps that page title', () => {
    const { fileRefs } = storageToMarkdown(
        '<ac:link><ri:attachment ri:filename="b.pdf"><ri:page ri:content-title="Caf&eacute;" /></ri:attachment></ac:link>'
    );
    assert.equal(fileRefs[0].pageTitle, 'Café');
});

test('file preview macros become file tokens in their own paragraph', () => {
    const result = storageToMarkdown(
        '<p>before</p>' +
            '<ac:structured-macro ac:name="view-file" ac:schema-version="1">' +
            '<ac:parameter ac:name="name"><ri:attachment ri:filename="budget.xlsx" /></ac:parameter>' +
            '<ac:parameter ac:name="height">250</ac:parameter></ac:structured-macro>' +
            '<ac:structured-macro ac:name="viewpdf"><ac:parameter ac:name="name">' +
            '<ri:attachment ri:filename="plan.pdf" /></ac:parameter></ac:structured-macro>' +
            '<p>after</p>'
    );
    assert.equal(result.markdown, 'before\n\n@@CFILE0@@\n\n@@CFILE1@@\n\nafter');
    assert.deepEqual(
        result.fileRefs.map(ref => ref.filename),
        ['budget.xlsx', 'plan.pdf']
    );
});

test('a thumbnail linking to a file keeps both the image and the file', () => {
    const result = storageToMarkdown(
        '<p><ac:link><ri:attachment ri:filename="deck.pdf" /><ac:link-body>' +
            '<ac:image><ri:attachment ri:filename="thumb.png" /></ac:image></ac:link-body></ac:link></p>'
    );
    assert.equal(result.markdown, '@@CIMG0@@ @@CFILE0@@');
    assert.equal(result.imageRefs[0].filename, 'thumb.png');
    assert.equal(result.fileRefs[0].filename, 'deck.pdf');
});
