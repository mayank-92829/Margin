import { basename, dirname, extname, joinPath } from "./path";
import { IS_WINDOWS } from "./platform";
import { settings } from "./settings.svelte";

/**
 * How to build and run a file. Commands are templates: ${file} (full path), ${dir}, ${name}
 * (file name without extension), ${base} (file name) and ${exe} (the built program:
 * ${dir}\${name}.exe on Windows, ${dir}/${name} on Linux).
 */
export interface Runner {
  compile?: string;
  run: string;
}

export interface Language {
  name: string;
  exts: string[];
  runner: Runner;
}

const PY = IS_WINDOWS ? "python" : "python3";
const NATIVE = '"${exe}"';

export const LANGUAGES: Language[] = [
  { name: "C", exts: ["c"], runner: { compile: 'gcc "${file}" -o "${exe}" -Wall -g', run: NATIVE } },
  { name: "C++", exts: ["cpp", "cc", "cxx", "c++"], runner: { compile: 'g++ "${file}" -o "${exe}" -Wall -g', run: NATIVE } },
  { name: "Rust", exts: ["rs"], runner: { compile: 'rustc "${file}" -o "${exe}" -g', run: NATIVE } },
  { name: "Go", exts: ["go"], runner: { compile: 'go build -o "${exe}" "${file}"', run: NATIVE } },
  { name: "Java", exts: ["java"], runner: { compile: 'javac "${file}"', run: 'java -cp "${dir}" "${name}"' } },
  { name: "Python", exts: ["py", "pyw"], runner: { compile: `${PY} -m py_compile "\${file}"`, run: `${PY} -u "\${file}"` } },
  { name: "JavaScript", exts: ["js", "mjs", "cjs"], runner: { compile: 'node --check "${file}"', run: 'node "${file}"' } },
  { name: "TypeScript", exts: ["ts"], runner: { run: 'npx --yes tsx "${file}"' } },
  { name: "Ruby", exts: ["rb"], runner: { compile: 'ruby -c "${file}"', run: 'ruby "${file}"' } },
  { name: "Lua", exts: ["lua"], runner: { run: 'lua "${file}"' } },
  { name: "PHP", exts: ["php"], runner: { compile: 'php -l "${file}"', run: 'php "${file}"' } },
  { name: "Perl", exts: ["pl"], runner: { compile: 'perl -c "${file}"', run: 'perl "${file}"' } },
  { name: "Dart", exts: ["dart"], runner: { run: 'dart run "${file}"' } },
  { name: "Shell", exts: ["sh"], runner: { run: 'bash "${file}"' } },
  {
    name: "PowerShell",
    exts: ["ps1"],
    runner: { run: IS_WINDOWS ? 'powershell -NoProfile -ExecutionPolicy Bypass -File "${file}"' : 'pwsh -NoProfile -File "${file}"' },
  },
  ...(IS_WINDOWS ? [{ name: "Batch", exts: ["bat", "cmd"], runner: { run: 'cmd /d /c "${file}"' } }] : []),
];

const byExt = new Map(LANGUAGES.flatMap((l) => l.exts.map((e) => [e, l] as const)));

export function languageForExt(ext: string): Language | undefined {
  return byExt.get(ext);
}

export function runnerFor(path: string | null): Runner | null {
  if (!path) return null;
  const ext = extname(path);
  const custom = settings.runners[ext];
  const base = byExt.get(ext)?.runner;
  if (custom) return { compile: "compile" in custom ? custom.compile || undefined : base?.compile, run: custom.run || base?.run || "" };
  return base ?? null;
}

export function templateVars(path: string): Record<string, string> {
  const dir = dirname(path);
  const name = basename(path).replace(/\.[^.]+$/, "");
  return { file: path, dir, name, base: basename(path), exe: joinPath(dir, IS_WINDOWS ? `${name}.exe` : name) };
}

/** Splits a command template into arguments (double quotes group), then fills in the variables. */
export function expand(template: string, vars: Record<string, string>): string[] {
  const args: string[] = [];
  let cur = "";
  let quoted = false;
  let started = false;
  for (const ch of template) {
    if (ch === '"') {
      quoted = !quoted;
      started = true;
    } else if (!quoted && /\s/.test(ch)) {
      if (started) args.push(cur);
      cur = "";
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started) args.push(cur);
  return args.map((a) => a.replace(/\$\{(\w+)\}/g, (m, k: string) => vars[k] ?? m));
}

/** The program a command template starts, unless it's the built program itself. */
export function programOf(template: string | undefined): string | null {
  const first = template ? expand(template, {})[0] : undefined;
  return first && !first.includes("${") ? first : null;
}
