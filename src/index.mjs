// Library entry point, for using the converters without the CLI.
//
// The interesting pair is storageToMarkdown / markdownToStorage: they are pure,
// dependency-free functions over strings, so they are usable on their own —
// a CI check that a page round-trips, a one-off migration script, a bot that
// posts markdown to Confluence.

export { storageToMarkdown, isolateImages } from './confluence/storage-to-md.mjs';
export { markdownToStorage } from './confluence/md-to-storage.mjs';
export { ConfluenceClient, ConfluenceError, MIME_BY_EXTENSION } from './confluence/client.mjs';
export { markdownToHtml, readFrontmatter, anchor } from './markdown/md-to-html.mjs';
export { repairEmphasis } from './markdown/emphasis.mjs';
export { parseMarkdownFile, renderMarkdownFile, quoteYaml } from './markdown/markdown-file.mjs';
export { slug, safeFilename, encodePath } from './markdown/slug.mjs';
export { loadConfig, findConfigFile, ConfigError } from './config.mjs';
export { loadEnv, envFileCandidates } from './env.mjs';
