// Project configuration: which Confluence trees are mirrored, and where.
//
// The config file also marks the project root. Every relative path in it is
// resolved against the file's own directory, not against the current working
// directory, so the commands behave the same wherever they are run from.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from './env.mjs';

export const CONFIG_NAMES = [
    'confluence-md-sync.config.mjs',
    'confluence-md-sync.config.js',
    'confluence-md-sync.config.json',
];

export const DEFAULT_PORT = 4801;

/** What `init` writes, so the commands can name it instead of failing on HTTP. */
export const PLACEHOLDER_ROOT_ID = 'REPLACE_ME';

export class ConfigError extends Error {}

/** Walks up from `cwd` looking for a config file. */
export function findConfigFile(cwd = process.cwd()) {
    let dir = path.resolve(cwd);
    for (;;) {
        for (const name of CONFIG_NAMES) {
            const candidate = path.join(dir, name);
            if (existsSync(candidate)) return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

async function readConfigFile(file) {
    if (file.endsWith('.json')) {
        try {
            return JSON.parse(readFileSync(file, 'utf8'));
        } catch (error) {
            throw new ConfigError(`${file} is not valid JSON: ${error.message}`);
        }
    }
    const module = await import(pathToFileURL(file).href);
    // `export default {…}` is the documented shape; a bare `export const
    // sources = […]` is accepted too, since that is all some projects need.
    const raw = module.default ?? module;
    if (raw.sources || raw.SOURCES || raw.serve) return { ...raw, sources: raw.sources ?? raw.SOURCES };
    throw new ConfigError(
        `${file} exports no configuration.\n` +
            'Expected `export default { sources: [{ rootId, outDir }] }`.'
    );
}

/**
 * Reads the config from the environment alone. Enough for a single tree, and
 * the only way to run the commands in CI without committing a config file.
 */
function configFromEnv(cwd) {
    const rootId = process.env.CONFLUENCE_ROOT_ID;
    if (!rootId) return null;
    return {
        root: path.resolve(cwd),
        file: null,
        sources: [{ rootId, outDir: process.env.CONFLUENCE_OUT_DIR ?? 'docs' }],
        serve: {},
    };
}

/** Deepest directory containing every one of `dirs`. */
export function commonAncestor(dirs) {
    if (!dirs.length) return null;
    const split = dirs.map(dir => path.resolve(dir).split(path.sep));
    const [first] = split;
    let shared = 0;
    while (shared < first.length && split.every(parts => parts[shared] === first[shared])) shared++;
    return split[0].slice(0, shared).join(path.sep) || path.sep;
}

/**
 * Default directory the preview server serves.
 *
 * Taking the *parents* of the output directories means a single source in
 * `docs/specs` is served from `docs/`, so a hand-written `docs/README.md`
 * landing page is reachable alongside the mirror.
 *
 * But that must not silently widen to the whole project: with `outDir: 'docs'`
 * the parent *is* the project root, and the preview would then sit on top of
 * the source tree. In that case we serve the mirrors themselves instead. The
 * one case that still lands on the project root is mirrors in unrelated trees,
 * where nothing closer contains them both — `serve` says so on startup.
 */
function defaultServeRoot(sources, root) {
    const fromParents = commonAncestor(sources.map(source => path.dirname(source.outDir)));
    if (fromParents !== root) return fromParents;
    return commonAncestor(sources.map(source => source.outDir));
}

function normalizeSources(sources, root, file) {
    if (!Array.isArray(sources) || !sources.length) {
        throw new ConfigError(`${file ?? 'Configuration'} defines no \`sources\`. Expected at least one entry.`);
    }
    return sources.map((source, index) => {
        const where = `sources[${index}]`;
        if (!source?.rootId) throw new ConfigError(`${where} has no \`rootId\`.`);
        if (!source.outDir) throw new ConfigError(`${where} has no \`outDir\`.`);
        const outDir = path.resolve(root, source.outDir);
        if (path.relative(root, outDir).startsWith('..')) {
            throw new ConfigError(`${where}: \`outDir\` must stay inside the project (${source.outDir}).`);
        }
        return {
            rootId: String(source.rootId),
            outDir,
            // Shown as the section heading in the preview server's sidebar.
            label: source.label ?? path.relative(root, outDir),
            exclude: normalizeExclusions(source.exclude, root, outDir, `${where}.exclude`),
            pushExclude: normalizeExclusions(source.pushExclude, root, outDir, `${where}.pushExclude`),
        };
    });
}

/**
 * Pages left out of the sync. An entry made of digits is a page id, which
 * survives a rename; anything else is a path in the mirror, a directory
 * excluding everything below it. Kept in the config rather than in the
 * frontmatter, because `pull` rewrites the mirror wholesale.
 *
 * `exclude` leaves the page out of both `pull` and `push`, its descendants
 * included; `pushExclude` only stops `push` from publishing it.
 */
function normalizeExclusions(entries, root, outDir, where) {
    const exclusions = { ids: new Set(), paths: [] };
    if (entries === undefined) return exclusions;
    if (!Array.isArray(entries)) throw new ConfigError(`${where} must be an array.`);
    for (const entry of entries) {
        if (typeof entry === 'number' || /^\d+$/.test(entry)) {
            exclusions.ids.add(String(entry));
            continue;
        }
        if (typeof entry !== 'string' || !entry.trim()) {
            throw new ConfigError(`${where} entries are page ids or paths, got ${JSON.stringify(entry)}.`);
        }
        const target = path.resolve(root, entry);
        if (!isWithin(target, outDir)) {
            throw new ConfigError(
                `${where} path ${entry} is not inside ${path.relative(root, outDir)}. ` +
                    'Paths are relative to the config file, like `outDir`.'
            );
        }
        exclusions.paths.push(target);
    }
    return exclusions;
}

/** Whether `file` is `target` or lies below it. */
export function isWithin(file, target) {
    const relative = path.relative(target, path.resolve(file));
    return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function matches({ ids, paths }, mdPath, pageId) {
    if (pageId && ids.has(String(pageId))) return true;
    return paths.some(excluded => isWithin(mdPath, excluded));
}

/** Whether the page is left out of the sync entirely, by `exclude`. */
export function isExcluded(source, mdPath, pageId) {
    return matches(source.exclude, mdPath, pageId);
}

/** Whether `push` must not publish the page, by `exclude` or `pushExclude`. */
export function isPushExcluded(source, mdPath, pageId) {
    return isExcluded(source, mdPath, pageId) || matches(source.pushExclude, mdPath, pageId);
}

/**
 * @returns {Promise<{
 *   root: string, file: string|null,
 *   sources: Array<{rootId: string, outDir: string, label: string,
 *     exclude: {ids: Set<string>, paths: string[]}, pushExclude: {ids: Set<string>, paths: string[]}}>,
 *   serve: {root: string, port: number, title: string, sections: Array<{label: string, dir: string}>},
 * }>}
 */
export async function loadConfig({ cwd = process.cwd(), requireConfig = true } = {}) {
    loadEnv(cwd);

    const file = findConfigFile(cwd);
    let raw;
    let root;

    if (file) {
        root = path.dirname(file);
        raw = await readConfigFile(file);
    } else {
        const fromEnv = configFromEnv(cwd);
        if (!fromEnv) {
            if (!requireConfig) return null;
            throw new ConfigError(
                `No ${CONFIG_NAMES[0]} found in ${cwd} or any parent directory.\n` +
                    'Run `confluence-md-sync init` to create one.'
            );
        }
        ({ root } = fromEnv);
        raw = fromEnv;
    }

    const sources = normalizeSources(raw.sources, root, file);
    const serve = raw.serve ?? {};

    const serveRoot = serve.root ? path.resolve(root, serve.root) : defaultServeRoot(sources, root);

    for (const source of sources) {
        if (path.relative(serveRoot, source.outDir).startsWith('..')) {
            throw new ConfigError(
                `serve.root (${path.relative(root, serveRoot) || '.'}) does not contain ` +
                    `${path.relative(root, source.outDir)}.`
            );
        }
    }

    return {
        root,
        file,
        sources,
        serve: {
            root: serveRoot,
            port: Number(serve.port ?? process.env.CONFLUENCE_MD_SYNC_PORT ?? DEFAULT_PORT),
            title: serve.title ?? 'Documentation',
            sections: (serve.sections ?? []).map(section => ({
                label: section.label ?? section.dir,
                dir: path.resolve(root, section.dir),
            })),
        },
    };
}

/**
 * Extra checks that only matter when actually talking to Confluence. `serve`
 * never calls this: previewing local markdown needs no valid page id.
 */
export function assertSyncable(config) {
    config.sources.forEach((source, index) => {
        if (source.rootId !== PLACEHOLDER_ROOT_ID) return;
        // The placeholder left by `init`. Saying so beats an HTTP 404 later.
        throw new ConfigError(
            `sources[${index}]: \`rootId\` is still the placeholder from \`init\`.\n` +
                'Replace it with the id from your Confluence URL: ' +
                '…/spaces/SPACE/folder/123456789 → rootId: \'123456789\''
        );
    });
}
