// Markdown → Confluence "storage format" (XHTML).
//
// Deliberately limited to what people actually write when editing the mirror:
// headings, paragraphs, fenced code blocks, lists (two levels), tables,
// images, bold, italics, inline code, links (including links to attached
// files), and horizontal rules. Any other
// syntax comes out as escaped text rather than being silently dropped.

function escapeXml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(text) {
    return escapeXml(text).replace(/"/g, '&quot;');
}

function unescapeXml(text) {
    return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * Inline markup. Code spans are set aside first so that no `*` or `[` inside
 * them gets interpreted, then restored at the end of the pass. Images are set
 * aside the same way: an image in a table cell or mid-sentence would otherwise
 * be read as a `!` followed by a link.
 */
function inline(text, resolve) {
    const codeSpans = [];
    let out = text.replace(/`([^`]+)`/g, (_, code) => {
        codeSpans.push(code);
        return `@@CODE${codeSpans.length - 1}@@`;
    });
    const images = [];
    out = out.replace(INLINE_IMAGE, (_, alt, link) => {
        images.push(renderImage(resolve.image(link, alt)));
        return `@@IMG${images.length - 1}@@`;
    });

    out = escapeXml(out);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1<em>$2</em>');
    // A link label may itself contain one pair of brackets — Confluence
    // exports produce links such as [[TICKET-108] Some screen](url).
    out = out.replace(/\[((?:[^[\]]|\[[^[\]]*\])+)\]\(([^)\s]+)\)/g, (_, label, href) => {
        const filename = resolve.file(unescapeXml(href));
        if (!filename) return `<a href="${href}">${label}</a>`;
        return (
            `<ac:link><ri:attachment ri:filename="${escapeAttribute(filename)}" />` +
            `<ac:link-body>${label}</ac:link-body></ac:link>`
        );
    });
    out = out.replace(/\\([*_`[\]])/g, '$1');

    return out
        .replace(/@@IMG(\d+)@@/g, (_, index) => images[Number(index)])
        .replace(/@@CODE(\d+)@@/g, (_, index) => `<code>${escapeXml(codeSpans[Number(index)])}</code>`);
}

function renderImage(ref) {
    if (!ref) return '';
    if (ref.url) return `<ac:image><ri:url ri:value="${escapeXml(ref.url)}" /></ac:image>`;
    return (
        `<ac:image ac:alt="${escapeXml(ref.alt ?? ref.filename)}">` +
        `<ri:attachment ri:filename="${escapeXml(ref.filename)}" /></ac:image>`
    );
}

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const INLINE_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const TABLE_SEPARATOR = /^\|[\s:|-]+\|$/;

function splitRow(line) {
    return line
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(cell => cell.trim());
}

function renderList(items, resolve) {
    // The nested <ul> has to live inside its parent <li>, otherwise Confluence
    // reformats the whole list the first time the page is opened in its editor.
    const parts = [];
    items.forEach(item => {
        if (item.depth === 1 && parts.length) {
            const parent = parts[parts.length - 1];
            parent.children.push(item.text);
            return;
        }
        parts.push({ text: item.text, children: [] });
    });

    const renderItem = part => {
        const nested = part.children.length
            ? '<ul>' + part.children.map(child => `<li>${inline(child, resolve)}</li>`).join('') + '</ul>'
            : '';
        return `<li>${inline(part.text, resolve)}${nested}</li>`;
    };

    return '<ul>' + parts.map(renderItem).join('') + '</ul>';
}

/**
 * @param {string} markdown
 * @param {(localPath: string, alt: string) => ({filename?: string, url?: string, alt?: string}|null)} resolveImage
 *   Resolves a markdown image path to an attachment that has already been
 *   uploaded. Returning null drops the image from the output.
 * @param {(localPath: string) => (string|null)} resolveFile
 *   Resolves the target of a markdown link to the name of an attachment that
 *   has already been uploaded. Returning null keeps it an ordinary link.
 */
export function markdownToStorage(markdown, resolveImage = () => null, resolveFile = () => null) {
    const resolve = { image: resolveImage, file: resolveFile };
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();

        if (!trimmed) {
            index++;
            continue;
        }

        // Fenced code block → Confluence's "code" macro. Without this case the
        // lines of the block would be merged into a single paragraph.
        const fence = trimmed.match(/^```(\w*)/);
        if (fence) {
            index++;
            const body = [];
            while (index < lines.length && !lines[index].trim().startsWith('```')) {
                body.push(lines[index]);
                index++;
            }
            index++; // closing fence
            const language = fence[1]
                ? `<ac:parameter ac:name="language">${escapeXml(fence[1])}</ac:parameter>`
                : '';
            out.push(
                `<ac:structured-macro ac:name="code">${language}` +
                    `<ac:plain-text-body><![CDATA[${body.join('\n')}]]></ac:plain-text-body>` +
                    `</ac:structured-macro>`
            );
            continue;
        }

        if (/^-{3,}$/.test(trimmed)) {
            out.push('<hr />');
            index++;
            continue;
        }

        const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            const level = heading[1].length;
            out.push(`<h${level}>${inline(heading[2], resolve)}</h${level}>`);
            index++;
            continue;
        }

        const image = trimmed.match(IMAGE_LINE);
        if (image) {
            const rendered = renderImage(resolveImage(image[2], image[1]));
            if (rendered) out.push(`<p>${rendered}</p>`);
            index++;
            continue;
        }

        // Table: a header row followed by a separator row
        if (trimmed.startsWith('|') && TABLE_SEPARATOR.test((lines[index + 1] ?? '').trim())) {
            const header = splitRow(trimmed);
            index += 2;
            const body = [];
            while (index < lines.length && lines[index].trim().startsWith('|')) {
                body.push(splitRow(lines[index].trim()));
                index++;
            }
            const head = '<tr>' + header.map(cell => `<th>${inline(cell, resolve)}</th>`).join('') + '</tr>';
            const rows = body
                .map(row => '<tr>' + row.map(cell => `<td>${inline(cell, resolve)}</td>`).join('') + '</tr>')
                .join('');
            out.push(`<table><tbody>${head}${rows}</tbody></table>`);
            continue;
        }

        // Bullet list, one level of nesting (indented by two spaces or more)
        if (/^[-*]\s+/.test(trimmed)) {
            const items = [];
            while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
                const raw = lines[index];
                items.push({
                    depth: /^\s{2,}/.test(raw) ? 1 : 0,
                    text: raw.trim().replace(/^[-*]\s+/, ''),
                });
                index++;
            }
            out.push(renderList(items, resolve));
            continue;
        }

        // Paragraph: runs until a blank line or the start of the next block
        const paragraph = [];
        while (index < lines.length) {
            const current = lines[index];
            const currentTrimmed = current.trim();
            if (
                !currentTrimmed ||
                /^#{1,6}\s/.test(currentTrimmed) ||
                /^-{3,}$/.test(currentTrimmed) ||
                currentTrimmed.startsWith('```') ||
                /^\s*[-*]\s+/.test(current) ||
                currentTrimmed.startsWith('|') ||
                IMAGE_LINE.test(currentTrimmed)
            ) {
                break;
            }
            paragraph.push(currentTrimmed);
            index++;
        }
        if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '), resolve)}</p>`);
    }

    return out.join('\n');
}
