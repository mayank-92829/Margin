// Find in the rendered markdown preview, using the CSS Custom Highlight API
// (highlights without touching the DOM, so the preview never re-renders).

export interface FindOptions {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export function buildRegex(o: FindOptions): RegExp | null {
  if (!o.query) return null;
  let src = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(src, "gu" + (o.caseSensitive ? "" : "i"));
  } catch {
    return null;
  }
}

export function findRanges(root: Node, re: RegExp, limit = 5000): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && ranges.length < limit; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    if (!text) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) && ranges.length < limit) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      const r = document.createRange();
      r.setStart(node, m.index);
      r.setEnd(node, m.index + m[0].length);
      ranges.push(r);
    }
  }
  return ranges;
}

export function paintHighlights(ranges: Range[], current: number): void {
  if (!("highlights" in CSS)) return;
  CSS.highlights.set("margin-find", new Highlight(...ranges));
  if (ranges[current]) CSS.highlights.set("margin-find-current", new Highlight(ranges[current]));
  else CSS.highlights.delete("margin-find-current");
}

export function clearHighlights(): void {
  if (!("highlights" in CSS)) return;
  CSS.highlights.delete("margin-find");
  CSS.highlights.delete("margin-find-current");
}
