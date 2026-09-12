// Path and content-type decisions for the preview server, kept out of the
// command so the security-relevant rules are directly testable.
//
// The server's root can legitimately be wider than the mirror itself (a
// hand-written landing page sits next to it, and two mirrors in unrelated
// trees force the root up to the project). So "inside the root" is not enough
// on its own — these two rules carry the rest.
import path from 'node:path';

/**
 * Content types the preview serves. This is an allowlist, not a lookup with a
 * fallback: an unknown extension under the root is not a documentation asset,
 * and streaming it as octet-stream would hand out whatever it happens to be —
 * a .env, a key, a source file.
 */
export const MIME = {
    // No '.md' entry: markdown is rendered to HTML before this table is
    // consulted, so a dead entry here would only be misleading.
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.css': 'text/css; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
};

/** Content type for a file the allowlist covers, else null. */
export function mimeFor(file) {
    return MIME[path.extname(file).toLowerCase()] ?? null;
}

/**
 * Resolves a request path to a file under `root`.
 *
 * @returns {string|null} the absolute path, or null when the request must be
 *   refused: malformed encoding, an escape from the root, or a dotted path
 *   segment. Dotted segments are never documentation, and refusing them keeps
 *   `.env`, `.git/` and `.ssh/` out of reach whatever the root turns out to be.
 */
export function resolveServedPath(root, urlPath) {
    let decoded;
    try {
        decoded = decodeURIComponent(urlPath.split('?')[0]);
    } catch {
        return null; // malformed percent-encoding
    }

    // A NUL byte truncates the path in some syscalls; refuse it outright.
    if (decoded.includes('\0')) return null;

    const target = path.resolve(root, '.' + decoded);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    if (relative && relative.split(path.sep).some(segment => segment.startsWith('.'))) return null;

    return target;
}
