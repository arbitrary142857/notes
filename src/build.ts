import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COURSES,
  courseDir,
  courseNotesDir,
  coursePreamblePath,
  courseSiteDir,
} from "./courses.js";
import {
  courseLabel,
  coursePageTitle,
  formatLectureLabel,
  lectureDescription,
  lectureHeaderHtml,
  lecturePageTitle,
  lectureSlug,
  loadNotes,
  type Note,
} from "./notes.js";
import { parseTex, renderInlineFragment, titleDisplayText, extractSubsections } from "./parser.js";
import { SITE_HOST, SITE_META_TITLE, SITE_PAGE_TITLE, siteUrl } from "./site.js";
import { createLastmod } from "./lastmod.js";
import { getTocParts, groupNotesByTocParts, type TocPart } from "./toc-sections.js";
import { lectureNavHtml } from "./lecture-nav.js";
import { lectureNavbarHtml } from "./lecture-navbar.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const templatePath = join(root, "template.html");
const katexDist = join(root, "node_modules/katex/dist");
const katexOut = join(distDir, "katex");

/** Where search results stop rendering a description; longer text is indexed but unseen. */
const META_DESCRIPTION_LIMIT = 155;

const template = readFileSync(templatePath, "utf8");

mkdirSync(distDir, { recursive: true });

// dist/ is rewritten in place rather than wiped: a dev server may be serving it,
// and deleting the tree would 404 every request mid-build. Instead each output is
// written only when its content actually changed, and whatever this build did not
// produce is pruned at the end. One edit then means one file change, so the dev
// server reloads once instead of reacting to the whole tree.
const producedPaths = new Set<string>();
let changedCount = 0;

function writeIfChanged(path: string, content: string): void {
  producedPaths.add(path);
  if (existsSync(path) && readFileSync(path, "utf8") === content) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  changedCount++;
}

/**
 * Mirror a file or directory into dist/, copying only entries that changed.
 *
 * Freshness is size plus mtime, since copyFileSync does not preserve mtimes and
 * so an exact comparison would never match. A source replaced by an *older* file
 * of identical size is therefore missed; `rm -rf dist` is the escape hatch.
 */
function syncPath(from: string, to: string): void {
  const source = statSync(from);
  if (source.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) syncPath(join(from, entry), join(to, entry));
    return;
  }
  producedPaths.add(to);
  if (existsSync(to)) {
    const dest = statSync(to);
    if (dest.size === source.size && dest.mtimeMs >= source.mtimeMs) return;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  changedCount++;
}

/** Delete anything under dist/ this build did not produce, then drop empty dirs. */
function pruneStale(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      pruneStale(path);
      // Recursing first lets nested orphan trees collapse from the bottom up.
      if (readdirSync(path).length === 0) rmdirSync(path);
    } else if (!producedPaths.has(path)) {
      unlinkSync(path);
      changedCount++;
    }
  }
}

interface ParsedNote {
  note: Note;
  result: ReturnType<typeof parseTex>;
  titleHtml: string;
  titlePlain: string;
}

const parsedByCourse = new Map<string, ParsedNote[]>();
const lastmod = createLastmod(root);

interface SitemapEntry {
  path: string;
  /** W3C datetime, or null when git history cannot date the page. */
  lastmod: string | null;
}

// The home page renders only the course cards defined in src/, so nothing beyond the
// site-wide sources dates it.
const sitemapEntries: SitemapEntry[] = [{ path: "/", lastmod: lastmod([]) }];

interface PageSeo {
  description: string;
  canonicalPath: string;
}

for (const course of COURSES) {
  const courseRoot = courseDir(root, course.id);
  const notesDir = courseNotesDir(root, course.id);
  const preamblePath = coursePreamblePath(root, course.id);
  const preamble = existsSync(preamblePath) ? readFileSync(preamblePath, "utf8") : "";
  const notes = loadNotes(notesDir, course.id);
  const parsed = notes.map((note) => ({
    note,
    result: parseTex(note.source, preamble, courseRoot, "images", "audio", "widgets"),
    titleHtml: renderInlineFragment(note.title, preamble, courseRoot),
    titlePlain: titleDisplayText(note.title),
  }));
  parsedByCourse.set(course.id, parsed);

  const siteDir = courseSiteDir(root, course.id);
  const lecturesOutDir = join(siteDir, "lectures");
  mkdirSync(lecturesOutDir, { recursive: true });

  // Images and audio are published at /<courseId>/, so course-relative asset
  // URLs from the parser resolve there from any page depth.
  const coursePrefix = `/${course.id}/`;
  for (const { note, result, titleHtml, titlePlain } of parsed) {
    const slug = lectureSlug(note.lectures);
    const pageTitle = lecturePageTitle(note, course.title, titlePlain);
    const canonicalPath = `/${course.id}/lectures/${slug}/`;
    const subsections = extractSubsections(note.source).map(({ slug, titleTex }) => ({
      slug,
      titleHtml: renderInlineFragment(titleTex, preamble, courseRoot),
    }));
    const navbar = lectureNavbarHtml({
      homeHref: "/",
      courseHref: coursePrefix,
      courseTitle: course.title,
      lectureLabel: formatLectureLabel(note.lectures),
      subsections,
    });
    const header = lectureHeaderHtml(note, course.title, titleHtml);
    const footer = lectureNavHtml(
      parsed.map(({ note, titleHtml }) => ({ note, titleHtml })),
      note,
    );
    const lectureOutDir = join(lecturesOutDir, slug);
    mkdirSync(lectureOutDir, { recursive: true });
    writePage(
      join(lectureOutDir, "index.html"),
      pageTitle,
      coursePrefix,
      `${navbar}${header}\n${result.html}\n${footer}`,
      {
        description: lectureDescription(note, course.title, course.subtitle, titlePlain),
        canonicalPath,
      },
    );
    sitemapEntries.push({
      path: canonicalPath,
      lastmod: lastmod(lectureSourcePaths(course.id, note.filename)),
    });
  }

  for (const assetDir of ["images", "audio"]) {
    const from = join(courseRoot, assetDir);
    if (existsSync(from)) syncPath(from, join(siteDir, assetDir));
  }

  const courseTitle = coursePageTitle(course.title, course.subtitle);
  writePage(
    join(siteDir, "index.html"),
    courseTitle,
    coursePrefix,
    renderCourseHome(course, parsed, preamble, courseRoot),
    {
      description: courseMetaDescription(course),
      canonicalPath: coursePrefix,
    },
  );
  // A course page lists every lecture, so any note in the course re-dates it.
  sitemapEntries.push({
    path: coursePrefix,
    lastmod: lastmod([`courses/${course.id}/notes`]),
  });
}

/**
 * Hand-written so the subjects can be named the way a person would search for them
 * ("algorithms", not "Design and Analysis of Algorithms"). Not derived from COURSES,
 * so {@link assertHomeDescriptionNamesEveryCourse} keeps it honest.
 */
const siteHomeDescription =
  "Student-written MIT lecture notes: 18.701 algebra, 6.1220 algorithms, " +
  "6.300 signals, 18.650 statistics, 6.790 machine learning, 6.4210 robotics, 6.1810 OS.";
assertHomeDescriptionNamesEveryCourse();
writePage(join(distDir, "index.html"), SITE_META_TITLE, "", renderSiteHome(), {
  description: siteHomeDescription,
  canonicalPath: "/",
});

syncPath(katexDist, katexOut);
for (const asset of ["highlight", "fonts", "lecture-navbar.js", "mobile.js", "favicon.svg"]) {
  syncPath(join(root, asset), join(distDir, asset));
}
// Keep GitHub Pages from running the output through Jekyll.
writeIfChanged(join(distDir, ".nojekyll"), "");
// Custom domain. GitHub Pages reads only the first line, and the deployed artifact
// is dist/, so a repo-root CNAME would never be published.
writeIfChanged(join(distDir, "CNAME"), `${SITE_HOST}\n`);

// Check before writing, so a failed build never leaves a bad sitemap on disk.
assertSitemapMatchesOutput();
writeIfChanged(join(distDir, "sitemap.xml"), renderSitemap(sitemapEntries));
writeIfChanged(
  join(distDir, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl("/sitemap.xml")}\n`,
);

pruneStale(distDir);

const totalPages = [...parsedByCourse.values()].reduce((sum, parsed) => sum + parsed.length, 0);
const unchanged = producedPaths.size - changedCount;
console.log(
  `Built dist/: ${COURSES.length} course page(s), ${totalPages} lecture page(s) — ` +
    `${changedCount} file(s) changed, ${unchanged} unchanged`,
);

function writePage(
  path: string,
  title: string,
  coursePrefix: string,
  content: string,
  seo: PageSeo,
): void {
  const resolvedContent = content.replaceAll("{{COURSE_PREFIX}}", coursePrefix);
  const canonicalUrl = siteUrl(seo.canonicalPath);
  const ogUrl = canonicalUrl;
  const canonicalTag = `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`;
  const description = escapeHtml(seo.description);
  const page = template
    .replaceAll("{{TITLE}}", escapeHtml(title))
    .replaceAll("{{META_DESCRIPTION}}", description)
    .replace("{{CANONICAL}}", canonicalTag)
    .replaceAll("{{OG_URL}}", escapeHtml(ogUrl))
    .replace("{{CONTENT}}", resolvedContent);
  writeIfChanged(path, page);
}

/**
 * A lecture's own sources: its .tex plus the per-lecture asset directories, which are
 * named after the note file ("lecture-19.tex" -> "images/lecture-19").
 */
function lectureSourcePaths(courseId: string, filename: string): string[] {
  const stem = filename.replace(/\.tex$/, "");
  return [
    `courses/${courseId}/notes/${filename}`,
    ...["images", "audio", "widgets"].map((dir) => `courses/${courseId}/${dir}/${stem}`),
  ];
}

function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map(({ path, lastmod }) => {
      const stamp = lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : "";
      return `  <url>\n    <loc>${escapeXml(siteUrl(path))}</loc>${stamp}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * Fail the build if the sitemap advertises a URL this build did not write, or omits
 * a page it did. Both sides derive from the same variables today, so this can only
 * fire if that coupling is broken later — which would otherwise ship silent 404s to
 * search engines, since a bad deploy is only visible after it is live.
 */
function assertSitemapMatchesOutput(): void {
  const pageFiles = new Set(
    [...producedPaths].filter((path) => path.endsWith(`${sep}index.html`)),
  );
  const advertised = new Set(
    sitemapEntries.map(({ path }) => join(distDir, path, "index.html")),
  );
  const missingFile = [...advertised].filter((path) => !pageFiles.has(path));
  const missingEntry = [...pageFiles].filter((path) => !advertised.has(path));
  if (missingFile.length === 0 && missingEntry.length === 0) return;

  const report = (label: string, paths: string[]): string =>
    paths.length === 0
      ? ""
      : `\n${label}:\n${paths.map((path) => `  ${relative(distDir, path)}`).join("\n")}`;
  throw new Error(
    "sitemap.xml does not match the generated pages." +
      report("In the sitemap but never written", missingFile) +
      report("Written but missing from the sitemap", missingEntry),
  );
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Course meta description: identity, term, then as much of the authored summary as a
 * search result will actually render. The summaries run past 300 characters, so this
 * is the one description that has to be cut rather than composed to fit.
 */
function courseMetaDescription(course: (typeof COURSES)[number]): string {
  const label = courseLabel(course.title, course.subtitle);
  const summary = collapseWhitespace(course.summary);
  return truncateAtWord(
    `Student-written lecture notes for ${label}, ${termName(course.semester)}: ${openLowercase(summary)}`,
    META_DESCRIPTION_LIMIT,
  );
}

/**
 * Drop the summary's opening capital, since it now continues a sentence rather than
 * starting one. Every summary opens with an article or "Notes"; one that opened with a
 * proper noun would need rewording, not a smarter rule.
 */
function openLowercase(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * The home description is hand-written, so nothing makes it follow COURSES. Fail the
 * build rather than ship a page that silently omits a course someone just added.
 */
function assertHomeDescriptionNamesEveryCourse(): void {
  const missing = COURSES.filter((course) => !siteHomeDescription.includes(course.title));
  if (missing.length === 0) return;
  throw new Error(
    "The hand-written home page description does not name every course. Missing: " +
      missing.map((course) => course.title).join(", "),
  );
}

/** Semester label without its decorative emoji: "🍂 Fall 2025" reads as "Fall 2025". */
function termName(semester: string): string {
  return semester.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

function truncateAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.lastIndexOf(" ", limit - 1);
  return `${text.slice(0, cut > 0 ? cut : limit - 1).replace(/[,;:.\u2014-]+$/, "")}\u2026`;
}

/** Lets a course summary be authored as an indented multi-line template literal. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Seasonal tint class for a course card, read out of the free-form semester label
 * ("🍂 Fall 2025"). A label naming no season (say, "IAP 2027") tints nothing and
 * falls back to the plain card.
 */
function seasonModifier(semester: string): string {
  const label = semester.toLowerCase();
  if (label.includes("fall") || label.includes("autumn")) return " course-card--fall";
  if (label.includes("spring")) return " course-card--spring";
  if (label.includes("summer")) return " course-card--summer";
  return "";
}

function renderSiteHome(): string {
  const cards = COURSES.map(
    (course) => `<a class="course-card${seasonModifier(course.semester)}" href="/${course.id}/">
<span class="course-card-head">
<span class="course-card-number">${escapeHtml(course.title)}</span>
<span class="course-card-term">${escapeHtml(course.semester)}</span>
</span>
<span class="course-card-title">${escapeHtml(course.subtitle)}</span>
<span class="course-card-summary">${escapeHtml(collapseWhitespace(course.summary))}</span>
</a>`,
  ).join("\n");

  return `<header class="site-header">
<img class="site-mark" src="/favicon.svg" alt="" width="512" height="512">
<h1 class="site-title"><span class="site-title-flourish" aria-hidden="true"></span>${escapeHtml(SITE_PAGE_TITLE)}<span class="site-title-flourish site-title-flourish--end" aria-hidden="true"></span></h1>
</header>
<div class="course-grid">
${cards}
</div>`;
}

function renderCourseHome(
  course: (typeof COURSES)[number],
  parsed: ParsedNote[],
  preamble: string,
  courseRoot: string,
): string {
  const nav = `<nav class="site-nav"><a href="/">Home</a></nav>`;
  const tocParts = getTocParts(course.id);
  const tocHtml = tocParts
    ? renderCourseTocWithParts(parsed, tocParts, preamble, courseRoot)
    : renderCourseTocFlat(parsed, preamble, courseRoot);

  return `${nav}<header class="lecture-header"><h1>MIT ${escapeHtml(course.title)}</h1><p class="lecture-title">${escapeHtml(course.subtitle)}</p></header>
${tocHtml}`;
}

function renderLectureTocEntry(
  note: Note,
  titleHtml: string,
  preamble: string,
  courseRoot: string,
): string {
  const pageUrl = `/${note.courseId}/lectures/${lectureSlug(note.lectures)}/`;
  const lectureLink = `<a href="${pageUrl}" class="lecture-toc-link">${escapeHtml(formatLectureLabel(note.lectures))}: ${titleHtml}</a>`;
  const subsections = extractSubsections(note.source);
  if (subsections.length === 0) {
    return `<li class="lecture-toc-entry">${lectureLink}</li>`;
  }
  const subItems = subsections
    .map(({ slug, titleTex }) => {
      const subTitleHtml = renderInlineFragment(titleTex, preamble, courseRoot);
      return `<li><a href="${pageUrl}#${escapeHtml(slug)}" class="toc-subsection-link"><span class="toc-subsection-marker">§</span> ${subTitleHtml}</a></li>`;
    })
    .join("\n");
  return `<li class="lecture-toc-entry">${lectureLink}\n<ul class="subsection-toc">\n${subItems}\n</ul></li>`;
}

function renderCourseTocFlat(
  parsed: ParsedNote[],
  preamble: string,
  courseRoot: string,
): string {
  const items = parsed
    .map(({ note, titleHtml }) => renderLectureTocEntry(note, titleHtml, preamble, courseRoot))
    .join("\n");
  return `<nav class="toc-outline" aria-label="Lectures">\n<ul class="toc-lectures">\n${items}\n</ul>\n</nav>`;
}

function renderCourseTocWithParts(
  parsed: ParsedNote[],
  tocParts: TocPart[],
  preamble: string,
  courseRoot: string,
): string {
  const notes = parsed.map((p) => p.note);
  const grouped = groupNotesByTocParts(notes, tocParts);
  const parsedBySlug = new Map(
    parsed.map((p) => [lectureSlug(p.note.lectures), p] as const),
  );

  const partsHtml = grouped
    .map(({ part, notes: partNotes }, index) => {
      const lectureItems = partNotes
        .map((note) => {
          const entry = parsedBySlug.get(lectureSlug(note.lectures));
          if (!entry) return "";
          return renderLectureTocEntry(
            entry.note,
            entry.titleHtml,
            preamble,
            courseRoot,
          );
        })
        .filter(Boolean)
        .join("\n");
      return `<section class="toc-part">
<h2 class="toc-part-title"><span class="toc-part-marker">§</span> Section ${index + 1}: ${escapeHtml(part.title)}</h2>
<ul class="toc-lectures">
${lectureItems}
</ul>
</section>`;
    })
    .join("\n");

  return `<nav class="toc-outline" aria-label="Lectures">\n${partsHtml}\n</nav>`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
