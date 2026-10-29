// Windows-style path helpers. Synchronous, so they can be used anywhere.

const SEP = /[\\/]+/;

export function basename(p: string): string {
  const parts = p.split(SEP);
  return parts[parts.length - 1] || p;
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i <= 0 ? p : p.slice(0, i);
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
}

export function isAbsolute(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]{2}/.test(p);
}

export function normalize(p: string): string {
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
  return isAbsolute(rel) ? normalize(rel) : normalize(base + "\\" + rel);
}

export function samePath(a: string, b: string): boolean {
  return normalize(a).toLowerCase() === normalize(b).toLowerCase();
}
