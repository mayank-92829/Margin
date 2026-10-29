//! Reading and writing text files: encoding detection, line endings, safe saves.

use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub size: u64,
    pub mtime: f64,
    pub readonly: bool,
}

pub fn stat_of(meta: &fs::Metadata) -> FileStat {
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    FileStat { size: meta.len(), mtime, readonly: meta.permissions().readonly() }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    pub path: String,
    /// `None` when the file is larger than `max_bytes` and should use large-file mode.
    pub content: Option<String>,
    pub encoding: String,
    pub bom: bool,
    /// "CRLF", "LF", "CR", or "" when the file has no line breaks.
    pub eol: &'static str,
    pub mixed_eol: bool,
    pub binary: bool,
    /// Some bytes could not be decoded and were replaced.
    pub lossy: bool,
    pub stat: FileStat,
}

/// Guess whether BOM-less bytes are UTF-16 by looking at where the zero bytes fall.
fn sniff_utf16(bytes: &[u8]) -> Option<&'static Encoding> {
    let sample = &bytes[..bytes.len().min(4096) & !1];
    if sample.len() < 4 {
        return None;
    }
    let pairs = sample.len() / 2;
    let (mut even, mut odd) = (0usize, 0usize);
    for pair in sample.as_chunks::<2>().0 {
        if pair[0] == 0 {
            even += 1;
        }
        if pair[1] == 0 {
            odd += 1;
        }
    }
    if odd * 10 > pairs * 4 && even * 20 < pairs {
        Some(UTF_16LE)
    } else if even * 10 > pairs * 4 && odd * 20 < pairs {
        Some(UTF_16BE)
    } else {
        None
    }
}

/// Returns (encoding, has_bom, bom_length).
pub fn detect_encoding(bytes: &[u8]) -> (&'static Encoding, bool, usize) {
    if let Some((enc, len)) = Encoding::for_bom(bytes) {
        return (enc, true, len);
    }
    if let Some(enc) = sniff_utf16(bytes) {
        return (enc, false, 0);
    }
    if std::str::from_utf8(bytes).is_ok() {
        return (UTF_8, false, 0);
    }
    // A cut-off multi-byte sequence at the very end still counts as UTF-8.
    if let Err(e) = std::str::from_utf8(bytes) {
        if e.error_len().is_none() && bytes.len() - e.valid_up_to() < 4 && e.valid_up_to() > 0 {
            return (UTF_8, false, 0);
        }
    }
    let mut det = chardetng::EncodingDetector::new();
    let sample = &bytes[..bytes.len().min(1 << 20)];
    det.feed(sample, sample.len() == bytes.len());
    (det.guess(None, true), false, 0)
}

pub fn detect_eol(text: &str) -> (&'static str, bool) {
    let b = text.as_bytes();
    let (mut crlf, mut lf, mut cr) = (0usize, 0usize, 0usize);
    let mut skip_next = false;
    for i in memchr::memchr2_iter(b'\r', b'\n', b) {
        if skip_next {
            skip_next = false;
            continue;
        }
        if b[i] == b'\r' {
            if b.get(i + 1) == Some(&b'\n') {
                crlf += 1;
                skip_next = true;
            } else {
                cr += 1;
            }
        } else {
            lf += 1;
        }
    }
    let kinds = (crlf > 0) as u8 + (lf > 0) as u8 + (cr > 0) as u8;
    let eol = if crlf == 0 && lf == 0 && cr == 0 {
        ""
    } else if crlf >= lf && crlf >= cr {
        "CRLF"
    } else if lf >= cr {
        "LF"
    } else {
        "CR"
    };
    (eol, kinds > 1)
}

fn decode(bytes: Vec<u8>, enc: &'static Encoding, bom_len: usize) -> (String, bool) {
    if enc == UTF_8 {
        let body = if bom_len > 0 { bytes[bom_len..].to_vec() } else { bytes };
        match String::from_utf8(body) {
            Ok(s) => (s, false),
            Err(e) => (String::from_utf8_lossy(e.as_bytes()).into_owned(), true),
        }
    } else {
        let (text, had_errors) = enc.decode_without_bom_handling(&bytes[bom_len..]);
        (text.into_owned(), had_errors)
    }
}

pub fn encoding_by_name(name: &str) -> Option<&'static Encoding> {
    Encoding::for_label(name.trim().as_bytes())
}

#[tauri::command(async)]
pub fn read_text_file(path: String, max_bytes: u64, encoding: Option<String>) -> Result<OpenedFile, String> {
    let p = Path::new(&path);
    let meta = fs::metadata(p).map_err(|e| io_message(&e, p))?;
    if meta.is_dir() {
        return Err(format!("\"{}\" is a folder, not a file.", path));
    }
    let stat = stat_of(&meta);
    if meta.len() > max_bytes {
        return Ok(OpenedFile {
            path,
            content: None,
            encoding: String::new(),
            bom: false,
            eol: "",
            mixed_eol: false,
            binary: false,
            lossy: false,
            stat,
        });
    }
    let bytes = fs::read(p).map_err(|e| io_message(&e, p))?;
    let (detected, bom, bom_len) = detect_encoding(&bytes);
    let enc = match encoding.as_deref().and_then(encoding_by_name) {
        Some(forced) => forced,
        None => detected,
    };
    // Only strip the BOM when it belongs to the encoding being used.
    let bom_len = if bom && enc == detected { bom_len } else { 0 };
    let is_utf16 = enc == UTF_16LE || enc == UTF_16BE;
    let binary = !is_utf16 && memchr::memchr(0, &bytes[..bytes.len().min(8192)]).is_some();
    let (content, lossy) = decode(bytes, enc, bom_len);
    let (eol, mixed_eol) = detect_eol(&content);
    Ok(OpenedFile {
        path,
        content: Some(content),
        encoding: enc.name().to_string(),
        bom: bom_len > 0,
        eol,
        mixed_eol,
        binary,
        lossy,
        stat,
    })
}

fn encode(content: &str, enc: &'static Encoding, bom: bool) -> Result<Vec<u8>, String> {
    if enc == UTF_8 {
        let mut out = Vec::with_capacity(content.len() + 3);
        if bom {
            out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        }
        out.extend_from_slice(content.as_bytes());
        return Ok(out);
    }
    if enc == UTF_16LE || enc == UTF_16BE {
        let le = enc == UTF_16LE;
        let mut out = Vec::with_capacity(content.len() * 2 + 2);
        if bom {
            out.extend_from_slice(if le { &[0xFF, 0xFE] } else { &[0xFE, 0xFF] });
        }
        for unit in content.encode_utf16() {
            out.extend_from_slice(&if le { unit.to_le_bytes() } else { unit.to_be_bytes() });
        }
        return Ok(out);
    }
    let (bytes, _, had_errors) = enc.encode(content);
    if had_errors {
        return Err(format!(
            "UNMAPPABLE:Some characters in this document can't be saved as {}.",
            enc.name()
        ));
    }
    Ok(bytes.into_owned())
}

#[cfg(windows)]
fn is_hidden_or_system(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes() & (0x2 | 0x4) != 0
}

#[cfg(not(windows))]
fn is_hidden_or_system(_meta: &fs::Metadata) -> bool {
    false
}

/// Writes via a temp file + rename so a crash mid-save can never leave a half-written file.
/// Falls back to an in-place write for symlinks, hidden/system files, or when the folder
/// doesn't allow creating files.
pub fn write_atomic(path: &Path, data: &[u8]) -> io::Result<()> {
    let link_meta = fs::symlink_metadata(path).ok();
    if let Some(m) = &link_meta {
        if m.file_type().is_file() && m.permissions().readonly() {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "READONLY"));
        }
    }
    let plain = match &link_meta {
        None => true,
        Some(m) => m.file_type().is_file() && !is_hidden_or_system(m),
    };
    if plain {
        if let (Some(dir), Some(name)) = (path.parent(), path.file_name()) {
            let tmp = dir.join(format!(".{}.margin-tmp", name.to_string_lossy()));
            let attempt = (|| -> io::Result<()> {
                let mut f = File::create(&tmp)?;
                f.write_all(data)?;
                f.sync_all()?;
                drop(f);
                fs::rename(&tmp, path)
            })();
            match attempt {
                Ok(()) => return Ok(()),
                Err(_) => {
                    let _ = fs::remove_file(&tmp);
                }
            }
        }
    }
    let mut f = if link_meta.is_some() {
        OpenOptions::new().write(true).truncate(true).open(path)?
    } else {
        OpenOptions::new().write(true).create_new(true).open(path)?
    };
    f.write_all(data)?;
    f.sync_all()
}

fn io_message(e: &io::Error, path: &Path) -> String {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    match e.kind() {
        io::ErrorKind::NotFound => format!("NOTFOUND:\"{}\" doesn't exist.", name),
        io::ErrorKind::PermissionDenied if e.to_string().contains("READONLY") => {
            format!("READONLY:\"{}\" is read-only.", name)
        }
        io::ErrorKind::PermissionDenied => format!("DENIED:Access to \"{}\" was denied.", name),
        _ => format!("{} ({})", e, name),
    }
}

#[tauri::command(async)]
pub fn write_text_file(
    path: String,
    content: String,
    encoding: String,
    bom: bool,
    eol: String,
) -> Result<FileStat, String> {
    let enc = encoding_by_name(&encoding).unwrap_or(UTF_8);
    let text = match eol.as_str() {
        "CRLF" => content.replace('\n', "\r\n"),
        "CR" => content.replace('\n', "\r"),
        _ => content,
    };
    let bytes = encode(&text, enc, bom)?;
    let p = Path::new(&path);
    write_atomic(p, &bytes).map_err(|e| io_message(&e, p))?;
    let meta = fs::metadata(p).map_err(|e| io_message(&e, p))?;
    Ok(stat_of(&meta))
}

#[tauri::command(async)]
pub fn stat_files(paths: Vec<String>) -> Vec<Option<FileStat>> {
    paths
        .iter()
        .map(|p| fs::metadata(p).ok().filter(|m| m.is_file()).map(|m| stat_of(&m)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eol_detection() {
        assert_eq!(detect_eol("a\r\nb\r\n"), ("CRLF", false));
        assert_eq!(detect_eol("a\nb\n"), ("LF", false));
        assert_eq!(detect_eol("a\rb"), ("CR", false));
        assert_eq!(detect_eol("a\r\nb\nc\r\n"), ("CRLF", true));
        assert_eq!(detect_eol("abc"), ("", false));
    }

    #[test]
    fn encoding_detection() {
        assert_eq!(detect_encoding(b"hello").0, UTF_8);
        assert_eq!(detect_encoding("héllo".as_bytes()).0, UTF_8);
        let (enc, bom, len) = detect_encoding(&[0xEF, 0xBB, 0xBF, b'a']);
        assert_eq!((enc, bom, len), (UTF_8, true, 3));
        let le: Vec<u8> = "hello world".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        assert_eq!(detect_encoding(&le).0, UTF_16LE);
        assert_eq!(detect_encoding(&[b'c', b'a', b'f', 0xE9, b' ', b'o', b'k']).0.name(), "windows-1252");
    }

    #[test]
    fn roundtrip_utf16_and_unmappable() {
        let enc = encode("hi✓", UTF_16LE, true).unwrap();
        let (text, _) = decode(enc, UTF_16LE, 2);
        assert_eq!(text, "hi✓");
        let w1252 = encoding_by_name("windows-1252").unwrap();
        assert!(encode("✓", w1252, false).unwrap_err().starts_with("UNMAPPABLE:"));
    }

    #[test]
    fn atomic_write_and_readonly() {
        let dir = std::env::temp_dir().join(format!("margin-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.txt");
        write_atomic(&f, b"one").unwrap();
        write_atomic(&f, b"two").unwrap();
        assert_eq!(fs::read(&f).unwrap(), b"two");
        let mut perms = fs::metadata(&f).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&f, perms.clone()).unwrap();
        assert!(write_atomic(&f, b"three").is_err());
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        fs::set_permissions(&f, perms).unwrap();
        fs::remove_dir_all(&dir).unwrap();
    }
}
