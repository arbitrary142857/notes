# notes.jasonmao.me

MIT course notes, built as static HTML from LaTeX.

Live site: [https://notes.jasonmao.me/](https://notes.jasonmao.me/)

## Layout

```
courses/
  6.1220/
    preamble.tex
    notes/lecture-*.tex
    images/lecture-NN/...
    audio/lecture-NN/...
  18.701/
    preamble.tex
    notes/lecture-*.tex
    images/...
```

Each course has its own preamble, notes, images, and audio. `courses/` holds only sources; the build assembles the entire publishable site into `dist/` (gitignored) and copies each course's `images/` and `audio/` alongside its pages.

URLs are:

| Page | URL | Generated file |
| --- | --- | --- |
| Site home | `/` | `dist/index.html` |
| Course TOC | `/18.701/` | `dist/18.701/index.html` |
| Lecture | `/18.701/lectures/1/` | `dist/18.701/lectures/1/index.html` |

Every link in the generated HTML — and every internal `\href` in the notes — is root-relative (`/18.701/lectures/1/#anchor`), so no page depends on its own directory depth. Cross-course links use the same form.

### Images and audio in notes

Images use `\includegraphics` (extension optional if a matching file exists under `images/`):

```tex
\includegraphics[width=0.4\textwidth]{lecture-15/spectrogram}
```

Audio uses `\includeaudio` with the same path convention under `audio/`:

```tex
\includeaudio[width=0.6\textwidth]{lecture-15/sound}
```

Omit the extension when a unique match exists (`.wav`, `.mp3`, `.ogg`, etc.). Optional `\graphicspath` and `\audiopath` in the preamble override the default directories.

### Code in notes

Multi-line code is a `verbatim` environment with an optional language for syntax highlighting (`c` and `python` are registered in `src/highlight.ts`):

```tex
\begin{verbatim}[c]
int
main()
{
  char buf[64];
  int n = read(0, buf, sizeof(buf));
}
\end{verbatim}
```

Inline code is `\verb`, with the same optional language:

```tex
\verb[c]|read(int fd, void *buf, int size)| returns the number of bytes read into \verb|buf|.
```

The delimiter is any non-alphanumeric character (`|`, `+`, `!`, …), so pick one the snippet does not contain. Content between the delimiters is literal — `%`, `_`, `#`, `\` and `$` need no escaping — but it must stay on one line. Omit the language to get plain monospace instead of colors.

Adding a language: import it from `highlight.js/lib/languages/` and add it to `LANGUAGES` in `src/highlight.ts`. Colors come from `highlight/github.css`, which is scoped to `.verbatim` so blocks and inline snippets share one theme.

## Local development

```bash
npm install
npm run build    # one-off build
npm run watch    # rebuild when notes change
```

The dev loop is two processes side by side:

1. `npm run watch` — rebuilds `dist/` whenever a `.tex`, image, template, or `src/` file changes.
2. A static server rooted at `dist/` — VS Code Live Server with `"liveServer.settings.root": "/dist"` (click **Go Live**, then browse `http://127.0.0.1:5501/`), or `npx serve dist` if you don't want the extension.

Live Server must be stopped and restarted after changing its root setting; it does not pick that up while running. Use **Go Live** and navigate from `/` rather than right-clicking a file — files under `courses/` are outside the server root.

Opening a generated file directly via `file://` will not work: links are root-relative and need a server root.

The build rewrites `dist/` in place instead of wiping it, writing only files whose content actually changed and pruning anything it no longer produces. That keeps the served tree valid at every instant (no 404 mid-rebuild) and means one edit triggers one reload. Each build prints how many files changed. If assets ever look stale, `rm -rf dist && npm run build` is the reset.

## Deploy (GitHub Pages)

Pushes to `main` deploy via GitHub Actions. In repo settings, set **Pages → Source** to **GitHub Actions**.

The workflow runs `npm run build` and publishes `dist/` as-is, so the deployed tree is exactly what a local build produces. Note that `.tex` sources are not copied into `dist/` and so are not served by the site.

### Custom domain

The site is served at `https://notes.jasonmao.me`. The GitHub repo keeps its original `arbitrary142857.github.io` name; only the served domain changed.

`SITE_ORIGIN` in `src/site.ts` is the single source of truth for the host. The build derives `SITE_HOST` from it and writes `dist/CNAME`, which is what GitHub Pages reads to serve the custom domain. A repo-root `CNAME` does not work here: the deployed artifact is `dist/`, and `pruneStale` deletes anything in `dist/` the build did not produce, so the file has to be generated rather than committed.

DNS lives in Cloudflare:

| Type | Name | Target | Proxy |
| --- | --- | --- | --- |
| CNAME | `notes` | `arbitrary142857.github.io` | DNS only (grey cloud) |

The record must stay **DNS only**. Proxying it (orange cloud) blocks GitHub's HTTP-01 certificate challenge, so the certificate never issues and **Enforce HTTPS** stays greyed out. Because the record is unproxied, Cloudflare's SSL/TLS mode and "Always Use HTTPS" settings do not apply to this hostname.

To move to another domain later: edit `SITE_ORIGIN`, rebuild, then update the Cloudflare record and the custom domain in repo settings. Nothing else in the repo hardcodes the host.

### Analytics

Cloudflare Web Analytics runs from a beacon `<script>` at the end of `template.html`, so every generated page carries it. The site token in `data-cf-beacon` is public by design (every visitor downloads it) and grants no account access, so it lives in the repo rather than in a secret. The beacon is used instead of Cloudflare's automatic injection because the DNS record is unproxied — no traffic passes through Cloudflare's edge for it to inject into.

### Sitemap and robots

The build writes `sitemap.xml` and `robots.txt` at the site root, with absolute URLs derived from `SITE_ORIGIN`. Every page the build writes appears in the sitemap exactly once: `assertSitemapMatchesOutput` in `src/build.ts` compares the sitemap paths against the files actually produced and throws if they disagree, so a sitemap advertising 404s cannot reach a deploy.

Search Console is verified with a **DNS TXT record on the `jasonmao.me` domain property**, which covers every subdomain. (The old `google*.html` file was a per-property token scoped to the `.github.io` origin and has been removed.) Submit the sitemap in [Google Search Console](https://search.google.com/search-console) under **Sitemaps** → `https://notes.jasonmao.me/sitemap.xml`.

## Adding a course

1. Create `courses/<course-id>/` with `preamble.tex`, `notes/`, `images/`, and `audio/` as needed. Seed `preamble.tex` by copying the most recent course's and editing the header comment, then tune colors and environments to taste — an empty preamble builds without error but leaves every macro the notes use (`\graphicspath`, `proof`, `remark`, …) undefined.
2. Add an entry to `COURSES` in `src/courses.ts` (`id`, `title`, `subtitle`, plus `semester` and `summary`, which fill the course's card on the site home page).
3. Name the course in `siteHomeDescription` in `src/build.ts`. That string is the home page's meta description and is hand-written rather than derived from `COURSES`, so `assertHomeDescriptionNamesEveryCourse` fails the build until it mentions the new course number. Keep it under 155 characters (`META_DESCRIPTION_LIMIT`), and name subjects the way someone would search for them.
4. Run `npm run build`.

Use `\lecture{N}` or `\lectures{N,M}` in note file headers, as before.

## Course table of contents (parts)

For a multi-part TOC (e.g. 18.701’s six units), edit `courses/<course-id>/toc-sections.ts`:

```ts
export const TOC_PARTS = [
  { title: "Groups", from: 1, to: 4 },
  // ...
];
```

Register the file in `src/toc-sections.ts` (`TOC_PARTS_BY_COURSE`). Courses without an entry keep a flat lecture list.
