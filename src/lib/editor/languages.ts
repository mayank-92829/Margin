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

/** Detects programming language from document content heuristics (for untitled / unsaved tabs). */
export function detectLanguageFromContent(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const sample = text.slice(0, 2048);

  // Shebang
  if (/^#!\s*\/(?:usr\/)?bin\/(?:env\s+)?python/m.test(sample)) return "Python";
  if (/^#!\s*\/(?:usr\/)?bin\/(?:env\s+)?(?:bash|sh|zsh)/m.test(sample)) return "Shell";
  if (/^#!\s*\/(?:usr\/)?bin\/(?:env\s+)?node/m.test(sample)) return "JavaScript";

  // Rust (fn main, println!, let mut, use std::)
  if (
    /\bfn\s+main\b/.test(sample) ||
    /\b(?:println|eprintln|format|vec)!\s*[\(\[]/.test(sample) ||
    /\blet\s+mut\s+/.test(sample) ||
    /\buse\s+std::/.test(sample) ||
    /\bfn\s+[a-z_][a-z0-9_]*\s*\([^)]*\)\s*(?:->\s*[^{]+)?\s*\{/.test(sample)
  ) {
    return "Rust";
  }

  // C++ (check before C)
  if (
    /#\s*include\s*<(?:iostream|vector|string|algorithm|map|set|memory|thread|utility|cmath|queue|deque|stack|fstream)>/i.test(sample) ||
    /\bstd::/.test(sample) ||
    /\bcout\s*<</.test(sample) ||
    /\bcin\s*>>/.test(sample) ||
    /\busing\s+namespace\s+std\s*;/.test(sample) ||
    /\btemplate\s*<[^>]+>/.test(sample)
  ) {
    return "C++";
  }

  // C
  if (
    /#\s*include\s*<[a-zA-Z0-9_./]+\.h>/i.test(sample) ||
    /\b(?:int|void)\s+main\s*\([^)]*\)\s*\{?/.test(sample) ||
    /\b(?:printf|scanf|puts)\s*\(/.test(sample)
  ) {
    return "C";
  }

  // Python
  if (
    /\bprint\s*\(/.test(sample) ||
    /^\s*def\s+[a-z_][a-z0-9_]*\s*\(/m.test(sample) ||
    /^\s*class\s+[A-Z]\w*.*?:/m.test(sample) ||
    /^\s*(?:import\s+[a-z0-9_]+|from\s+[a-z0-9_.]+\s+import)/m.test(sample) ||
    /\bif\s+__name__\s*==\s*["']__main__["']\s*:/m.test(sample)
  ) {
    return "Python";
  }

  // Go
  if (
    /^\s*package\s+[a-z0-9_]+/m.test(sample) ||
    /\bfunc\s+(?:\([^)]+\)\s*)?[a-zA-Z0-9_]+\s*\(/.test(sample) ||
    /\bfmt\.(?:Println|Printf|Print)\s*\(/.test(sample)
  ) {
    return "Go";
  }

  // Java
  if (
    /\bpublic\s+static\s+void\s+main\b/.test(sample) ||
    /\bSystem\.(?:out|err)\.(?:println|print|printf)\s*\(/.test(sample) ||
    /\bpublic\s+(?:class|interface|enum)\s+[A-Z]\w*/.test(sample)
  ) {
    return "Java";
  }

  // HTML / XML
  if (
    /^\s*<!DOCTYPE\s+html/i.test(sample) ||
    /<\s*(?:html|head|body|div|span|p|h[1-6]|button|table|a|ul|ol|li|script|style)\b[^>]*>/i.test(sample)
  ) {
    return "HTML";
  }
  if (/^\s*<\?xml\b/i.test(sample)) return "XML";

  // JSON
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      JSON.parse(trimmed);
      return "JSON";
    } catch {
      if (/^\s*\{\s*"[^"]+"\s*:\s*/.test(sample)) return "JSON";
    }
  } else if (/^\s*\{\s*"[^"]+"\s*:\s*/.test(sample)) {
    return "JSON";
  }

  // Markdown
  if (/^#{1,6}\s+\S/m.test(sample) || /^\s*```[a-z]*\s*$/m.test(sample)) {
    return "Markdown";
  }

  // TypeScript / JavaScript
  if (
    /^\s*(?:export\s+)?(?:interface|type)\s+[A-Z]\w*/m.test(sample) ||
    /:\s*(?:string|number|boolean|any|void)\b/.test(sample)
  ) {
    return "TypeScript";
  }
  if (
    /\bconsole\.(?:log|error|warn|info|debug)\s*\(/.test(sample) ||
    /\b(?:const|let|var)\s+[a-zA-Z0-9_$]+\s*=\s*(?:require\(|=>|\(?function\b)/.test(sample) ||
    /^\s*(?:import|export)\s+.*\s+from\s+["'][^"']+["']/m.test(sample)
  ) {
    return "JavaScript";
  }

  return null;
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
