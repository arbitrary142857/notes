import hljs from "highlight.js/lib/core";
import c from "highlight.js/lib/languages/c";
import python from "highlight.js/lib/languages/python";

const LANGUAGES: Record<string, typeof python> = {
  c,
  python,
};

for (const [name, language] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, language);
}

export function highlightCode(code: string, language: string): string | null {
  const lang = language.trim().toLowerCase();
  if (!LANGUAGES[lang]) return null;

  try {
    return hljs.highlight(code, { language: lang }).value;
  } catch {
    return null;
  }
}
