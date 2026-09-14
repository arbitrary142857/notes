import katex from "katex";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createContext,
  parsePreamble,
  applyBuiltinDefinitions,
  resolveXcolorName,
  type Context,
} from "./preamble.js";
import { highlightCode } from "./highlight.js";
import {
  findEnvironmentEnd,
  findVerbatimEnvironmentEnd,
  findInlineMathEnd,
  findUnescaped,
  extractBracedCommand,
  isInsideInlineMath,
  literalSpanEnd,
  readBraced,
  readOptionalBracket,
  readSquareBracket,
  readVerb,
} from "./tex-read.js";

export interface SubsectionEntry {
  slug: string;
  titlePlain: string;
  titleTex: string;
}

export interface ParseResult {
  title: string;
  lectures: number[];
  html: string;
}

const TEXT_COMMANDS: Record<string, string> = {
  textbf: "strong",
  textit: "em",
  emph: "em",
  texttt: "code",
};

const MATH_ENVS = new Set([
  "align",
  "align*",
  "equation",
  "equation*",
  "gather",
  "gather*",
  "multline",
  "multline*",
]);

const VERBATIM_ENVS = new Set(["verbatim", "verbatim*"]);
const RAW_HTML_ENVS = new Set(["html"]);

function isLiteralEnvironment(env: string): boolean {
  return VERBATIM_ENVS.has(env) || RAW_HTML_ENVS.has(env);
}

const HEADING_COMMANDS: Record<string, string> = {
  section: "h2",
  subsection: "h3",
  subsubsection: "h4",
};

/** Character shown before each \\subsection{...} title. Customize here. */
const SUBSECTION_MARKER = "§";

const ENV_COLORS: Record<string, string> = {
  problem: "#C96600",
  solution: "#295A25",
  "solution*": "#295A25",
  proof: "#5B1E85",
  "proof*": "#5B1E85",
  claim: "#008080",
  remark: "#999999",
};

const XCOLOR_NAMES: Record<string, string> = {
  "black!40": "#999999",
  "teal!40": "#009688",
  "teal!100": "#008080",
  teal: "#008080",
  black: "#000000",
  Orchid: "#DA70D6",
  "Orchid!80": "#E8B4E8",
  "Orchid!125": "#F5D4F5",
  Violet: "#EE82EE",
  "Violet!70": "#D8A8D8",
  "Violet!111": "#F8D0F8",
};

const KNOWN_ESCAPES: Record<string, string> = {
  "%": "%",
  $: "$",
  "&": "&",
  "#": "#",
  _: "_",
  "{": "{",
  "}": "}",
  "\\": "\\",
};

export function parseTex(
  bodySource: string,
  preambleSource = "",
  projectRoot = "",
  imagesDir = "",
  audioDir = "",
  widgetsDir = "",
): ParseResult {
  const { preamble: docPreamble, body, title, lectures } = extractDocument(bodySource);
  const preamble = [preambleSource.trim(), docPreamble.trim()]
    .filter(Boolean)
    .join("\n");
  const ctx = createContext();
  ctx.projectRoot = projectRoot;
  parsePreamble(preamble, ctx);
  if (imagesDir) {
    ctx.imagePaths = [imagesDir.endsWith("/") ? imagesDir : `${imagesDir}/`];
  }
  if (audioDir) {
    ctx.audioPaths = [audioDir.endsWith("/") ? audioDir : `${audioDir}/`];
  }
  if (widgetsDir) {
    ctx.widgetPaths = [widgetsDir.endsWith("/") ? widgetsDir : `${widgetsDir}/`];
  }
  applyBuiltinDefinitions(ctx);
  const html = renderBody(stripComments(body), ctx);
  return { title, lectures, html };
}

export function renderInlineFragment(
  fragment: string,
  preambleSource = "",
  projectRoot = "",
): string {
  const ctx = createContext();
  ctx.projectRoot = projectRoot;
  parsePreamble(preambleSource, ctx);
  applyBuiltinDefinitions(ctx);
  return parseInline(fragment.trim(), ctx);
}

/**
 * TeX title reduced to bare text. Feeds subsection slugs, so its output must stay
 * stable — changing it silently rewrites every "#heading" anchor already published.
 * For text a reader sees, use {@link titleDisplayText} instead.
 */
export function titlePlainText(titleTex: string): string {
  return stripTitleMarkup(titleTex, false);
}

/**
 * TeX title reduced to text meant for human eyes — page titles, meta descriptions,
 * social cards. Identical to {@link titlePlainText} except that math sub- and
 * superscripts become real characters ("$S_n$" reads as "S\u2099", not "S_n"), since
 * search results and link previews cannot render KaTeX.
 */
export function titleDisplayText(titleTex: string): string {
  return stripTitleMarkup(titleTex, true);
}

function stripTitleMarkup(titleTex: string, unicodeScripts: boolean): string {
  let plain = titleTex.trim();
  while (/\\[a-zA-Z@*]+\{/.test(plain)) {
    plain = plain.replace(/\\[a-zA-Z@*]+\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, "$1");
  }
  // Must run while braces survive, so "x_{ij}" is read as one script and not as "x_i" + "j".
  if (unicodeScripts) plain = applyUnicodeScripts(plain);
  return plain.replace(/\$([^$]*)\$/g, "$1").replace(/[{}\\]/g, "").trim();
}

const SUBSCRIPTS = buildScriptTable(
  "0123456789+-=()aeohklmnpstxiruvj",
  "\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089\u208a\u208b\u208c\u208d\u208e\u2090\u2091\u2092\u2095\u2096\u2097\u2098\u2099\u209a\u209b\u209c\u2093\u1d62\u1d63\u1d64\u1d65\u2c7c",
);

const SUPERSCRIPTS = buildScriptTable(
  "0123456789+-=()abcdefghijklmnoprstuvwxyz",
  "\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079\u207a\u207b\u207c\u207d\u207e\u1d43\u1d47\u1d9c\u1d48\u1d49\u1da0\u1d4d\u02b0\u2071\u02b2\u1d4f\u02e1\u1d50\u207f\u1d52\u1d56\u02b3\u02e2\u1d57\u1d58\u1d5b\u02b7\u02e3\u02b8\u1dbb",
);

function buildScriptTable(plain: string, scripted: string): Map<string, string> {
  const scriptedChars = [...scripted];
  if (scriptedChars.length !== plain.length) {
    throw new Error("script table is misaligned");
  }
  return new Map([...plain].map((char, index) => [char, scriptedChars[index]]));
}

/**
 * Rewrite "_x" / "^{xy}" inside math as Unicode sub- and superscripts. Only math is
 * touched, so an escaped underscore in prose stays an underscore. A script converts
 * only when every one of its characters has a Unicode form, leaving anything exotic
 * ("$L^\\infty$") in its literal TeX shape rather than half-translated.
 */
function applyUnicodeScripts(text: string): string {
  return text.replace(/\$([^$]*)\$/g, (_whole: string, math: string) => `$${scriptsInMath(math)}$`);
}

function scriptsInMath(math: string): string {
  return math.replace(
    /([_^])(?:\{([^{}]*)\}|(.))/g,
    (whole: string, marker: string, braced: string | undefined, single: string | undefined) => {
      const body = braced ?? single ?? "";
      const table = marker === "_" ? SUBSCRIPTS : SUPERSCRIPTS;
      const scripted = [...body].map((char) => table.get(char));
      if (body.length === 0 || scripted.some((char) => char === undefined)) return whole;
      return scripted.join("");
    },
  );
}

export function extractSubsections(source: string): SubsectionEntry[] {
  const docStart = source.indexOf("\\begin{document}");
  const bodyStart =
    docStart === -1 ? 0 : docStart + "\\begin{document}".length;
  const body = source.slice(bodyStart);
  const used = new Set<string>();
  const entries: SubsectionEntry[] = [];
  let i = 0;

  while (i < body.length) {
    const at = body.indexOf("\\subsection{", i);
    if (at === -1) break;
    const arg = readBraced(body, at + "\\subsection".length);
    if (!arg) {
      i = at + 1;
      continue;
    }
    const titlePlain = titlePlainText(arg.content);
    entries.push({
      slug: uniqueSubsectionSlug(titlePlain, used),
      titlePlain,
      titleTex: arg.content.trim(),
    });
    i = arg.end;
  }

  return entries;
}

export function uniqueSubsectionSlug(titlePlain: string, used: Set<string>): string {
  let base = slugifyHeading(titlePlain);
  if (!base) base = "subsection";
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}-${n}`;
    n++;
  }
  used.add(slug);
  return slug;
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function stripComments(source: string): string {
  let out = "";
  let i = 0;

  while (i < source.length) {
    const literalEnd = literalSpanEnd(source, i);
    if (literalEnd !== -1) {
      out += source.slice(i, literalEnd);
      i = literalEnd;
      continue;
    }

    if (source[i] === "%" && (i === 0 || source[i - 1] !== "\\")) {
      const nl = source.indexOf("\n", i);
      if (nl === -1) break;
      out += "\n";
      i = nl + 1;
      continue;
    }
    out += source[i];
    i++;
  }

  return out;
}

function extractDocument(source: string): {
  preamble: string;
  body: string;
  title: string;
  lectures: number[];
} {
  const docStart = source.indexOf("\\begin{document}");
  let preamble = "";
  let body = source.trim();

  if (docStart !== -1) {
    preamble = source.slice(0, docStart);
    const afterBegin = docStart + "\\begin{document}".length;
    const newline = source.indexOf("\n", afterBegin);
    const bodyStart = newline === -1 ? afterBegin : newline + 1;
    const docEnd = source.indexOf("\\end{document}");
    body =
      docEnd !== -1
        ? source.slice(bodyStart, docEnd).trim()
        : source.slice(bodyStart).trim();
  }

  const title = extractBracedCommand(preamble, "title") ?? "Page";

  const lecturesMatch = preamble.match(/\\lectures\{([^}]*)\}/);
  if (lecturesMatch) {
    const lectures = lecturesMatch[1]
      .split(",")
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((n) => !Number.isNaN(n));
    return { preamble, body, title, lectures };
  }

  const lectureMatch = preamble.match(/\\lecture\{(\d+)\}/);
  const lectures = lectureMatch ? [Number.parseInt(lectureMatch[1], 10)] : [];

  return { preamble, body, title, lectures };
}

function renderBody(body: string, ctx: Context): string {
  const parts: string[] = [];
  let i = 0;

  while (i < body.length) {
    i = skipSpace(body, i);
    if (i >= body.length) break;

    if (body.startsWith("\\begin{", i) && !isInsideInlineMath(body, i)) {
      const parsed = parseEnvironmentBlock(body, i, ctx);
      if (parsed) {
        parts.push(parsed.html);
        i = parsed.end;
        continue;
      }
    }

    if (body.startsWith("\\[", i)) {
      const close = body.indexOf("\\]", i + 2);
      if (close !== -1) {
        parts.push(renderMath(body.slice(i + 2, close).trim(), true, ctx));
        i = close + 2;
        continue;
      }
    }

    const heading = parseHeadingCommand(body, i, ctx);
    if (heading) {
      parts.push(heading.html);
      i = heading.end;
      continue;
    }

    const nextSpecial = findNextBlockStart(body, i);
    const chunk = body.slice(i, nextSpecial === -1 ? body.length : nextSpecial).trim();
    if (nextSpecial === i) {
      parts.push(renderParagraphBlock(body.slice(i, i + 1), ctx));
      i++;
      continue;
    }
    if (chunk) parts.push(renderParagraphBlock(chunk, ctx));
    i = nextSpecial === -1 ? body.length : nextSpecial;
  }

  return parts.join("\n");
}

function findNextBlockStart(body: string, from: number): number {
  const patterns = [
    "\\begin{",
    "\\[",
    ...Object.keys(HEADING_COMMANDS).map((name) => `\\${name}{`),
  ];
  const candidates: number[] = [];
  for (const pattern of patterns) {
    let idx = from;
    while (true) {
      idx = body.indexOf(pattern, idx);
      if (idx === -1) break;
      if (pattern === "\\begin{" && isInsideInlineMath(body, idx)) {
        idx++;
        continue;
      }
      candidates.push(idx);
      break;
    }
  }
  if (candidates.length === 0) return -1;
  return Math.min(...candidates);
}

function parseHeadingCommand(
  body: string,
  start: number,
  ctx: Context,
): { html: string; end: number } | null {
  if (body[start] !== "\\") return null;

  const rest = body.slice(start + 1);
  const nameMatch = rest.match(/^(subsection|subsubsection|section)/);
  if (!nameMatch) return null;

  const name = nameMatch[1];
  const tag = HEADING_COMMANDS[name];
  let i = start + 1 + name.length;
  const arg = readBraced(body, i);
  if (!arg) return null;

  const titleHtml =
    name === "subsection"
      ? `<span class="subsection-marker">${SUBSECTION_MARKER}</span> ${parseInline(arg.content, ctx)}`
      : parseInline(arg.content, ctx);

  const idAttr =
    name === "subsection"
      ? ` id="${escapeAttr(uniqueSubsectionSlug(titlePlainText(arg.content), ctx.usedSubsectionSlugs))}"`
      : "";

  return {
    html: `<${tag} class="heading-${name}"${idAttr}>${titleHtml}</${tag}>`,
    end: arg.end,
  };
}

function parseEnvironmentBlock(
  body: string,
  start: number,
  ctx: Context,
): { html: string; end: number } | null {
  const nameStart = start + 7;
  const nameEnd = body.indexOf("}", nameStart);
  if (nameEnd === -1) return null;
  const env = body.slice(nameStart, nameEnd);
  let i = nameEnd + 1;

  let boxedWidth = "36em";
  let verbatimLanguage = "";
  if (body[i] === "[") {
    const optional = readOptionalBracket(body, i);
    if (optional) {
      if (env === "boxed-text") boxedWidth = optional.content.trim();
      else if (VERBATIM_ENVS.has(env)) verbatimLanguage = optional.content.trim();
      i = optional.end;
    }
  }

  const args: string[] = [];
  const envDef = ctx.environments.get(env);
  const argCount = envDef?.params ?? 0;
  for (let n = 0; n < argCount; n++) {
    const arg = readBraced(body, i);
    if (!arg) break;
    args.push(arg.content);
    i = arg.end;
  }

  const innerStart = i;
  const innerEnd = isLiteralEnvironment(env)
    ? findVerbatimEnvironmentEnd(body, env, innerStart)
    : findEnvironmentEnd(body, env, innerStart);
  if (innerEnd === -1) return null;

  const rawInner = body.slice(innerStart, innerEnd);
  const inner = isLiteralEnvironment(env) ? normalizeVerbatimContent(rawInner) : rawInner.trim();
  const end = innerEnd + `\\end{${env}}`.length;

  if (RAW_HTML_ENVS.has(env)) {
    return { html: renderRawHtml(inner), end };
  }

  if (VERBATIM_ENVS.has(env)) {
    return { html: renderVerbatim(inner, verbatimLanguage), end };
  }

  if (env === "center") {
    return { html: `<div class="center">${renderBody(inner, ctx)}</div>`, end };
  }

  if (env === "itemize") {
    return { html: renderList(inner, ctx, "ul"), end };
  }

  if (env === "enumerate") {
    return { html: renderList(inner, ctx, "ol"), end };
  }

  if (env === "quote") {
    return {
      html: `<blockquote class="quote">${renderBody(inner, ctx)}</blockquote>`,
      end,
    };
  }

  if (MATH_ENVS.has(env)) {
    return {
      html: renderMath(`\\begin{${env}}${inner}\\end{${env}}`, true, ctx),
      end,
    };
  }

  if (env === "boxed-text") {
    const width = sanitizeCssLength(boxedWidth);
    return {
      html: `<div class="boxed-text" style="max-width:${width}">${renderBody(inner, ctx)}</div>`,
      end,
    };
  }

  if (envDef) {
    const open = stripColorDirectives(substituteArgs(envDef.begin, args));
    const labelHtml = parseInline(open, ctx);
    const innerHtml = renderBody(inner, ctx);
    const color = envDef.color ?? ENV_COLORS[env];
    const style = color ? ` style="color:${color}"` : "";
    const html = `<section class="env env-${envClassName(env)}"${style}>${mergeEnvPrefix(labelHtml, innerHtml)}</section>`;
    return { html, end };
  }

  return {
    html: `<section class="env env-${env}">${renderBody(inner, ctx)}</section>`,
    end,
  };
}

function normalizeVerbatimContent(raw: string): string {
  let content = raw.replace(/^\r?\n/, "");
  if (content.endsWith("\r\n")) content = content.slice(0, -2);
  else if (content.endsWith("\n")) content = content.slice(0, -1);
  return content;
}

function renderRawHtml(content: string): string {
  return `<div class="note-html-embed">${content.trim()}</div>`;
}

function renderVerbatim(content: string, language = ""): string {
  const lang = language.trim().toLowerCase();
  if (lang) {
    const highlighted = highlightCode(content, lang);
    if (highlighted) {
      return `<pre class="verbatim"><code class="hljs language-${escapeAttr(lang)}">${highlighted}</code></pre>`;
    }
  }
  return `<pre class="verbatim"><code>${escapeText(content)}</code></pre>`;
}

function renderInlineCode(content: string, language = ""): string {
  const lang = language.trim().toLowerCase();
  if (lang) {
    const highlighted = highlightCode(content, lang);
    if (highlighted) {
      return `<code class="verbatim verbatim-inline hljs language-${escapeAttr(lang)}">${highlighted}</code>`;
    }
  }
  return `<code class="verbatim verbatim-inline">${escapeText(content)}</code>`;
}

function sanitizeCssLength(value: string): string {
  const trimmed = value.trim();
  if (/^[\d.]+(em|ex|px|pt|rem|%)$/.test(trimmed)) return trimmed;
  return "36em";
}

function sanitizeSkipLength(value: string): string {
  const trimmed = value.trim();
  if (/^-?[\d.]+(em|ex|px|pt|rem|cm|mm|%)$/.test(trimmed)) return trimmed;
  return "0.5em";
}

function renderVskip(length: string): string {
  const css = sanitizeSkipLength(length);
  if (css.startsWith("-")) {
    return `<div class="vskip vskip-pull" style="margin-top:${css}"></div>`;
  }
  return `<div class="vskip" style="height:${css}"></div>`;
}

function splitOnVskip(
  block: string,
): ({ kind: "text"; content: string } | { kind: "skip"; length: string })[] {
  const parts: ({ kind: "text"; content: string } | { kind: "skip"; length: string })[] = [];
  let i = 0;

  while (i < block.length) {
    const idx = block.indexOf("\\vskip", i);
    if (idx === -1) {
      parts.push({ kind: "text", content: block.slice(i) });
      break;
    }
    if (idx > i) parts.push({ kind: "text", content: block.slice(i, idx) });
    let pos = idx + "\\vskip".length;
    while (pos < block.length && /\s/.test(block[pos])) pos++;
    const arg = readBraced(block, pos);
    if (!arg) {
      parts.push({ kind: "text", content: block.slice(idx, idx + "\\vskip".length) });
      i = idx + "\\vskip".length;
      continue;
    }
    parts.push({ kind: "skip", length: arg.content.trim() });
    i = arg.end;
  }

  return parts.filter((part) => part.kind === "skip" || part.content.trim());
}

function stripColorDirectives(tex: string): string {
  return tex
    .replace(/\\color(\[[^\]]*\])?\{[^}]*\}/g, "")
    .replace(/\\noindent\s*/g, "")
    .replace(/\\vspace\{[^}]*\}/g, "")
    .trim();
}

function envClassName(env: string): string {
  return env.replaceAll("*", "-star");
}

function mergeEnvPrefix(prefix: string, bodyHtml: string): string {
  if (!prefix.trim()) return bodyHtml;
  const label = prefix.trimEnd().endsWith(" ") ? prefix : `${prefix} `;
  const trimmed = bodyHtml.trimStart();
  const match = trimmed.match(/^<p>([\s\S]*?)<\/p>\n?/);
  if (match) {
    return `<p>${label}${match[1]}</p>${trimmed.slice(match[0].length)}`;
  }
  return `<p>${label}${trimmed}</p>`;
}

function splitListItems(inner: string): { label: string | null; content: string }[] {
  const items: { label: string | null; content: string }[] = [];
  let itemStart = -1;
  let itemLabel: string | null = null;
  let i = 0;
  let envDepth = 0;

  while (i < inner.length) {
    if (inner.startsWith("\\begin{", i) && !isInsideInlineMath(inner, i)) {
      envDepth++;
      i += 7;
      const close = inner.indexOf("}", i);
      i = close === -1 ? inner.length : close + 1;
      continue;
    }
    if (inner.startsWith("\\end{", i) && !isInsideInlineMath(inner, i)) {
      envDepth--;
      i += 5;
      const close = inner.indexOf("}", i);
      i = close === -1 ? inner.length : close + 1;
      continue;
    }
    if (envDepth === 0 && inner.startsWith("\\item", i)) {
      let after = i + 5;
      let label: string | null = null;
      if (inner[after] === "[") {
        const bracket = readSquareBracket(inner, after);
        if (bracket) {
          label = bracket.content.trim();
          after = bracket.end;
        }
      }
      while (after < inner.length && /\s/.test(inner[after])) after++;

      if (itemStart !== -1) {
        items.push({ label: itemLabel, content: inner.slice(itemStart, i).trim() });
      }
      itemLabel = label;
      itemStart = after;
      i = after;
      continue;
    }
    i++;
  }

  if (itemStart !== -1) {
    items.push({ label: itemLabel, content: inner.slice(itemStart).trim() });
  }

  return items;
}

function renderList(inner: string, ctx: Context, tag: "ul" | "ol"): string {
  const items = splitListItems(inner);
  const hasLabels = items.some((item) => item.label !== null);
  const lis = items
    .map(({ label, content }) => {
      const body = renderBody(content, ctx);
      if (!label) return `<li>${body}</li>`;
      const labelHtml = parseInline(label, ctx);
      return `<li class="item-labeled"><span class="item-label">${labelHtml}</span><div class="item-body">${body}</div></li>`;
    })
    .join("");
  const classAttr = hasLabels ? ` class="${tag === "ul" ? "itemize" : "enumerate"}-labeled"` : "";
  return `<${tag}${classAttr}>${lis}</${tag}>`;
}

function renderParagraphBlock(block: string, ctx: Context, paragraphClass = ""): string {
  const classAttr = paragraphClass ? ` class="${paragraphClass}"` : "";
  return splitOnVskip(block)
    .flatMap((part) => {
      if (part.kind === "skip") return renderVskip(part.length);
      return splitParagraphs(part.content)
        .map((para) => {
          const text = collapseParagraphLines(para);
          if (!text) return "";
          const heading = parseHeadingCommand(text, 0, ctx);
          if (heading && heading.end === text.length) return heading.html;
          const audio = parseIncludeAudioCommand(text, 0, ctx);
          if (audio && audio.end === text.length) return audio.html;
          const widget = parseIncludeWidgetCommand(text, 0, ctx);
          if (widget && widget.end === text.length) return widget.html;
          return `<p${classAttr}>${parseInline(text, ctx)}</p>`;
        })
        .filter(Boolean);
    })
    .join("\n");
}

function splitParagraphs(block: string): string[] {
  return block
    .split(/\n\s*\n+/)
    .map((para) => para.trim())
    .filter(Boolean);
}

function collapseParagraphLines(paragraph: string): string {
  return paragraph
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function parseInline(input: string, ctx: Context): string {
  let out = "";
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === "%") {
      const nl = input.indexOf("\n", i);
      i = nl === -1 ? input.length : nl + 1;
      continue;
    }

    if (ch === "$" && input[i + 1] !== "$") {
      const end = findInlineMathEnd(input, i + 1);
      if (end === -1) {
        out += escapeText(ch);
        i++;
        continue;
      }
      out += renderMath(input.slice(i + 1, end), false, ctx);
      i = end + 1;
      continue;
    }

    if (ch === "~") {
      out += "\u00A0";
      i++;
      continue;
    }

    if (ch === "`" && input[i + 1] === "`") {
      out += "\u201C";
      i += 2;
      continue;
    }

    if (ch === "'" && input[i + 1] === "'") {
      out += "\u201D";
      i += 2;
      continue;
    }

    if (ch === "-" && input[i + 1] === "-" && input[i + 2] === "-") {
      out += "\u2014";
      i += 3;
      continue;
    }

    if (ch === "\n" || ch === "\r") {
      if (out.length > 0 && out[out.length - 1] !== " ") out += " ";
      i++;
      if (ch === "\r" && input[i] === "\n") i++;
      continue;
    }

    if (ch === "\\") {
      if (input[i + 1] === "\\") {
        out += "<br>";
        i += 2;
        continue;
      }

      if (input[i + 1] === " " || input[i + 1] === "\t") {
        out += "\u2009";
        i += 2;
        while (i < input.length && (input[i] === " " || input[i] === "\t")) i++;
        continue;
      }

      const handled = parseCommand(input, i, ctx);
      if (handled) {
        out += handled.html;
        i = handled.end;
        continue;
      }
    }

    out += escapeText(ch);
    i++;
  }

  return out;
}

function parseCommand(
  input: string,
  start: number,
  ctx: Context,
): { html: string; end: number } | null {
  const rest = input.slice(start + 1);
  const nameMatch = rest.match(/^([a-zA-Z@*]+)/);
  if (!nameMatch) {
    const next = input[start + 1];
    if (next && KNOWN_ESCAPES[next] !== undefined) {
      return { html: escapeText(KNOWN_ESCAPES[next]), end: start + 2 };
    }
    return { html: escapeText(input[start]), end: start + 1 };
  }

  const name = nameMatch[1];
  let i = start + 1 + name.length;

  if (name === "begin" || name === "end") {
    const arg = readBraced(input, i);
    if (!arg) return { html: escapeText(input[start]), end: start + 1 };
    return { html: "", end: arg.end };
  }

  if (name === "verb" || name === "verb*") {
    const verb = readVerb(input, i);
    if (verb) {
      return { html: renderInlineCode(verb.content, verb.language), end: verb.end };
    }
    return { html: escapeText(input.slice(start, i)), end: i };
  }

  if (name === "noindent" || name === "line" || name === "vspace") {
    if (input[i] === "{") {
      const arg = readBraced(input, i);
      if (arg) return { html: "", end: arg.end };
    }
    return { html: "", end: i };
  }

  if (name === "vskip") {
    const arg = readBraced(input, i);
    if (arg) return { html: renderVskip(arg.content), end: arg.end };
    return { html: "", end: i };
  }

  if (name === "color") {
    const color = readColorSpec(input, i);
    if (color) {
      if (color.value === "#000000" || color.value === "black") {
        return { html: "", end: color.end };
      }
      const rest = input.slice(color.end);
      return {
        html: `<span style="color:${color.value}">${parseInline(rest, ctx)}</span>`,
        end: input.length,
      };
    }

    const named = readBraced(input, i);
    if (named) {
      const value = XCOLOR_NAMES[named.content.trim()] ?? named.content;
      if (value === "black" || value === "#000000") {
        return { html: "", end: named.end };
      }
      const rest = input.slice(named.end);
      return {
        html: `<span style="color:${value.startsWith("#") ? value : `#${value}`}">${parseInline(rest, ctx)}</span>`,
        end: input.length,
      };
    }
  }

  if (name === "horizontal") {
    return { html: "<hr>", end: i };
  }

  if (name === "circled") {
    const arg = readBraced(input, i);
    if (!arg) return { html: escapeText("\\circled"), end: i };
    return {
      html: `<span class="circled">${parseInline(arg.content, ctx)}</span>`,
      end: arg.end,
    };
  }

  if (name === "frame" || name === "fbox") {
    const arg = readBraced(input, i);
    if (!arg) return { html: escapeText(`\\${name}`), end: i };
    const inner = arg.content.trim();
    if (inner.startsWith("\\includegraphics")) {
      const rendered = parseIncludeGraphicsCommand(inner, 0, ctx, "framed");
      if (rendered) return { html: rendered.html, end: arg.end };
    }
    if (inner.startsWith("\\includeaudio")) {
      const rendered = parseIncludeAudioCommand(inner, 0, ctx);
      if (rendered) return { html: rendered.html, end: arg.end };
    }
    if (inner.startsWith("\\includewidget")) {
      const rendered = parseIncludeWidgetCommand(inner, 0, ctx);
      if (rendered) return { html: rendered.html, end: arg.end };
    }
    return {
      html: `<span class="frame">${parseInline(arg.content, ctx)}</span>`,
      end: arg.end,
    };
  }

  if (name === "includegraphics") {
    const rendered = parseIncludeGraphicsCommand(input, start, ctx);
    if (rendered) return rendered;
    return { html: escapeText("\\includegraphics"), end: i };
  }

  if (name === "includeaudio") {
    const rendered = parseIncludeAudioCommand(input, start, ctx);
    if (rendered) return rendered;
    return { html: escapeText("\\includeaudio"), end: i };
  }

  if (name === "includewidget") {
    const rendered = parseIncludeWidgetCommand(input, start, ctx);
    if (rendered) return rendered;
    return { html: escapeText("\\includewidget"), end: i };
  }

  const textMacro = ctx.textMacros.get(name);
  if (textMacro) {
    const args = readMacroArgs(input, i, textMacro.params);
    if (textMacro.math) {
      const tex = substituteArgs(textMacro.body, args.values);
      return { html: renderMath(tex, false, ctx), end: args.end };
    }
    const expanded = substituteArgs(textMacro.body, args.values);
    return { html: parseInline(expanded, ctx), end: args.end };
  }

  if (ctx.katexMacros[`\\${name}`]) {
    const args = readMacroArgs(
      input,
      i,
      countMacroParams(ctx.katexMacros[`\\${name}`]),
    );
    let tex = `\\${name}`;
    for (const arg of args.values) tex += `{${arg}}`;
    return { html: renderMath(tex, false, ctx), end: args.end };
  }

  if (name === "href") {
    const urlArg = readBraced(input, i);
    if (!urlArg) return { html: escapeText(`\\${name}`), end: i };
    const textArg = readBraced(input, urlArg.end);
    if (!textArg) return { html: escapeText(`\\${name}`), end: i };
    return {
      html: `<a href="${escapeAttr(urlArg.content.trim())}">${parseInline(textArg.content, ctx)}</a>`,
      end: textArg.end,
    };
  }

  if (name === "textcolor") {
    const colorArg = readBraced(input, i);
    if (!colorArg) return { html: escapeText(`\\${name}`), end: i };
    const textArg = readBraced(input, colorArg.end);
    if (!textArg) return { html: escapeText(`\\${name}`), end: i };
    const color =
      resolveXcolorName(colorArg.content.trim()) ?? colorArg.content.trim();
    const cssColor = color.startsWith("#") ? color : color;
    return {
      html: `<span style="color:${escapeAttr(cssColor)}">${parseInline(textArg.content, ctx)}</span>`,
      end: textArg.end,
    };
  }

  if (name === "textsc") {
    const arg = readBraced(input, i);
    if (!arg) return { html: escapeText(`\\${name}`), end: i };
    return {
      html: `<span class="small-caps">${parseInline(arg.content, ctx)}</span>`,
      end: arg.end,
    };
  }

  if (name === "underline") {
    const arg = readBraced(input, i);
    if (!arg) return { html: escapeText(`\\${name}`), end: i };
    const mathTex = mixedInlineToMathTex(arg.content);
    if (mathTex) {
      return {
        html: renderMath(`\\underline{${mathTex}}`, false, ctx),
        end: arg.end,
      };
    }
    return {
      html: `<span class="underline">${parseInline(arg.content, ctx)}</span>`,
      end: arg.end,
    };
  }

  const tag = TEXT_COMMANDS[name];
  if (tag) {
    const arg = readBraced(input, i);
    if (!arg) return { html: escapeText(`\\${name}`), end: i };
    return {
      html: `<${tag}>${parseInline(arg.content, ctx)}</${tag}>`,
      end: arg.end,
    };
  }

  if (name === "dots" || name === "ldots" || name === "cdots") {
    return { html: "…", end: i };
  }

  if (KNOWN_ESCAPES[name] !== undefined) {
    return { html: escapeText(KNOWN_ESCAPES[name]), end: i };
  }

  if (isLikelyMathCommand(name)) {
    return { html: renderMath(`\\${name}`, false, ctx), end: i };
  }

  return { html: escapeText(`\\${name}`), end: i };
}

function mixedInlineToMathTex(input: string): string {
  const parts: string[] = [];
  let textBuf = "";
  let i = 0;

  const flushText = () => {
    if (!textBuf) return;
    parts.push(`\\text{${escapeTextForMathText(textBuf)}}`);
    textBuf = "";
  };

  while (i < input.length) {
    if (input[i] === "$" && input[i + 1] !== "$") {
      flushText();
      const end = findInlineMathEnd(input, i + 1);
      if (end === -1) {
        textBuf += input[i];
        i++;
        continue;
      }
      const math = input.slice(i + 1, end).trim();
      if (math) parts.push(math);
      i = end + 1;
      continue;
    }

    textBuf += input[i];
    i++;
  }

  flushText();
  return parts.join("");
}

function escapeTextForMathText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function parseIncludeGraphicsCommand(
  input: string,
  start: number,
  ctx: Context,
  extraClass = "",
): { html: string; end: number } | null {
  if (!input.startsWith("\\includegraphics", start)) return null;

  let i = start + "\\includegraphics".length;
  let options = "";
  if (input[i] === "[") {
    const optional = readOptionalBracket(input, i);
    if (optional) {
      options = optional.content;
      i = optional.end;
    }
  }

  const arg = readBraced(input, i);
  if (!arg) return null;

  const src = resolveImageSrc(arg.content.trim(), ctx);
  const style = imageStyleFromOptions(options);
  const classes = extraClass ? `note-figure ${extraClass}` : "note-figure";
  const styleAttr = style ? ` style="${escapeAttr(style)}"` : "";

  return {
    html: `<img src="{{COURSE_PREFIX}}${escapeAttr(src)}" alt="" class="${classes}"${styleAttr}>`,
    end: arg.end,
  };
}

function parseIncludeWidgetCommand(
  input: string,
  start: number,
  ctx: Context,
): { html: string; end: number } | null {
  if (!input.startsWith("\\includewidget", start)) return null;

  let i = start + "\\includewidget".length;
  const arg = readBraced(input, i);
  if (!arg) return null;

  const content = loadWidgetContent(arg.content.trim(), ctx);
  return {
    html: content ? renderRawHtml(content) : `<p>Missing widget: ${escapeText(arg.content.trim())}</p>`,
    end: arg.end,
  };
}

function parseIncludeAudioCommand(
  input: string,
  start: number,
  ctx: Context,
): { html: string; end: number } | null {
  if (!input.startsWith("\\includeaudio", start)) return null;

  let i = start + "\\includeaudio".length;
  let options = "";
  if (input[i] === "[") {
    const optional = readOptionalBracket(input, i);
    if (optional) {
      options = optional.content;
      i = optional.end;
    }
  }

  const arg = readBraced(input, i);
  if (!arg) return null;

  const src = resolveAudioSrc(arg.content.trim(), ctx);
  const style = imageStyleFromOptions(options);
  const styleAttr = style ? ` style="${escapeAttr(style)}"` : "";

  return {
    html: `<div class="note-audio-wrap"${styleAttr}><audio src="{{COURSE_PREFIX}}${escapeAttr(src)}" controls preload="metadata" class="note-audio"></audio></div>`,
    end: arg.end,
  };
}

function readColorSpec(
  input: string,
  start: number,
): { value: string; end: number } | null {
  const bracket = readOptionalBracket(input, start);
  if (!bracket) return null;

  if (bracket.content === "HTML") {
    const hex = readBraced(input, bracket.end);
    if (!hex) return null;
    return { value: `#${hex.content}`, end: hex.end };
  }

  const named = XCOLOR_NAMES[bracket.content.trim()];
  if (named) return { value: named, end: bracket.end };

  return { value: bracket.content, end: bracket.end };
}

function readMacroArgs(
  input: string,
  start: number,
  count: number,
): { values: string[]; end: number } {
  const values: string[] = [];
  let i = start;
  for (let n = 0; n < count; n++) {
    const arg = readBraced(input, i);
    if (!arg) break;
    values.push(arg.content);
    i = arg.end;
  }
  return { values, end: i };
}

function countMacroParams(body: string): number {
  const matches = body.match(/#\d/g);
  if (!matches) return 0;
  return Math.max(...matches.map((m) => Number.parseInt(m.slice(1), 10)));
}

function substituteArgs(template: string, args: string[]): string {
  let out = template;
  args.forEach((arg, index) => {
    out = out.replaceAll(`#${index + 1}`, arg);
  });
  return out;
}

function renderMath(tex: string, display: boolean, ctx: Context): string {
  const normalized = normalizeColorCommands(normalizeMathTex(tex));
  try {
    return katex.renderToString(normalized, {
      displayMode: display,
      throwOnError: false,
      strict: "ignore",
      trust: true,
      macros: {
        ...ctx.katexMacros,
        "\\textsc": "\\htmlClass{small-caps}{\\text{#1}}",
      },
    });
  } catch {
    return `<code>${escapeText(tex)}</code>`;
  }
}

function isLikelyMathCommand(name: string): boolean {
  return /^(mathbb|mathds|mathfrak|mathscr|mathcal|mathrm|mathbf|mathit|mathsf|math|operatorname|frac|sqrt|overrightarrow|overleftrightarrow|dot|ddot|dv|pdv|bra|ket|Braket|braket|lcm|im|Stab|Var|Real|blacksquare|square)$/.test(
    name,
  );
}

function normalizeMathTex(tex: string): string {
  // KaTeX supports smallmatrix (since v0.10) but not mathtools' *smallmatrix variants.
  const smallMatrixEnvs: Record<string, { left: string; right: string }> = {
    psmallmatrix: { left: "\\left(", right: "\\right)" },
    bsmallmatrix: { left: "\\left[", right: "\\right]" },
    Bsmallmatrix: { left: "\\left\\{", right: "\\right\\}" },
    vsmallmatrix: { left: "\\left|", right: "\\right|" },
    Vsmallmatrix: { left: "\\left\\|", right: "\\right\\|" },
  };

  let out = tex;
  for (const [env, delim] of Object.entries(smallMatrixEnvs)) {
    out = out
      .replaceAll(`\\begin{${env}}`, `${delim.left}\\begin{smallmatrix}`)
      .replaceAll(`\\end{${env}}`, `\\end{smallmatrix}${delim.right}`);
  }
  return out;
}

function normalizeColorCommands(tex: string): string {
  return tex.replace(/\\(?:text)?color\{([^}]+)\}/g, (match, name: string) => {
    const key = name.trim();
    const hex = resolveXcolorName(key) ?? XCOLOR_NAMES[key];
    if (!hex) return match;
    const cmd = match.startsWith("\\textcolor") ? "\\textcolor" : "\\color";
    return `${cmd}{${hex}}`;
  });
}

function skipSpace(input: string, start: number): number {
  let i = start;
  while (i < input.length && /\s/.test(input[i])) i++;
  return i;
}

function escapeText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(text: string): string {
  return escapeText(text).replaceAll('"', "&quot;");
}

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];
const AUDIO_EXTENSIONS = [".wav", ".mp3", ".ogg", ".m4a", ".webm", ".aac", ".flac"];
const WIDGET_EXTENSIONS = [".html", ".htm"];

function loadWidgetContent(name: string, ctx: Context): string | null {
  const path = resolveWidgetPath(name, ctx);
  if (!path) return null;
  return readFileSync(path, "utf8");
}

function resolveWidgetPath(name: string, ctx: Context): string | null {
  const normalizedName = name.replace(/^\.\//, "");
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(normalizedName);

  for (const base of ctx.widgetPaths) {
    const prefix = base.endsWith("/") ? base : `${base}/`;
    const relative = `${prefix}${normalizedName}`;

    if (hasExtension) {
      const path = join(ctx.projectRoot, relative);
      if (existsSync(path)) return path;
      continue;
    }

    for (const ext of WIDGET_EXTENSIONS) {
      const path = join(ctx.projectRoot, relative + ext);
      if (existsSync(path)) return path;
    }
  }

  return null;
}

function resolveImageSrc(name: string, ctx: Context): string {
  const normalizedName = name.replace(/^\.\//, "");
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(normalizedName);

  for (const base of ctx.imagePaths) {
    const prefix = base.endsWith("/") ? base : `${base}/`;
    const candidate = `${prefix}${normalizedName}`;

    if (hasExtension || !ctx.projectRoot) {
      return candidate;
    }

    for (const ext of IMAGE_EXTENSIONS) {
      if (existsSync(join(ctx.projectRoot, candidate + ext))) {
        return candidate + ext;
      }
    }

    return candidate + ".png";
  }

  return normalizedName;
}

function resolveAudioSrc(name: string, ctx: Context): string {
  const normalizedName = name.replace(/^\.\//, "");
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(normalizedName);

  for (const base of ctx.audioPaths) {
    const prefix = base.endsWith("/") ? base : `${base}/`;
    const candidate = `${prefix}${normalizedName}`;

    if (hasExtension || !ctx.projectRoot) {
      return candidate;
    }

    for (const ext of AUDIO_EXTENSIONS) {
      if (existsSync(join(ctx.projectRoot, candidate + ext))) {
        return candidate + ext;
      }
    }

    return candidate + ".wav";
  }

  return normalizedName;
}

function imageStyleFromOptions(options: string): string {
  if (!options.trim()) return "";

  const styles: string[] = [];
  for (const part of options.split(",")) {
    const trimmed = part.trim();
    const match = trimmed.match(/^([a-zA-Z]+)\s*=\s*(.+)$/);
    if (!match) continue;

    const key = match[1];
    const rawValue = match[2].trim();
    const css = imageOptionToCss(key, rawValue);
    if (css) styles.push(css);
  }

  return styles.join("; ");
}

function imageOptionToCss(key: string, rawValue: string): string | null {
  if (key === "width") {
    const textwidth = rawValue.match(/^([\d.]+)\s*\\textwidth$/);
    if (textwidth) {
      const fraction = Number.parseFloat(textwidth[1]);
      if (!Number.isNaN(fraction)) {
        return `max-width:${fraction * 100}%`;
      }
    }
    if (/^[\d.]+(em|ex|px|pt|rem|%)$/.test(rawValue)) {
      return `max-width:${rawValue}`;
    }
    if (/^[\d.]+cm$/.test(rawValue)) {
      return `max-width:${rawValue}`;
    }
  }

  if (key === "height") {
    if (/^[\d.]+(em|ex|px|pt|rem|cm|%)$/.test(rawValue)) {
      return `max-height:${rawValue}`;
    }
  }

  if (key === "scale") {
    const scale = Number.parseFloat(rawValue);
    if (!Number.isNaN(scale)) {
      return `max-width:${scale * 100}%`;
    }
  }

  return null;
}
