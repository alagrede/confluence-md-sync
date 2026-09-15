// Confluence "storage format" (XHTML) → markdown.
//
// Not exhaustive: it covers what design and specification pages actually
// contain — headings, bold, italics, lists, tables, links, images, and the
// code and panel macros. Anything else is reduced to its text content.

import { repairEmphasis } from '../markdown/emphasis.mjs';

const NAMED_ENTITIES = {
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    amp: '&',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    laquo: '«',
    raquo: '»',
    eacute: 'é',
    egrave: 'è',
    ecirc: 'ê',
    euml: 'ë',
    agrave: 'à',
    acirc: 'â',
    auml: 'ä',
    aacute: 'á',
    ugrave: 'ù',
    ucirc: 'û',
    uuml: 'ü',
    uacute: 'ú',
    igrave: 'ì',
    icirc: 'î',
    iuml: 'ï',
    iacute: 'í',
    ograve: 'ò',
    ocirc: 'ô',
    ouml: 'ö',
    oacute: 'ó',
    ccedil: 'ç',
    ntilde: 'ñ',
    Eacute: 'É',
    Egrave: 'È',
    Ecirc: 'Ê',
    Agrave: 'À',
    Acirc: 'Â',
    Ccedil: 'Ç',
    Ocirc: 'Ô',
    Ucirc: 'Û',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
    deg: '°',
    euro: '€',
    copy: '©',
    reg: '®',
    trade: '™',
    middot: '·',
    times: '×',
    divide: '÷',
    plusmn: '±',
    larr: '←',
    rarr: '→',
    uarr: '↑',
    darr: '↓',
    harr: '↔',
    szlig: 'ß',
    aelig: 'æ',
    oelig: 'œ',
    sup2: '²',
    bull: '•',
    sect: '§',
    otimes: '⊗',
    dagger: '†',
    para: '¶',
    frac12: '½',
    frac14: '¼',
    sup1: '¹',
    sup3: '³',
};

function decodeEntities(text) {
    return text
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (whole, name) =>
            Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : whole
        );
}

function stripTags(text) {
    return decodeEntities(text.replace(/<[^>]+>/g, '')).trim();
}

/**
 * `<strong>Text </strong>more` → `**Text** more`.
 *
 * Trimming the inner text, as stripTags does, would glue the two words
 * together; keeping the space inside the markers would stop the closing `**`
 * from closing anything. The space belongs outside them, which loses nothing
 * and is the shape a reader renders.
 */
function emphasise(marker, inner) {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, ''));
    const core = text.trim();
    if (!core) return text;
    const lead = text.slice(0, text.length - text.trimStart().length);
    const trail = text.slice(text.trimEnd().length);
    return `${lead}${marker}${core}${marker}${trail}`;
}

/**
 * Lists → markdown, preserving the indentation of nested levels.
 * Converting item by item does not work here: a parent <li> swallows the
 * content of its children, because its own </li> comes after theirs. So we
 * walk the tags and track depth instead.
 */
function convertLists(html) {
    const TAG = /<(\/?)(ul|ol|li)\b[^>]*>/g;
    let out = '';
    let cursor = 0;
    let depth = 0;
    let item = null; // contenu de l'item en cours, null hors d'un <li>
    let match;

    const flush = () => {
        if (item === null) return;
        const text = stripTags(item);
        if (text) out += `${'  '.repeat(Math.max(0, depth - 1))}- ${text}\n`;
        item = null;
    };

    while ((match = TAG.exec(html))) {
        const chunk = html.slice(cursor, match.index);
        cursor = TAG.lastIndex;
        if (item === null) out += chunk;
        else item += chunk;

        const [, closing, tag] = match;
        if (tag === 'li') {
            // An opening <li> closes the previous item: not every document
            // closes its list items.
            flush();
            if (!closing) item = '';
            continue;
        }
        flush();
        depth += closing ? -1 : 1;
        if (depth <= 0) {
            depth = 0;
            out += '\n';
        }
    }
    flush();
    return out + html.slice(cursor);
}

function convertTable(table) {
    const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1]);
    const lines = [];
    rows.forEach((row, index) => {
        // A cell holds whole blocks, but a markdown row is a single line: each
        // block boundary becomes a space so paragraphs do not run together.
        const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(m =>
            stripTags(m[1].replace(/<\/(?:p|h[1-6]|div)>|<br\s*\/?>/g, '\n'))
                .replace(/\s*\n\s*/g, ' ')
        );
        if (!cells.length) return;
        lines.push('| ' + cells.join(' | ') + ' |');
        if (index === 0) lines.push('| ' + cells.map(() => '---').join(' | ') + ' |');
    });
    return lines.length ? '\n' + lines.join('\n') + '\n' : '';
}

/**
 * Replaces every <ac:image> with a plain-text token before any other
 * conversion runs. A bare token survives the regexes that follow (and the
 * `stripTags` applied to table cells), whereas a `![](…)` would be eaten.
 * The collected references are resolved later, once we know where the files
 * are going to be written.
 */
function tokenizeImages(storage, refs) {
    return storage.replace(/<ac:image([^>]*)>([\s\S]*?)<\/ac:image>/g, (whole, attrs, inner) => {
        const filename = inner.match(/ri:filename="([^"]*)"/)?.[1];
        const externalUrl = inner.match(/ri:value="([^"]*)"/)?.[1];
        if (!filename && !externalUrl) return '';
        const pageTitle = inner.match(/<ri:page[^>]*ri:content-title="([^"]*)"/)?.[1];
        const alt = attrs.match(/ac:alt="([^"]*)"/)?.[1];
        // Attributes are read raw out of the storage format: without decoding,
        // an accented caption would come back encoded on every round trip.
        refs.push({
            filename: filename && decodeEntities(filename),
            externalUrl: externalUrl && decodeEntities(externalUrl),
            pageTitle: pageTitle && decodeEntities(pageTitle),
            alt: alt && decodeEntities(alt),
        });
        return `@@CIMG${refs.length - 1}@@`;
    });
}

/** Macros that embed an attached file (PDF, spreadsheet, document…) in the page. */
const FILE_MACRO =
    /<ac:structured-macro[^>]*ac:name="(?:view-file|viewpdf|viewxls|viewdoc|viewppt)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g;

/**
 * Same idea as tokenizeImages, for attachments that are not images: links to
 * an attachment and the file-preview macros. Runs after tokenizeImages, so a
 * link wrapping an image has already been reduced to its image token.
 */
function tokenizeFiles(storage, refs) {
    const collect = (inner, label) => {
        const filename = inner.match(/<ri:attachment[^>]*ri:filename="([^"]*)"/)?.[1];
        if (!filename) return null;
        const pageTitle = inner.match(/<ri:page[^>]*ri:content-title="([^"]*)"/)?.[1];
        refs.push({
            filename: decodeEntities(filename),
            pageTitle: pageTitle && decodeEntities(pageTitle),
            label: label || undefined,
        });
        return `@@CFILE${refs.length - 1}@@`;
    };

    let text = storage.replace(/<ac:link\b[^>]*>([\s\S]*?)<\/ac:link>/g, (whole, inner) => {
        if (!/<ri:attachment\b/.test(inner)) return whole;
        // A thumbnail linking to a file: the image keeps its token and the
        // file is linked right after it, under its own name.
        const images = inner.match(/@@CIMG\d+@@/g);
        const label = images
            ? ''
            : inner.match(/<ac:plain-text-link-body><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ??
              stripTags(inner.match(/<ac:link-body>([\s\S]*?)<\/ac:link-body>/)?.[1] ?? '');
        const token = collect(inner, label.trim());
        if (!token) return images ? images.join(' ') : whole;
        return images ? `${images.join(' ')} ${token}` : token;
    });
    // Block-level: kept in its own paragraph so it does not glue to the next one.
    text = text.replace(FILE_MACRO, (whole, inner) => {
        const token = collect(inner);
        return token ? `<p>${token}</p>` : '';
    });
    return text;
}

/**
 * @returns {{ markdown: string, imageRefs: Array, fileRefs: Array }} markdown
 * holding `@@CIMGn@@` tokens in place of images and `@@CFILEn@@` tokens in
 * place of other attachments, plus the matching references.
 */
export function storageToMarkdown(storage) {
    if (!storage) return { markdown: '', imageRefs: [], fileRefs: [] };
    const imageRefs = [];
    const fileRefs = [];
    let text = tokenizeFiles(tokenizeImages(storage, imageRefs), fileRefs);

    // Macros: code blocks, panels, page links
    text = text.replace(
        /<ac:structured-macro[^>]*ac:name="code"([\s\S]*?)<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/g,
        (_, params, code) => {
            const language = params.match(/ac:name="language"[^>]*>([^<]*)</)?.[1] ?? '';
            return `\n\`\`\`${language}\n${code}\n\`\`\`\n`;
        }
    );
    text = text.replace(
        /<ac:structured-macro[^>]*ac:name="(info|note|warning|tip|panel)"[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>[\s\S]*?<\/ac:structured-macro>/g,
        (_, kind, inner) => `\n> **${kind.toUpperCase()}** ${inner}\n`
    );
    // One link at a time: a pattern spanning from `<ac:link` to the next
    // `<ri:page` would swallow everything between two unrelated links.
    text = text.replace(/<ac:link\b[^>]*>([\s\S]*?)<\/ac:link>/g, (whole, inner) => {
        const title = inner.match(/<ri:page[^>]*ri:content-title="([^"]*)"/)?.[1];
        return title === undefined ? whole : `[${title}]`;
    });
    text = text.replace(/<ac:structured-macro[\s\S]*?<\/ac:structured-macro>/g, '');
    text = text.replace(/<ac:[^>]*>/g, '').replace(/<\/ac:[^>]*>/g, '');
    text = text.replace(/<ri:[^>]*\/?>/g, '');

    for (let level = 1; level <= 6; level++) {
        text = text.replace(
            new RegExp(`<h${level}[^>]*>([\\s\\S]*?)</h${level}>`, 'g'),
            (_, inner) => `\n${'#'.repeat(level)} ${stripTags(inner)}\n`
        );
    }

    text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/g, (_, __, inner) => emphasise('**', inner));
    text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/g, (_, __, inner) => emphasise('*', inner));
    text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/g, (_, inner) => `\`${stripTags(inner)}\``);
    text = text.replace(
        /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
        (_, href, inner) => `[${stripTags(inner)}](${href})`
    );
    text = convertLists(text);
    text = text.replace(/<table[\s\S]*?<\/table>/g, table => convertTable(table));
    text = text.replace(/<\/p>/g, '\n\n').replace(/<p[^>]*>/g, '');
    text = text.replace(/<br\s*\/?>/g, '\n');
    text = text.replace(/<hr\s*\/?>/g, '\n---\n');
    text = text.replace(/<[^>]+>/g, '');
    text = decodeEntities(text);
    // Last, because it reads the characters around each delimiter and those are
    // only final once the tags are gone and the entities are decoded.
    text = repairEmphasis(text);
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    return { markdown: text, imageRefs, fileRefs };
}

/**
 * Puts each image alone on its own line, except inside a table cell where the
 * row must stay on one line. Surrounding spaces are absorbed into the break so
 * the split leaves no trailing whitespace behind.
 */
export function isolateImages(markdown) {
    const IMAGE = /[ \t]*(!\[[^\]]*\]\([^)]*\))[ \t]*/g;
    return markdown
        .split('\n')
        .map(line => (line.trim().startsWith('|') ? line : line.replace(IMAGE, '\n\n$1\n\n')))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n');
}
