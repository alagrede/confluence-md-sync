import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameProse } from '../src/commands/push.mjs';
import { storageToMarkdown } from '../src/confluence/storage-to-md.mjs';

test('a pulled file link compares equal to the attachment link on the page', () => {
    const live = storageToMarkdown(
        '<p>See <ac:link><ri:attachment ri:filename="spec.pdf" />' +
            '<ac:plain-text-link-body><![CDATA[the spec]]></ac:plain-text-link-body></ac:link>.</p>' +
            '<ac:structured-macro ac:name="view-file"><ac:parameter ac:name="name">' +
            '<ri:attachment ri:filename="budget.xlsx" /></ac:parameter></ac:structured-macro>'
    );
    const local = 'See [the spec](assets/page/spec.pdf).\n\n[budget.xlsx](assets/page/budget.xlsx)';
    assert.equal(sameProse(local, live), true);
});

test('an edited file label is a change', () => {
    const live = storageToMarkdown('<p><ac:link><ri:attachment ri:filename="spec.pdf" /></ac:link></p>');
    assert.equal(sameProse('[the new spec](assets/spec.pdf)', live), false);
});

test('an external link target still counts', () => {
    const live = storageToMarkdown('<p><a href="https://a.example">x</a></p>');
    assert.equal(sameProse('[x](https://b.example)', live), false);
});

test('attachments pull could not find compare equal to the page', () => {
    const live = storageToMarkdown(
        '<p>A <ac:image><ri:attachment ri:filename="x.png" /></ac:image> ' +
            '<ac:link><ri:attachment ri:filename="gone.docx" /></ac:link></p>'
    );
    assert.equal(sameProse('A _[missing image: x.png]_ _[missing file: gone.docx]_', live), true);
});
