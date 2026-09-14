// The flanking rules are the part of CommonMark nobody remembers, and the part
// Confluence pages break constantly. Each test below is a shape seen on a real
// page, checked against what a reader would do with it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repairEmphasis } from '../src/markdown/emphasis.mjs';

test('a bold label glued to its sentence gets the space that makes it render', () => {
    // `**` preceded by punctuation and followed by a letter is not
    // right-flanking, so CommonMark leaves the whole line as plain text.
    assert.equal(
        repairEmphasis('**Document applicable:**Ce document décrit…'),
        '**Document applicable:** Ce document décrit…'
    );
});

test('the French space before a colon does not change the diagnosis', () => {
    assert.equal(repairEmphasis('**Etat des lieux :**Version 1'), '**Etat des lieux :** Version 1');
});

test('a space inside the markers is moved out, not dropped', () => {
    // Trimming it would glue the words; keeping it there stops the run closing.
    assert.equal(repairEmphasis('**Texte **suite'), '**Texte** suite');
});

test('an opening delimiter that cannot open is repaired too', () => {
    assert.equal(repairEmphasis('mot**:gras**'), 'mot **:gras**');
});

test('italics break the same way, and are repaired the same way', () => {
    assert.equal(repairEmphasis('un *italique :*collé'), 'un *italique :* collé');
});

test('emphasis that already renders is left exactly as it is', () => {
    const line = '**Déjà correct** et *aussi*, 2*3*4 compris.';
    assert.equal(repairEmphasis(line), line);
});

test('prose asterisks are not turned into emphasis', () => {
    // Whitespace straight after the opening delimiter is the signature of text
    // that was never emphasis. Repairing it would invent an italic mid-sentence.
    assert.equal(repairEmphasis('liste 3 * 4 * 5'), 'liste 3 * 4 * 5');
    assert.equal(repairEmphasis('Prix : 5* et 10* de remise'), 'Prix : 5* et 10* de remise');
    assert.equal(repairEmphasis('** **'), '** **');
});

test('asterisks inside code are not delimiters', () => {
    assert.equal(repairEmphasis('`**code:**inline`'), '`**code:**inline`');
    assert.equal(
        repairEmphasis('```\n**Document applicable:**Ce\n```'),
        '```\n**Document applicable:**Ce\n```'
    );
});

test('a line can hold several runs, broken and intact', () => {
    assert.equal(repairEmphasis('**a** et **b:**c'), '**a** et **b:** c');
});

test('an escaped asterisk is not a delimiter', () => {
    assert.equal(repairEmphasis('2 \\*\\* 3'), '2 \\*\\* 3');
});
