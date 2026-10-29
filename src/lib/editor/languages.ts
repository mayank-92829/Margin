import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages as builtIn } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { basename } from "../path";

export const languages: readonly LanguageDescription[] = builtIn;

const extraExtensions: Record<string, string> = {
  txt: "", text: "", log: "", nfo: "",
  jsonc: "JSON", json5: "JSON",
  conf: "Properties files", cfg: "Properties files",
};

export function detectLanguage(path: string | null): LanguageDescription | null {
  if (!path) return null;
  const name = basename(path);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (ext in extraExtensions) {
    const lang = extraExtensions[ext];
    return lang ? languageByName(lang) : null;
  }
  return LanguageDescription.matchFilename(languages, name);
}

export function languageByName(name: string): LanguageDescription | null {
  return languages.find((l) => l.name === name) ?? LanguageDescription.matchLanguageName(languages, name, false);
}

const cache = new Map<string, Promise<Extension>>();

/** Loads a language's parser on demand. Markdown gets GFM and highlighting inside code blocks. */
export function loadLanguage(desc: LanguageDescription): Promise<Extension> {
  let p = cache.get(desc.name);
  if (!p) {
    p =
      desc.name === "Markdown"
        ? import("@codemirror/lang-markdown").then(({ markdown, markdownLanguage }) =>
            markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
          )
        : desc.load().then((s: LanguageSupport) => s as Extension);
    p.catch(() => cache.delete(desc.name));
    cache.set(desc.name, p);
  }
  return p;
}

export function isMarkdownPath(path: string | null): boolean {
  return detectLanguage(path)?.name === "Markdown";
}
