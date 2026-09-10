import { readBraced, type Braced } from "./tex-read.js";

export interface Macro {
  params: number;
  body: string;
  math: boolean;
}

export interface Environment {
  params: number;
  begin: string;
  end: string;
  color?: string;
}

export interface Context {
  textMacros: Map<string, Macro>;
  katexMacros: Record<string, string>;
  environments: Map<string, Environment>;
  imagePaths: string[];
  audioPaths: string[];
  widgetPaths: string[];
  projectRoot: string;
  usedSubsectionSlugs: Set<string>;
}

export function createContext(): Context {
  return {
    textMacros: new Map(),
    katexMacros: {},
    environments: new Map(),
    imagePaths: ["images/"],
    audioPaths: ["audio/"],
    widgetPaths: ["widgets/"],
    projectRoot: "",
    usedSubsectionSlugs: new Set(),
  };
}

/** Built-in approximations for preamble commands that need unavailable packages. */
export function applyBuiltinDefinitions(ctx: Context): void {
  const math = (body: string, params: number): Macro => ({
    params,
    body,
    math: true,
  });

  ctx.textMacros.set("horizontal", {
    params: 0,
    body: "",
    math: false,
  });
  ctx.textMacros.set("circled", { params: 1, body: "", math: false });

  ctx.textMacros.set("dt", math("\\dot{#1}", 1));
  ctx.textMacros.set("ddt", math("\\ddot{#1}", 1));
  ctx.textMacros.set("extended", math("\\overleftrightarrow{#1}", 1));
  ctx.textMacros.set("rightray", math("\\overrightarrow{#1}", 1));

  // dsfont's \mathds{1} (indicator); KaTeX has no \mathds, and \mathbb only covers A–Z.
  ctx.katexMacros["\\mathds"] = "\\mathbf{#1}";

  for (const name of ["dt", "ddt", "extended", "rightray", "circled"]) {
    delete ctx.katexMacros[`\\${name}`];
  }
}

export function parsePreamble(source: string, ctx: Context): void {
  let i = 0;
  while (i < source.length) {
    i = skipPreambleNoise(source, i);
    if (i >= source.length) break;
    if (source[i] !== "\\") {
      i++;
      continue;
    }

    const cmd = readCommandName(source, i);
    if (!cmd) {
      i++;
      continue;
    }

    i = cmd.end;

    if (cmd.name === "graphicspath") {
      const arg = readBraced(source, i);
      if (arg) {
        ctx.imagePaths = parseMediaPathContent(arg.content, "images/");
        i = arg.end;
      }
      continue;
    }

    if (cmd.name === "audiopath") {
      const arg = readBraced(source, i);
      if (arg) {
        ctx.audioPaths = parseMediaPathContent(arg.content, "audio/");
        i = arg.end;
      }
      continue;
    }

    if (cmd.name === "widgetpath") {
      const arg = readBraced(source, i);
      if (arg) {
        ctx.widgetPaths = parseMediaPathContent(arg.content, "widgets/");
        i = arg.end;
      }
      continue;
    }

    if (
      cmd.name === "usepackage" ||
      cmd.name === "documentclass" ||
      cmd.name === "pagestyle" ||
      cmd.name === "fancyhf" ||
      cmd.name === "renewcommand" ||
      cmd.name === "setlength" ||
      cmd.name === "baselinestretch" ||
      cmd.name === "makeatletter" ||
      cmd.name === "makeatother" ||
      cmd.name === "cfttoctitlefont" ||
      cmd.name === "cftaftertoctitle" ||
      cmd.name === "contentsname"
    ) {
      i = skipPackageLine(source, i);
      continue;
    }

    if (cmd.name === "newcommand" || cmd.name === "renewcommand") {
      const parsed = parseNewCommand(source, i - cmd.name.length - 1, cmd.name);
      if (parsed) {
        registerCommand(ctx, parsed.name, parsed.macro);
        i = parsed.end;
        continue;
      }
    }

    if (cmd.name === "DeclareMathOperator") {
      const parsed = parseDeclareMathOperator(source, i);
      if (parsed) {
        ctx.katexMacros[`\\${parsed.name}`] = `\\operatorname{${parsed.text}}`;
        i = parsed.end;
        continue;
      }
    }

    if (cmd.name === "newenvironment") {
      const parsed = parseNewEnvironment(source, i);
      if (parsed) {
        ctx.environments.set(parsed.name, parsed.env);
        i = parsed.end;
        continue;
      }
    }
  }
}

function registerCommand(ctx: Context, name: string, macro: Macro): void {
  if (macro.math) {
    ctx.katexMacros[`\\${name}`] = macro.body;
    return;
  }
  if (name === "horizontal" || name === "circled") return;
  ctx.textMacros.set(name, macro);
}

function parseNewCommand(
  source: string,
  backslash: number,
  kind: string,
): { name: string; macro: Macro; end: number } | null {
    let i = backslash + 1 + kind.length;
    if (source[i] === "*") i++;

    const nameArg = readBraced(source, i);
  if (!nameArg) return null;
  i = nameArg.end;

  let params = 0;
  if (source[i] === "[") {
    const close = source.indexOf("]", i);
    if (close === -1) return null;
    params = Number.parseInt(source.slice(i + 1, close), 10) || 0;
    i = close + 1;
  }

  if (source[i] === "[") {
    i = source.indexOf("]", i) + 1;
  }

  const body = readBraced(source, i);
  if (!body) return null;

  const name = nameArg.content.replace(/^\*/, "").replace(/^\\/, "");
  const macro: Macro = {
    params,
    body: body.content,
    math: looksLikeMath(body.content),
  };

  return { name, macro, end: body.end };
}

function parseDeclareMathOperator(
  source: string,
  afterName: number,
): { name: string; text: string; end: number } | null {
  let i = afterName;
  if (source[i] === "*") i++;

  const nameArg = readBraced(source, i);
  if (!nameArg) return null;
  i = nameArg.end;

  const textArg = readBraced(source, i);
  if (!textArg) return null;

  return {
    name: nameArg.content.replace(/^\\/, ""),
    text: textArg.content,
    end: textArg.end,
  };
}

function skipWhitespace(source: string, i: number): number {
  while (i < source.length && /\s/.test(source[i])) i++;
  return i;
}

function parseNewEnvironment(
  source: string,
  afterName: number,
): { name: string; env: Environment; end: number } | null {
  let i = skipWhitespace(source, afterName);
  const nameArg = readBraced(source, i);
  if (!nameArg) return null;
  i = skipWhitespace(source, nameArg.end);

  let params = 0;
  if (source[i] === "[") {
    const close = source.indexOf("]", i);
    if (close === -1) return null;
    params = Number.parseInt(source.slice(i + 1, close), 10) || 0;
    i = skipWhitespace(source, close + 1);
  }

  if (source[i] === "[") {
    i = skipWhitespace(source, source.indexOf("]", i) + 1);
  }

  i = skipWhitespace(source, i);
  const begin = readBraced(source, i);
  if (!begin) return null;
  i = skipWhitespace(source, begin.end);

  const end = readBraced(source, i);
  if (!end) return null;

  return {
    name: nameArg.content,
    env: {
      params,
      begin: begin.content,
      end: end.content,
      color: extractEnvColor(begin.content),
    },
    end: end.end,
  };
}

const XCOLOR_NAMES: Record<string, string> = {
  purple: "#bf0140",
  "red!75": "#ff403f",
  "black!60": "#666666",
  "black!40": "#909090",
  cyan: "#01adef",
};

function extractEnvColor(begin: string): string | undefined {
  const html = begin.match(/\\color\[HTML\]\{([^}]+)\}/);
  if (html) return `#${html[1]}`;

  const named = begin.match(/\\color\{([^}]+)\}/);
  if (named) return XCOLOR_NAMES[named[1].trim()] ?? undefined;

  return undefined;
}

export function resolveXcolorName(name: string): string | undefined {
  return XCOLOR_NAMES[name.trim()];
}

function looksLikeMath(body: string): boolean {
  if (/\\(over|frac|hat|dot|vec|math[a-z]+|operatorname|accentset)/.test(body)) {
    return true;
  }
  if (/[\^_]/.test(body) && !/\\textbf|\\textit|\\emph/.test(body)) {
    return true;
  }
  return false;
}

function readCommandName(
  source: string,
  start: number,
): { name: string; end: number } | null {
  if (source[start] !== "\\") return null;
  const match = source.slice(start + 1).match(/^([a-zA-Z@*]+)/);
  if (!match) return null;
  return { name: match[1], end: start + 1 + match[1].length };
}

function skipPreambleNoise(source: string, start: number): number {
  let i = start;
  while (i < source.length) {
    if (/\s/.test(source[i])) {
      i++;
      continue;
    }
    if (source[i] === "%") {
      const nl = source.indexOf("\n", i);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    break;
  }
  return i;
}

function parseMediaPathContent(content: string, fallback: string): string[] {
  const paths: string[] = [];
  const re = /\{([^{}]*)\}/g;
  let match = re.exec(content);
  while (match) {
    paths.push(match[1]);
    match = re.exec(content);
  }
  return paths.length > 0 ? paths : [fallback];
}

function skipPackageLine(source: string, start: number): number {
  let i = start;
  while (i < source.length) {
    if (source[i] === "\\" && i > start) break;
    if (source[i] === "\n") return i + 1;
    if (source[i] === "{") {
      const braced = readBraced(source, i);
      if (braced) {
        i = braced.end;
        continue;
      }
    }
    if (source[i] === "[") {
      const close = source.indexOf("]", i);
      if (close !== -1) {
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  return i;
}

export { readBraced, type Braced };
