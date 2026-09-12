import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdownFile, quoteYaml, renderMarkdownFile } from '../src/markdown/markdown-file.mjs';
import { markdownToHtml, anchor } from '../src/markdown/md-to-html.mjs';
import { encodePath, safeFilename, slug } from '../src/markdown/slug.mjs';

test('slug strips accents and punctuation', () => {
    assert.equal(slug('Crème Brûlée — Récapitulatif'), 'creme-brulee-recapitulatif');
});

test('slug truncates on a dash, never mid-word', () => {
    const long = slug('a'.repeat(40) + ' ' + 'b'.repeat(40));
    assert.ok(long.length <= 70);
    assert.equal(long, 'a'.repeat(40));
});

test('slug of a title with no usable characters is empty rather than throwing', () => {
    assert.equal(slug('!!!'), '');
});

test('safeFilename keeps the extension and drops accents', () => {
    assert.equal(safeFilename('Capture d’écran 2024.png'), 'Capture-d-ecran-2024.png');
});

test('encodePath escapes each segment and always uses forward slashes', () => {
    assert.equal(encodePath('assets/home/my image.png'), 'assets/home/my%20image.png');
});

test('frontmatter round trips through parse and render', () => {
    const content = renderMarkdownFile({
        frontmatter: { title: quoteYaml('A: tricky # title'), version: 3 },
        body: '# A: tricky # title\n\nBody.',
    });
    const { frontmatter, body } = parseMarkdownFile(content);
    assert.equal(frontmatter.title, 'A: tricky # title');
    assert.equal(frontmatter.version, '3');
    assert.equal(body, '# A: tricky # title\n\nBody.');
});

test('a file with no frontmatter parses as all body', () => {
    assert.deepEqual(parseMarkdownFile('# Hi\n'), { frontmatter: {}, body: '# Hi' });
});

test('an unterminated frontmatter block is left in the body, not silently eaten', () => {
    const { frontmatter, body } = parseMarkdownFile('---\ntitle: x\n\n# Hi');
    assert.deepEqual(frontmatter, {});
    assert.match(body, /^---/);
});

test('anchors are stable and url-safe', () => {
    assert.equal(anchor('Périmètre & limites'), 'perimetre-limites');
});

test('headings carry an id matching their anchor link', () => {
    const { html, headings } = markdownToHtml('## Périmètre & limites');
    assert.deepEqual(headings, [{ level: 2, text: 'Périmètre & limites', id: 'perimetre-limites' }]);
    assert.match(html, /<h2 id="perimetre-limites">/);
});

test('frontmatter is not rendered into the body', () => {
    const { html } = markdownToHtml('---\ntitle: x\n---\n\n# Hi');
    assert.doesNotMatch(html, /title: x/);
});

test('html in the source is escaped, not executed', () => {
    const { html } = markdownToHtml('a <script>alert(1)</script> b');
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
});

test('ordered and unordered lists use the right tag', () => {
    assert.match(markdownToHtml('1. one\n2. two').html, /^<ol>/);
    assert.match(markdownToHtml('- one\n- two').html, /^<ul>/);
});

test('a blockquote renders its inner markdown', () => {
    assert.equal(markdownToHtml('> **bold** quote').html, '<blockquote><p><strong>bold</strong> quote</p></blockquote>');
});

test('a lone image becomes a figure so it can be centred', () => {
    assert.match(markdownToHtml('![alt](a.png)').html, /^<figure><img src="a.png"/);
});

test('a bare url in angle brackets becomes a link', () => {
    assert.match(markdownToHtml('see <https://example.com/x>').html, /<a href="https:\/\/example.com\/x">/);
});

test('tables are wrapped so wide ones scroll instead of breaking the layout', () => {
    assert.match(markdownToHtml('| A |\n| --- |\n| 1 |').html, /<div class="table-wrap"><table>/);
});

test('a title containing a double quote survives the frontmatter round trip', () => {
    // quoteYaml uses JSON.stringify, so stripping the outer quotes alone would
    // leave the backslashes visible in the page title and the sidebar.
    const title = 'He said "hi" — done';
    const file = renderMarkdownFile({ frontmatter: { title: quoteYaml(title) }, body: 'x' });
    assert.equal(parseMarkdownFile(file).frontmatter.title, title);
});

test('an unquoted frontmatter value is taken as-is', () => {
    assert.equal(parseMarkdownFile('---\nversion: 7\n---\n\nx').frontmatter.version, '7');
});

test('a value that only looks quoted does not throw', () => {
    assert.equal(parseMarkdownFile('---\ntitle: "unclosed\n---\n\nx').frontmatter.title, '"unclosed');
});
