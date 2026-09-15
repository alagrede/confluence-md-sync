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
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
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
 * Whether a file of a type the allowlist does not cover may still be handed
 * out, as a download: only inside a folder named assets/, which is where pull
 * puts a page's attachments (a .zip, a video, an .msg) and where an editor puts
 * what is pasted. The allowlist stays the rule everywhere else — a project's
 * .key or config.js is not an attachment of anything.
 */
export function isAttachment(root, file) {
    return path.relative(root, path.dirname(file)).split(path.sep).includes('assets');
}

/**
 * Whether the request was addressed to this machine by a name that cannot be
 * someone else's: a loopback name, an IP literal or a .local name. A public
 * domain resolving to 127.0.0.1 is DNS rebinding — a page on the attacker's
 * origin reading this server as if it were its own. Attachments are refused
 * to such a request: they are exactly the files the allowlist does not vouch
 * for.
 */
export function isLocalHost(hostHeader) {
    let hostname;
    try {
        hostname = new URL(`http://${hostHeader ?? ''}`).hostname;
    } catch {
        return false;
    }
    return (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname.startsWith('[') ||
        /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
    );
}

/**
 * Response headers for a file the preview hands out, or null when it must be
 * refused. An allowlisted type is served as itself; an attachment downloads.
 * nosniff on both, so a .png holding HTML stays an image; and an SVG opened on
 * its own runs no script, which a document from Confluence could carry.
 */
export function assetHeaders(root, file, hostHeader) {
    const mime = mimeFor(file);
    if (mime) {
        return {
            'Content-Type': mime,
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff',
            ...(mime.startsWith('image/svg') ? { 'Content-Security-Policy': 'sandbox' } : {}),
        };
    }
    if (!isAttachment(root, file) || !isLocalHost(hostHeader)) return null;
    return {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
    };
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
