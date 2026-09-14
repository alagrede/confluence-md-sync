// Emphasis that a markdown reader would refuse to render.
//
// Confluence has no notion of delimiters: `<strong>Document applicable:</strong>Ce`
// is a perfectly ordinary page. Converted literally it becomes
// `**Document applicable:**Ce`, which CommonMark leaves as *text* — the closing
// `**` is preceded by punctuation and followed by a letter, so it is not
// "right-flanking" and cannot close anything (CommonMark 6.2). The bold is lost
// silently, on the page and in every editor that opens the file.
//
// Three shapes come out of real pages:
//
//     **Document applicable:**Ce document     closing preceded by punctuation
//     **Etat des lieux :**Version 1           same, the French space is inside
//     mot**:gras**                            opening followed by punctuation
//
// The repair below is the smallest one that renders: whitespace that sits
// inside the markers is moved outside them, which is lossless, and a single
// space is inserted next to a delimiter that still cannot do its job. A space
// rather than un-bolding the punctuation, because a bold label glued to its
// sentence is a typo in the source, and the space is what the author meant.

/** Unicode punctuation, as the flanking rules define it. */
const PUNCTUATION = /[\p{P}\p{S}]/u;

// The beginning and the end of a line count as whitespace, hence the empty
// string standing in for "there is nothing there".
const isWhitespace = character => character === '' || /\s/u.test(character);
const isPunctuation = character => character !== '' && PUNCTUATION.test(character);

/** Can a delimiter run sitting between these two characters open emphasis? */
function canOpen(before, first) {
    if (isWhitespace(first)) return false;
    if (!isPunctuation(first)) return true;
    return isWhitespace(before) || isPunctuation(before);
}

/** …and close it? */
function canClose(last, after) {
    if (isWhitespace(last)) return false;
    if (!isPunctuation(last)) return true;
    return isWhitespace(after) || isPunctuation(after);
}

/**
 * One emphasis run, repaired if a reader would not render it.
 * @returns {string} the replacement for `marker + content + marker`
 */
function repairRun(before, marker, content, after) {
    const run = `${marker}${content}${marker}`;
    const core = content.trim();
    const lead = content.slice(0, content.length - content.trimStart().length);
    const trail = content.slice(content.trimEnd().length);

    // Whitespace straight after the opening delimiter is the signature of text
    // that was never emphasis — `3 * 4 * 5`, `5* et 10*`. No reader renders
    // those, this converter never emits them, and "repairing" one would invent
    // an italic in the middle of a sentence. It is the one shape left alone.
    if (!core || lead) return run;

    // Whitespace moved outside the markers is whitespace the delimiters now see.
    const outerBefore = before;
    const outerAfter = trail ? ' ' : after;

    const openGap = canOpen(outerBefore, core[0]) ? '' : ' ';
    const closeGap = canClose(core[core.length - 1], outerAfter) ? '' : ' ';
    const repaired = `${openGap}${marker}${core}${marker}${closeGap}${trail}`;

    return repaired === run || openGap || closeGap || trail ? repaired : run;
}

/** Ranges of the inline code spans of a line — emphasis inside one is text. */
function codeSpans(line) {
    const SPAN = /(`+)[\s\S]*?\1/g;
    const ranges = [];
    let match;
    while ((match = SPAN.exec(line))) ranges.push([match.index, match.index + match[0].length]);
    return ranges;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// `**bold**` and `*italic*`, the two shapes this converter emits. An escaped
// `\*` is not a delimiter, and `**` is never read as two `*` runs.
const RUNS = [
    { marker: '**', pattern: /(?<!\\)\*\*([^*\n]+)\*\*/g },
    { marker: '*', pattern: /(?<![*\\])\*([^*\n]+)\*(?!\*)/g },
];

/**
 * Repairs every emphasis run of a markdown document that a CommonMark reader
 * would leave as plain text. Fenced blocks and inline code are left alone:
 * their asterisks are not delimiters in the first place.
 */
export function repairEmphasis(markdown) {
    let fenced = false;

    return String(markdown ?? '')
        .split('\n')
        .map(line => {
            const fence = line.match(FENCE);
            if (fence) {
                fenced = !fenced;
                return line;
            }
            if (fenced || !line.includes('*')) return line;

            let repaired = line;
            for (const { marker, pattern } of RUNS) {
                // Recomputed each pass: a repair shifts every offset after it,
                // and the ranges of the previous pass would point at the wrong
                // characters.
                const spans = codeSpans(repaired);
                const inCode = (from, to) => spans.some(([start, end]) => from < end && start < to);

                pattern.lastIndex = 0;
                repaired = repaired.replace(pattern, (whole, content, offset, source) => {
                    if (inCode(offset, offset + whole.length)) return whole;
                    const before = offset > 0 ? source[offset - 1] : '';
                    const after = source[offset + whole.length] ?? '';
                    return repairRun(before, marker, content, after);
                });
            }
            return repaired;
        })
        .join('\n');
}
