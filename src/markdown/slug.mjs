// File names derived from Confluence page titles. These must stay stable: a
// slug that changes renames the file, and the local edits in it lose their home.

const MAX_SLUG_LENGTH = 70;

// Windows produces backslash-separated relative paths; markdown links need slashes.
const PATH_SEPARATOR = /[/\\]/;

export function slug(title) {
    const full = title
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (full.length <= MAX_SLUG_LENGTH) return full;
    // Cut on a dash so the name never ends mid-word.
    const cut = full.slice(0, MAX_SLUG_LENGTH);
    return cut.slice(0, cut.lastIndexOf('-')).replace(/-+$/g, '') || cut;
}

/** Safe file name for an attachment, extension preserved. */
export function safeFilename(name) {
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+/, '');
}

/** Relative path usable inside a markdown link. */
export function encodePath(relativePath) {
    return relativePath.split(PATH_SEPARATOR).map(encodeURIComponent).join('/');
}
