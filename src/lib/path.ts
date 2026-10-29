// Path helpers for Windows ("C:\x", "\\server\share") and Linux ("/home/x") paths.
// Synchronous, so they can be used anywhere.

const SEP = /[\\/]+/;

export function basename(p: string): string {
  const parts = p.split(SEP);
  return parts[parts.length - 1] || p;
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  if (i === 0 && p.startsWith("/")) return "/";
  return i <= 0 ? p : p.slice(0, i);
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
}

/** A Linux-style absolute path. */
function isPosix(p: string): boolean {
  return p.startsWith("/") && !p.startsWith("//");
}

export function isAbsolute(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]{2}/.test(p) || isPosix(p);
}

/** The separator a path uses. */
export function sepOf(p: string): string {
  return isPosix(p) ? "/" : "\\";
}

export function joinPath(dir: string, name: string): string {
  const sep = sepOf(dir);
  const rel = name.replace(/[\\/]/g, sep);
  return /[\\/]$/.test(dir) ? dir + rel : dir + sep + rel;
}

export function normalize(p: string): string {
  if (isPosix(p)) {
    const out: string[] = [];
    for (const part of p.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") out.pop();
      else out.push(part);
    }
    return "/" + out.join("/");
  }
  const unc = /^[\\/]{2}/.test(p);
  const out: string[] = [];
  for (const part of p.split(SEP)) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      if (out.length > 1 || (out.length === 1 && !/^[a-zA-Z]:$/.test(out[0]))) out.pop();
      continue;
    }
    out.push(part);
  }
  const joined = out.join("\\");
  return unc ? "\\\\" + joined : out.length === 1 && /:$/.test(joined) ? joined + "\\" : joined;
}

export function resolvePath(base: string, rel: string): string {
  return isAbsolute(rel) ? normalize(rel) : normalize(base + sepOf(base) + rel);
}

/** Windows paths compare case-insensitively; Linux paths don't. */
export function samePath(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  return isPosix(x) ? x === y : x.toLowerCase() === y.toLowerCase();
}
