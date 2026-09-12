// Stylesheet for the preview server, inlined into every page so the server
// serves no assets of its own. Light and dark are driven by the reader's
// system setting; `--accent` is the one value worth changing to rebrand it.

export const STYLE = `
:root {
    color-scheme: light dark;
    --bg: #fbfbfd; --fg: #1c1c22; --muted: #6a6a78; --line: #e2e2ea;
    --accent: #3b2f95; --code-bg: #f2f2f7; --side-bg: #f6f6fa; --mark: #fff8e0;
}
@media (prefers-color-scheme: dark) {
    :root {
        --bg: #16161a; --fg: #e6e6ea; --muted: #9a9aa8; --line: #2c2c34;
        --accent: #a99cf5; --code-bg: #22222a; --side-bg: #1b1b20; --mark: #3a3320;
    }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
    font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: grid; grid-template-columns: 300px minmax(0, 1fr); }
nav { position: sticky; top: 0; align-self: start; height: 100vh; overflow-y: auto;
    background: var(--side-bg); border-right: 1px solid var(--line); padding: 20px 16px 40px; }
nav h1 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted);
    margin: 22px 0 8px; font-weight: 600; }
nav h1:first-child { margin-top: 0; }
nav a { display: block; padding: 4px 8px; border-radius: 5px; color: var(--fg);
    text-decoration: none; font-size: 13.5px; }
nav a:hover { background: var(--line); }
nav a.current { background: var(--accent); color: #fff; }
nav a.depth-1, nav a.depth-2, nav a.depth-3 { font-size: 13px; color: var(--muted); }
nav a.depth-1 { margin-left: 14px; }
nav a.depth-2 { margin-left: 28px; }
nav a.depth-3 { margin-left: 42px; }
nav a.current { color: #fff; }
main { padding: 40px 48px 120px; min-width: 0; }
article { max-width: 76ch; }
.meta { font-size: 13px; color: var(--muted); border-bottom: 1px solid var(--line);
    padding-bottom: 12px; margin-bottom: 28px; display: flex; flex-wrap: wrap; gap: 6px 16px; }
.meta a { color: var(--accent); }
h1, h2, h3, h4 { line-height: 1.25; margin: 1.8em 0 .6em; }
h1 { font-size: 27px; margin-top: 0; }
h2 { font-size: 21px; border-bottom: 1px solid var(--line); padding-bottom: .3em; }
h3 { font-size: 17px; }
a { color: var(--accent); }
.anchor { float: left; margin-left: -1.1em; padding-right: .3em; color: var(--line);
    text-decoration: none; font-weight: 400; opacity: 0; }
h1:hover .anchor, h2:hover .anchor, h3:hover .anchor, h4:hover .anchor { opacity: 1; }
code { background: var(--code-bg); padding: .12em .35em; border-radius: 4px;
    font-size: .88em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
pre { background: var(--code-bg); padding: 14px 16px; border-radius: 8px; overflow-x: auto;
    border: 1px solid var(--line); }
pre code { background: none; padding: 0; font-size: 13px; }
blockquote { margin: 1.2em 0; padding: 2px 18px; border-left: 3px solid var(--accent);
    background: var(--mark); border-radius: 0 6px 6px 0; }
blockquote > :first-child { margin-top: .6em; } blockquote > :last-child { margin-bottom: .6em; }
.table-wrap { overflow-x: auto; margin: 1.2em 0; }
table { border-collapse: collapse; font-size: 13.5px; }
th, td { border: 1px solid var(--line); padding: 7px 11px; text-align: left; vertical-align: top; }
th { background: var(--code-bg); font-weight: 600; }
figure { margin: 1.4em 0; }
img { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; }
figure img { display: block; }
hr { border: none; border-top: 1px solid var(--line); margin: 2.4em 0; }
.toc { background: var(--side-bg); border: 1px solid var(--line); border-radius: 8px;
    padding: 12px 18px; margin-bottom: 32px; font-size: 13.5px; }
.toc strong { display: block; margin-bottom: 6px; font-size: 12px; text-transform: uppercase;
    letter-spacing: .06em; color: var(--muted); }
.toc ul { margin: 0; padding-left: 18px; }
.notfound { color: var(--muted); }
@media (max-width: 900px) {
    body { grid-template-columns: 1fr; }
    nav { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--line); }
    main { padding: 24px 20px 80px; }
}
`;
