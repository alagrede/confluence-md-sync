// Markdown → HTML, for the local preview server.
//
// Deliberately separate from confluence/md-to-storage.mjs: this one targets the
// browser, so it covers what Confluence's storage format cannot render —
// blockquotes, ordered lists and heading anchors.

import { parseMarkdownFile } from './markdown-file.mjs';

const FRONTMATTER_BLOCK = /^---\n[\s\S]*?\n---\n/;

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Stable anchor id derived from the heading text. */
export function anchor(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** Inline markup. Code spans first, so no marker inside them is interpreted. */
function inline(text) {
    const codeSpans = [];
    let out = text.replace(/`([^`]+)`/g, (_, code) => {
        codeSpans.push(code);
        return `@@CODE${codeSpans.length - 1}@@`;
    });

    out = escapeHtml(out);
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />');
    // A link label may itself contain one pair of brackets — Confluence
    // exports produce links such as [[TICKET-108] Some screen](url).
    out = out.replace(/\[((?:[^[\]]|\[[^[\]]*\])+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    // Bare URLs in angle brackets, which escaping turned into &lt;…&gt;
    out = out.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1<em>$2</em>');

    // Markdown escapes: a source \* must come out as a literal *
    out = out.replace(/\\([*_`[\]#])/g, '$1');

    return out.replace(/@@CODE(\d+)@@/g, (_, index) => `<code>${escapeHtml(codeSpans[Number(index)])}</code>`);
}

const TABLE_SEPARATOR = /^\|[\s:|-]+\|$/;

function splitRow(line) {
    return line
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(cell => cell.trim());
}

/** One list, with a single level of nesting. `ordered` only changes the tag. */
function renderList(items, ordered) {
    const tag = ordered ? 'ol' : 'ul';
    const parts = [];
    items.forEach(item => {
        if (item.depth === 1 && parts.length) {
            parts[parts.length - 1].children.push(item.text);
            return;
        }
        parts.push({ text: item.text, children: [] });
    });
    const renderItem = part => {
        const nested = part.children.length
            ? `<ul>${part.children.map(child => `<li>${inline(child)}</li>`).join('')}</ul>`
            : '';
        return `<li>${inline(part.text)}${nested}</li>`;
    };
    return `<${tag}>${parts.map(renderItem).join('')}</${tag}>`;
}

/**
 * @param {string} markdown
 * @returns {{ html: string, headings: Array<{level: number, text: string, id: string}> }}
 */
export function markdownToHtml(markdown) {
    const lines = markdown.replace(FRONTMATTER_BLOCK, '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    const headings = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();

        if (!trimmed) {
            index++;
            continue;
        }

        // Fenced code block
        const fence = trimmed.match(/^```(\w*)/);
        if (fence) {
            index++;
            const body = [];
            while (index < lines.length && !lines[index].trim().startsWith('```')) {
                body.push(lines[index]);
                index++;
            }
            index++; // closing fence
            const language = fence[1] ? ` data-lang="${escapeHtml(fence[1])}"` : '';
            out.push(`<pre${language}><code>${escapeHtml(body.join('\n'))}</code></pre>`);
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
            const text = heading[2];
            const id = anchor(text);
            headings.push({ level, text, id });
            out.push(`<h${level} id="${id}"><a class="anchor" href="#${id}">#</a>${inline(text)}</h${level}>`);
            index++;
            continue;
        }

        // Blockquote: consecutive lines form a single block
        if (trimmed.startsWith('>')) {
            const quoted = [];
            while (index < lines.length && lines[index].trim().startsWith('>')) {
                quoted.push(lines[index].trim().replace(/^>\s?/, ''));
                index++;
            }
            out.push(`<blockquote>${markdownToHtml(quoted.join('\n')).html}</blockquote>`);
            continue;
        }

        if (trimmed.startsWith('|') && TABLE_SEPARATOR.test((lines[index + 1] ?? '').trim())) {
            const header = splitRow(trimmed);
            index += 2;
            const body = [];
            while (index < lines.length && lines[index].trim().startsWith('|')) {
                body.push(splitRow(lines[index].trim()));
                index++;
            }
            const head = `<tr>${header.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr>`;
            const rows = body
                .map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`)
                .join('');
            out.push(`<div class="table-wrap"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`);
            continue;
        }

        const bulletMatch = /^\s*([-*])\s+/;
        const orderedMatch = /^\s*\d+\.\s+/;
        if (bulletMatch.test(line) || orderedMatch.test(line)) {
            const ordered = orderedMatch.test(line) && !bulletMatch.test(line);
            const items = [];
            while (index < lines.length && (bulletMatch.test(lines[index]) || orderedMatch.test(lines[index]))) {
                const raw = lines[index];
                items.push({
                    depth: /^\s{2,}/.test(raw) ? 1 : 0,
                    text: raw.trim().replace(bulletMatch, '').replace(orderedMatch, ''),
                });
                index++;
            }
            out.push(renderList(items, ordered));
            continue;
        }

        // Image alone on its line: kept out of a paragraph so it can be centred
        if (/^!\[[^\]]*\]\([^)\s]+\)$/.test(trimmed)) {
            out.push(`<figure>${inline(trimmed)}</figure>`);
            index++;
            continue;
        }

        const paragraph = [];
        while (index < lines.length) {
            const current = lines[index];
            const currentTrimmed = current.trim();
            if (
                !currentTrimmed ||
                /^#{1,6}\s/.test(currentTrimmed) ||
                /^-{3,}$/.test(currentTrimmed) ||
                currentTrimmed.startsWith('```') ||
                currentTrimmed.startsWith('>') ||
                currentTrimmed.startsWith('|') ||
                bulletMatch.test(current) ||
                orderedMatch.test(current) ||
                /^!\[[^\]]*\]\([^)\s]+\)$/.test(currentTrimmed)
            ) {
                break;
            }
            paragraph.push(currentTrimmed);
            index++;
        }
        if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    }

    return { html: out.join('\n'), headings };
}

/** Frontmatter of a .md file, rendered as the page header by the server. */
export function readFrontmatter(markdown) {
    return parseMarkdownFile(markdown).frontmatter;
}
