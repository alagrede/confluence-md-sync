// Minimal Confluence Cloud client, no dependencies. Basic auth (account email
// + API token), as expected by Confluence Cloud's REST v1 API.
import { loadEnv, envFileCandidates } from '../env.mjs';

export class ConfluenceError extends Error {}

const REQUIRED = ['CONFLUENCE_BASE_URL', 'CONFLUENCE_EMAIL', 'CONFLUENCE_API_TOKEN'];

const MISSING_HELP =
    'Set them in your shell, in ./.env, or in ~/.config/confluence-md-sync/env:\n' +
    '  CONFLUENCE_BASE_URL=https://your-org.atlassian.net/wiki\n' +
    '  CONFLUENCE_EMAIL=you@example.com\n' +
    '  CONFLUENCE_API_TOKEN=…\n' +
    'Create the token at https://id.atlassian.com/manage-profile/security/api-tokens';

export class ConfluenceClient {
    constructor({ cwd = process.cwd() } = {}) {
        loadEnv(cwd);
        const missing = REQUIRED.filter(key => !process.env[key]);
        if (missing.length) {
            throw new ConfluenceError(
                `Missing environment variable(s): ${missing.join(', ')}.\n\n${MISSING_HELP}\n\n` +
                    `Files consulted: ${envFileCandidates(cwd).join(', ')}`
            );
        }
        this.baseUrl = process.env.CONFLUENCE_BASE_URL.replace(/\/$/, '');
        this.host = new URL(this.baseUrl).host;
        this.auth =
            'Basic ' +
            Buffer.from(`${process.env.CONFLUENCE_EMAIL}:${process.env.CONFLUENCE_API_TOKEN}`).toString('base64');
    }

    async request(pathname, { method = 'GET', query, body, headers = {} } = {}) {
        const url = new URL(this.baseUrl + pathname);
        for (const [key, value] of Object.entries(query ?? {})) {
            if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
        }
        const response = await fetch(url, {
            method,
            headers: {
                Authorization: this.auth,
                Accept: 'application/json',
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                ...headers,
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        const text = await response.text();
        if (!response.ok) {
            let detail = text.slice(0, 400);
            try {
                detail = JSON.parse(text).message ?? detail;
            } catch {
                /* non-JSON response: keep the truncated raw text */
            }
            throw new ConfluenceError(`${method} ${url.pathname} → HTTP ${response.status}: ${detail}`);
        }
        return text ? JSON.parse(text) : null;
    }

    getPage(id, expand = 'body.storage,version,space,ancestors') {
        return this.request(`/rest/api/content/${encodeURIComponent(id)}`, { query: { expand } });
    }

    /** Direct children, in Confluence's own display order. */
    async getChildren(id) {
        const res = await this.request(`/rest/api/content/${encodeURIComponent(id)}/child/page`, {
            query: { limit: 200, expand: 'version' },
        });
        return res.results ?? [];
    }

    async getAttachments(id) {
        const res = await this.request(`/rest/api/content/${encodeURIComponent(id)}/child/attachment`, {
            query: { limit: 200 },
        });
        return res.results ?? [];
    }

    /** Finds a page by title within a space, for cross-page image references. */
    async findPageByTitle(spaceKey, title) {
        if (!spaceKey || !title) return null;
        const res = await this.request('/rest/api/content', {
            query: { spaceKey, title, limit: 1 },
        });
        return res.results?.[0] ?? null;
    }

    /**
     * Downloads an attachment. The download link redirects to Atlassian's media
     * service, so we follow the redirect by hand: the auth header must not be
     * sent to another domain.
     */
    async download(downloadPath) {
        let current = this.baseUrl + downloadPath;
        let response = await fetch(current, { headers: { Authorization: this.auth }, redirect: 'manual' });
        for (let hop = 0; hop < 5 && response.status >= 300 && response.status < 400; hop++) {
            const location = response.headers.get('location');
            if (!location) break;
            const next = new URL(location, current);
            response = await fetch(next, {
                headers: next.host === this.host ? { Authorization: this.auth } : {},
                redirect: 'manual',
            });
            current = next.toString();
        }
        if (!response.ok) throw new ConfluenceError(`Download ${downloadPath} → HTTP ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
    }

    /** Replaces a page body. Confluence requires current version + 1. */
    updatePage({ id, title, type, spaceKey, version, storage }) {
        return this.request(`/rest/api/content/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: {
                id,
                type,
                title,
                space: { key: spaceKey },
                version: { number: version + 1 },
                body: { storage: { value: storage, representation: 'storage' } },
            },
        });
    }

    /**
     * Attaches a file to a page. The /child/attachment endpoint creates a new
     * version of the attachment when the name already exists.
     */
    async uploadAttachment(pageId, filename, buffer, mimeType) {
        const form = new FormData();
        form.set('file', new Blob([buffer], { type: mimeType }), filename);
        form.set('minorEdit', 'true');
        const response = await fetch(
            `${this.baseUrl}/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`,
            {
                method: 'PUT',
                headers: { 'Authorization': this.auth, 'X-Atlassian-Token': 'no-check' },
                body: form,
            }
        );
        const text = await response.text();
        if (!response.ok) {
            throw new ConfluenceError(`Upload of ${filename} → HTTP ${response.status}: ${text.slice(0, 300)}`);
        }
        return JSON.parse(text);
    }
}

export const MIME_BY_EXTENSION = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
};
