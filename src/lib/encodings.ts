export interface EncodingOption {
  label: string;
  encoding: string;
  bom: boolean;
}

/** Names match encoding_rs (the Rust side). */
export const ENCODINGS: EncodingOption[] = [
  { label: "UTF-8", encoding: "UTF-8", bom: false },
  { label: "UTF-8 with BOM", encoding: "UTF-8", bom: true },
  { label: "UTF-16 LE", encoding: "UTF-16LE", bom: true },
  { label: "UTF-16 BE", encoding: "UTF-16BE", bom: true },
  { label: "Western (Windows-1252)", encoding: "windows-1252", bom: false },
  { label: "Central European (Windows-1250)", encoding: "windows-1250", bom: false },
  { label: "Cyrillic (Windows-1251)", encoding: "windows-1251", bom: false },
  { label: "Greek (Windows-1253)", encoding: "windows-1253", bom: false },
  { label: "Turkish (Windows-1254)", encoding: "windows-1254", bom: false },
  { label: "Hebrew (Windows-1255)", encoding: "windows-1255", bom: false },
  { label: "Arabic (Windows-1256)", encoding: "windows-1256", bom: false },
  { label: "Baltic (Windows-1257)", encoding: "windows-1257", bom: false },
  { label: "Vietnamese (Windows-1258)", encoding: "windows-1258", bom: false },
  { label: "Thai (Windows-874)", encoding: "windows-874", bom: false },
  { label: "Cyrillic (KOI8-R)", encoding: "KOI8-R", bom: false },
  { label: "Cyrillic (KOI8-U)", encoding: "KOI8-U", bom: false },
  { label: "DOS Cyrillic (IBM 866)", encoding: "IBM866", bom: false },
  { label: "Japanese (Shift JIS)", encoding: "Shift_JIS", bom: false },
  { label: "Japanese (EUC-JP)", encoding: "EUC-JP", bom: false },
  { label: "Japanese (ISO-2022-JP)", encoding: "ISO-2022-JP", bom: false },
  { label: "Chinese Simplified (GBK)", encoding: "GBK", bom: false },
  { label: "Chinese Simplified (GB18030)", encoding: "gb18030", bom: false },
  { label: "Chinese Traditional (Big5)", encoding: "Big5", bom: false },
  { label: "Korean (EUC-KR)", encoding: "EUC-KR", bom: false },
  { label: "Western (ISO-8859-15)", encoding: "ISO-8859-15", bom: false },
  { label: "Central European (ISO-8859-2)", encoding: "ISO-8859-2", bom: false },
  { label: "Macintosh (Mac Roman)", encoding: "macintosh", bom: false },
];

export function encodingLabel(encoding: string, bom: boolean): string {
  const e = encoding.toLowerCase();
  const exact = ENCODINGS.find((o) => o.encoding.toLowerCase() === e && o.bom === bom);
  const any = exact ?? ENCODINGS.find((o) => o.encoding.toLowerCase() === e);
  if (!any) return encoding;
  return any.label.replace(/^.*\((.*)\)$/, "$1");
}
