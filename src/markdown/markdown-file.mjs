// Reading and writing the mirror's .md files: YAML frontmatter (the Confluence
// page metadata) plus the body.

/**
 * Inverse of `quoteYaml`. Values are written with JSON.stringify, so a title
 * holding a double quote arrives escaped — stripping the outer quotes alone
 * would leave the backslashes in the page title.
 */
function unquote(value) {
    const trimmed = value.trim();
    if (!trimmed.startsWith('"')) return trimmed;
    try {
        return JSON.parse(trimmed);
    } catch {
        // Hand-written frontmatter that only looks quoted.
        return trimmed.replace(/^"(.*)"$/, '$1');
    }
}

/**
 * @returns {{ frontmatter: Record<string, string>, body: string }}
 */
export function parseMarkdownFile(content) {
    let rest = content;
    const frontmatter = {};

    if (rest.startsWith('---\n')) {
        const end = rest.indexOf('\n---\n', 4);
        if (end !== -1) {
            for (const line of rest.slice(4, end).split('\n')) {
                const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
                if (match) frontmatter[match[1]] = unquote(match[2]);
            }
            rest = rest.slice(end + 5);
        }
    }

    return { frontmatter, body: rest.trim() };
}

export function renderMarkdownFile({ frontmatter, body }) {
    const head = ['---', ...Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`), '---', ''];
    return [...head, body.trim(), ''].join('\n');
}

/** Frontmatter values are quoted so titles with `:` or `#` stay valid YAML. */
export function quoteYaml(value) {
    return JSON.stringify(String(value ?? ''));
}
