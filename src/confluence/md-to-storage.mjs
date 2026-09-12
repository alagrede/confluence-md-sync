// Markdown → Confluence "storage format" (XHTML).
//
// Deliberately limited to what people actually write when editing the mirror:
// headings, paragraphs, fenced code blocks, lists (two levels), tables,
// images, bold, italics, inline code, links, and horizontal rules. Any other
// syntax comes out as escaped text rather than being silently dropped.

function escapeXml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Inline markup. Code spans are set aside first so that no `*` or `[` inside
 * them gets interpreted, then restored at the end of the pass.
 */
function inline(text) {
    const codeSpans = [];
    let out = text.replace(/`([^`]+)`/g, (_, code) => {
        codeSpans.push(code);
        return `@@CODE${codeSpans.length - 1}@@`;
    });

    out = escapeXml(out);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1<em>$2</em>');
    // A link label may itself contain one pair of brackets — Confluence
    // exports produce links such as [[TICKET-108] Some screen](url).
    out = out.replace(/\[((?:[^[\]]|\[[^[\]]*\])+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    out = out.replace(/\\([*_`[\]])/g, '$1');

    return out.replace(/@@CODE(\d+)@@/g, (_, index) => `<code>${escapeXml(codeSpans[Number(index)])}</code>`);
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
const TABLE_SEPARATOR = /^\|[\s:|-]+\|$/;

function splitRow(line) {
    return line
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(cell => cell.trim());
}

function renderList(items) {
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
            ? '<ul>' + part.children.map(child => `<li>${inline(child)}</li>`).join('') + '</ul>'
            : '';
        return `<li>${inline(part.text)}${nested}</li>`;
    };

    return '<ul>' + parts.map(renderItem).join('') + '</ul>';
}

/**
 * @param {string} markdown
 * @param {(localPath: string, alt: string) => ({filename?: string, url?: string, alt?: string}|null)} resolveImage
 *   Resolves a markdown image path to an attachment that has already been
 *   uploaded. Returning null drops the image from the output.
 */
export function markdownToStorage(markdown, resolveImage = () => null) {
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
            out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
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
            const head = '<tr>' + header.map(cell => `<th>${inline(cell)}</th>`).join('') + '</tr>';
            const rows = body
                .map(row => '<tr>' + row.map(cell => `<td>${inline(cell)}</td>`).join('') + '</tr>')
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
            out.push(renderList(items));
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
        if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    }

    return out.join('\n');
}
