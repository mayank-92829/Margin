//! Large-file mode: files too big for the regular editor are read on demand.
//!
//! A background thread builds a sparse line index (one offset per `STEP` lines), so any
//! line can be found by jumping to the nearest checkpoint and scanning at most `STEP` lines.
//! The file is never held in memory and never locked against other programs.

use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use serde::Serialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use tauri::State;

const STEP: u64 = 1024;
const CHUNK: usize = 4 << 20;
const MAX_REGION: usize = 64 << 20;
/// Lines longer than this are cut off for display.
const MAX_LINE: usize = 10_000;

#[derive(Default)]
struct Index {
    checkpoints: Vec<u64>,
    newlines: u64,
    bytes: u64,
    done: bool,
    error: Option<String>,
}

struct LargeFile {
    path: PathBuf,
    size: u64,
    start: u64,
    encoding: &'static Encoding,
    index: RwLock<Index>,
    cancel: AtomicBool,
}

#[derive(Default)]
pub struct LargeFiles {
    files: Mutex<HashMap<u32, Arc<LargeFile>>>,
    next: AtomicU32,
}

impl LargeFiles {
    fn get(&self, id: u32) -> Result<Arc<LargeFile>, String> {
        self.files.lock().unwrap().get(&id).cloned().ok_or_else(|| "File is no longer open.".into())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeOpened {
    id: u32,
    size: u64,
    encoding: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeStatus {
    lines: u64,
    bytes_indexed: u64,
    size: u64,
    done: bool,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeMatch {
    line: u64,
    /// Byte offsets within the line, used to continue searching.
    byte_start: u64,
    byte_end: u64,
    /// UTF-16 offsets within the line, for highlighting in the UI.
    col_start: u64,
    col_end: u64,
    wrapped: bool,
}

fn build_index(file: Arc<LargeFile>) {
    let run = || -> std::io::Result<()> {
        let mut f = File::open(&file.path)?;
        f.seek(SeekFrom::Start(file.start))?;
        let mut buf = vec![0u8; CHUNK];
        let mut offset = file.start;
        let mut newlines = 0u64;
        {
            let mut idx = file.index.write().unwrap();
            idx.checkpoints.push(file.start);
        }
        loop {
            if file.cancel.load(Ordering::Relaxed) {
                return Ok(());
            }
            let n = f.read(&mut buf)?;
            if n == 0 {
                break;
            }
            let mut found = Vec::new();
            for pos in memchr::memchr_iter(b'\n', &buf[..n]) {
                newlines += 1;
                if newlines.is_multiple_of(STEP) {
                    found.push(offset + pos as u64 + 1);
                }
            }
            offset += n as u64;
            let mut idx = file.index.write().unwrap();
            idx.checkpoints.extend(found);
            idx.newlines = newlines;
            idx.bytes = offset;
        }
        file.index.write().unwrap().done = true;
        Ok(())
    };
    if let Err(e) = run() {
        let mut idx = file.index.write().unwrap();
        idx.error = Some(e.to_string());
        idx.done = true;
    }
}

/// Sequential reader starting at an absolute offset.
struct Reader {
    file: File,
    buf: Vec<u8>,
    pos: usize,
    len: usize,
    /// Absolute offset of `buf[0]`.
    base: u64,
}

impl Reader {
    fn open(path: &PathBuf, at: u64) -> std::io::Result<Self> {
        let mut file = File::open(path)?;
        file.seek(SeekFrom::Start(at))?;
        Ok(Reader { file, buf: vec![0u8; 256 * 1024], pos: 0, len: 0, base: at })
    }

    fn offset(&self) -> u64 {
        self.base + self.pos as u64
    }

    fn fill(&mut self) -> std::io::Result<bool> {
        if self.pos < self.len {
            return Ok(true);
        }
        self.base += self.len as u64;
        self.pos = 0;
        self.len = self.file.read(&mut self.buf)?;
        Ok(self.len > 0)
    }

    /// Skips `n` line breaks. Returns false if the end of the file was reached first.
    fn skip_lines(&mut self, mut n: u64) -> std::io::Result<bool> {
        while n > 0 {
            if !self.fill()? {
                return Ok(false);
            }
            let slice = &self.buf[self.pos..self.len];
            let mut advanced = slice.len();
            for p in memchr::memchr_iter(b'\n', slice) {
                n -= 1;
                if n == 0 {
                    advanced = p + 1;
                    break;
                }
            }
            self.pos += advanced;
        }
        Ok(true)
    }

    /// Reads one line (without the line break), keeping at most `max` bytes.
    /// Returns (reached_eof_without_newline, truncated).
    fn read_line(&mut self, out: &mut Vec<u8>, max: usize) -> std::io::Result<(bool, bool)> {
        let mut truncated = false;
        loop {
            if !self.fill()? {
                return Ok((true, truncated));
            }
            let slice = &self.buf[self.pos..self.len];
            match memchr::memchr(b'\n', slice) {
                Some(p) => {
                    let take = p.min(max.saturating_sub(out.len()));
                    truncated |= take < p;
                    out.extend_from_slice(&slice[..take]);
                    self.pos += p + 1;
                    return Ok((false, truncated));
                }
                None => {
                    let take = slice.len().min(max.saturating_sub(out.len()));
                    truncated |= take < slice.len();
                    out.extend_from_slice(&slice[..take]);
                    self.pos = self.len;
                }
            }
        }
    }
}

impl LargeFile {
    fn total_lines(&self) -> u64 {
        self.index.read().unwrap().newlines + 1
    }

    fn decode(&self, bytes: &[u8]) -> String {
        let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
        if self.encoding == UTF_8 {
            String::from_utf8_lossy(bytes).into_owned()
        } else {
            self.encoding.decode_without_bom_handling(bytes).0.into_owned()
        }
    }

    /// Byte offset where `line` starts.
    fn line_start(&self, line: u64) -> std::io::Result<u64> {
        let (checkpoint, offset) = {
            let idx = self.index.read().unwrap();
            let c = ((line / STEP) as usize).min(idx.checkpoints.len().saturating_sub(1));
            (c as u64 * STEP, idx.checkpoints.get(c).copied().unwrap_or(self.start))
        };
        if checkpoint == line {
            return Ok(offset);
        }
        let mut r = Reader::open(&self.path, offset)?;
        r.skip_lines(line - checkpoint)?;
        Ok(r.offset())
    }

    /// Line number and line-start offset for an absolute byte offset (index must be complete).
    fn locate(&self, offset: u64) -> std::io::Result<(u64, u64)> {
        let (mut line, start) = {
            let idx = self.index.read().unwrap();
            let c = idx.checkpoints.partition_point(|&o| o <= offset).saturating_sub(1);
            (c as u64 * STEP, idx.checkpoints.get(c).copied().unwrap_or(self.start))
        };
        let mut line_start = start;
        let mut f = File::open(&self.path)?;
        f.seek(SeekFrom::Start(start))?;
        let mut remaining = offset - start;
        let mut buf = vec![0u8; 256 * 1024];
        let mut pos = start;
        while remaining > 0 {
            let want = (remaining as usize).min(buf.len());
            let n = f.read(&mut buf[..want])?;
            if n == 0 {
                break;
            }
            for p in memchr::memchr_iter(b'\n', &buf[..n]) {
                line += 1;
                line_start = pos + p as u64 + 1;
            }
            pos += n as u64;
            remaining -= n as u64;
        }
        Ok((line, line_start))
    }

    fn read_range(&self, from: u64, len: usize) -> std::io::Result<Vec<u8>> {
        let mut f = File::open(&self.path)?;
        f.seek(SeekFrom::Start(from))?;
        let mut out = Vec::with_capacity(len);
        f.take(len as u64).read_to_end(&mut out)?;
        Ok(out)
    }

    fn utf16_len(&self, bytes: &[u8]) -> u64 {
        self.decode(bytes).encode_utf16().count() as u64
    }
}

#[tauri::command(async)]
pub fn large_open(state: State<'_, LargeFiles>, path: String) -> Result<LargeOpened, String> {
    let mut f = File::open(&path).map_err(|e| e.to_string())?;
    let size = f.metadata().map_err(|e| e.to_string())?.len();
    let mut head = vec![0u8; 64 * 1024];
    let n = f.read(&mut head).map_err(|e| e.to_string())?;
    head.truncate(n);
    let (enc, _, bom_len) = crate::files::detect_encoding(&head);
    if enc == UTF_16LE || enc == UTF_16BE {
        return Err("UTF16:Large-file mode doesn't support UTF-16 files.".into());
    }
    // A UTF-8 guess from a 64 KB sample is the safest default for huge files.
    let enc = if enc.is_ascii_compatible() { enc } else { UTF_8 };
    let file = Arc::new(LargeFile {
        path: PathBuf::from(&path),
        size,
        start: bom_len as u64,
        encoding: enc,
        index: RwLock::new(Index::default()),
        cancel: AtomicBool::new(false),
    });
    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    state.files.lock().unwrap().insert(id, file.clone());
    std::thread::spawn(move || build_index(file));
    Ok(LargeOpened { id, size, encoding: enc.name().to_string() })
}

#[tauri::command(async)]
pub fn large_status(state: State<'_, LargeFiles>, id: u32) -> Result<LargeStatus, String> {
    let file = state.get(id)?;
    let idx = file.index.read().unwrap();
    Ok(LargeStatus {
        lines: idx.newlines + 1,
        bytes_indexed: idx.bytes,
        size: file.size,
        done: idx.done,
        error: idx.error.clone(),
    })
}

#[tauri::command(async)]
pub fn large_lines(state: State<'_, LargeFiles>, id: u32, start: u64, count: u64) -> Result<Vec<String>, String> {
    let file = state.get(id)?;
    let total = file.total_lines();
    if start >= total {
        return Ok(Vec::new());
    }
    let count = count.min(5000).min(total - start);
    let offset = file.line_start(start).map_err(|e| e.to_string())?;
    let mut r = Reader::open(&file.path, offset).map_err(|e| e.to_string())?;
    let mut lines = Vec::with_capacity(count as usize);
    let mut raw = Vec::new();
    for _ in 0..count {
        raw.clear();
        let (eof, truncated) = r.read_line(&mut raw, MAX_LINE).map_err(|e| e.to_string())?;
        let mut text = file.decode(&raw);
        if truncated {
            text.push_str(" …");
        }
        lines.push(text);
        if eof {
            break;
        }
    }
    Ok(lines)
}

fn build_regex(
    query: &str,
    regex: bool,
    case_sensitive: bool,
    whole_word: bool,
    enc: &'static Encoding,
) -> Result<regex::bytes::Regex, String> {
    let mut pattern = if regex {
        query.to_string()
    } else if enc == UTF_8 || query.is_ascii() {
        regex::escape(query)
    } else {
        // Search for the query's bytes in the file's own encoding.
        let (bytes, _, _) = enc.encode(query);
        let mut p = String::from("(?-u)");
        for b in bytes.iter() {
            p.push_str(&format!("\\x{:02X}", b));
        }
        p
    };
    if whole_word {
        pattern = format!(r"\b(?:{})\b", pattern);
    }
    regex::bytes::RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .multi_line(true)
        .build()
        .map_err(|e| format!("Invalid search pattern: {}", e))
}

/// First match starting in [from, to). `from` must be a line start or `line_start` is given.
fn search_forward(file: &LargeFile, re: &regex::bytes::Regex, line_start: u64, from: u64, to: u64) -> std::io::Result<Option<(u64, u64)>> {
    let mut region_start = line_start;
    let mut skip = (from - line_start) as usize;
    while region_start < to {
        let mut want = CHUNK;
        let (buf, region_len) = loop {
            let buf = file.read_range(region_start, want)?;
            let at_eof = region_start + buf.len() as u64 >= file.size;
            if at_eof {
                let l = buf.len();
                break (buf, l);
            }
            match memchr::memrchr(b'\n', &buf) {
                Some(p) => break (buf, p + 1),
                None if want < MAX_REGION => want *= 2,
                None => {
                    let l = buf.len();
                    break (buf, l);
                }
            }
        };
        if region_len == 0 {
            break;
        }
        if let Some(m) = re.find_at(&buf[..region_len], skip.min(region_len)) {
            let s = region_start + m.start() as u64;
            if s < to {
                return Ok(Some((s, region_start + m.end() as u64)));
            }
            return Ok(None);
        }
        skip = 0;
        region_start += region_len as u64;
    }
    Ok(None)
}

/// Last match starting in [from, before).
fn search_backward(file: &LargeFile, re: &regex::bytes::Regex, from: u64, before: u64) -> std::io::Result<Option<(u64, u64)>> {
    // Include the rest of the line containing `before` so matches there are complete.
    let mut region_end = {
        let tail = file.read_range(before, MAX_LINE)?;
        before + memchr::memchr(b'\n', &tail).map(|p| p as u64).unwrap_or(tail.len() as u64)
    };
    let mut limit = before;
    while limit > from {
        let mut region_start = region_end.saturating_sub(CHUNK as u64).max(from);
        let buf = file.read_range(region_start, (region_end - region_start) as usize)?;
        let mut cut = 0usize;
        if region_start > from {
            if let Some(p) = memchr::memchr(b'\n', &buf) {
                cut = p + 1;
            }
        }
        let hay = &buf[cut..];
        region_start += cut as u64;
        let mut best = None;
        for m in re.find_iter(hay) {
            let s = region_start + m.start() as u64;
            if s >= limit {
                break;
            }
            if s >= from {
                best = Some((s, region_start + m.end() as u64));
            }
        }
        if best.is_some() {
            return Ok(best);
        }
        if region_start <= from {
            break;
        }
        region_end = region_start;
        limit = region_start;
    }
    Ok(None)
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn large_search(
    state: State<'_, LargeFiles>,
    id: u32,
    query: String,
    regex: bool,
    case_sensitive: bool,
    whole_word: bool,
    from_line: u64,
    from_byte: u64,
    backward: bool,
) -> Result<Option<LargeMatch>, String> {
    let file = state.get(id)?;
    if !file.index.read().unwrap().done {
        return Err("Still indexing this file — try again in a moment.".into());
    }
    if query.is_empty() {
        return Ok(None);
    }
    let re = build_regex(&query, regex, case_sensitive, whole_word, file.encoding)?;
    let io = |e: std::io::Error| e.to_string();
    let line_start = file.line_start(from_line).map_err(io)?;
    let pos = (line_start + from_byte).min(file.size);
    let (found, wrapped) = if backward {
        match search_backward(&file, &re, file.start, pos).map_err(io)? {
            Some(m) => (Some(m), false),
            None => (search_backward(&file, &re, pos, file.size).map_err(io)?, true),
        }
    } else {
        match search_forward(&file, &re, line_start, pos, file.size).map_err(io)? {
            Some(m) => (Some(m), false),
            None => (search_forward(&file, &re, file.start, file.start, pos).map_err(io)?, true),
        }
    };
    let Some((s, e)) = found else { return Ok(None) };
    let (line, ls) = file.locate(s).map_err(io)?;
    let (col_start, col_end) = if s - ls > MAX_LINE as u64 {
        (u64::MAX, u64::MAX)
    } else {
        let bytes = file.read_range(ls, (e - ls) as usize).map_err(io)?;
        let pre = (s - ls) as usize;
        let a = file.utf16_len(&bytes[..pre]);
        (a, a + file.utf16_len(&bytes[pre..]))
    };
    Ok(Some(LargeMatch { line, byte_start: s - ls, byte_end: e - ls, col_start, col_end, wrapped }))
}

#[tauri::command]
pub fn large_close(state: State<'_, LargeFiles>, id: u32) {
    if let Some(f) = state.files.lock().unwrap().remove(&id) {
        f.cancel.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make(content: &[u8]) -> (Arc<LargeFile>, PathBuf) {
        let path = std::env::temp_dir().join(format!("margin-large-{}-{}.txt", std::process::id(), content.len()));
        File::create(&path).unwrap().write_all(content).unwrap();
        let file = Arc::new(LargeFile {
            path: path.clone(),
            size: content.len() as u64,
            start: 0,
            encoding: UTF_8,
            index: RwLock::new(Index::default()),
            cancel: AtomicBool::new(false),
        });
        build_index(file.clone());
        (file, path)
    }

    #[test]
    fn index_lines_and_search() {
        let mut s = String::new();
        for i in 0..5000 {
            s.push_str(&format!("line {} {}\n", i, if i % 1000 == 7 { "needle" } else { "hay" }));
        }
        let (file, path) = make(s.as_bytes());
        assert_eq!(file.total_lines(), 5001);
        assert_eq!(file.line_start(1025).unwrap(), s.find("line 1025 ").unwrap() as u64);
        let (line, _) = file.locate(s.find("line 3000 ").unwrap() as u64).unwrap();
        assert_eq!(line, 3000);

        let re = build_regex("needle", false, false, false, UTF_8).unwrap();
        let (a, _) = search_forward(&file, &re, 0, 0, file.size).unwrap().unwrap();
        assert_eq!(file.locate(a).unwrap().0, 7);
        let next_from = a + 6;
        let (ls, _) = (file.locate(next_from).unwrap().1, 0);
        let (b, _) = search_forward(&file, &re, ls, next_from, file.size).unwrap().unwrap();
        assert_eq!(file.locate(b).unwrap().0, 1007);
        let (c, _) = search_backward(&file, &re, 0, b).unwrap().unwrap();
        assert_eq!(c, a);
        assert!(search_backward(&file, &re, 0, a).unwrap().is_none());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn read_lines_with_long_line() {
        let mut s = "x".repeat(MAX_LINE * 3);
        s.push_str("\r\nshort\r\nlast");
        let (file, path) = make(s.as_bytes());
        let mut r = Reader::open(&file.path, 0).unwrap();
        let mut raw = Vec::new();
        let (eof, truncated) = r.read_line(&mut raw, MAX_LINE).unwrap();
        assert!(!eof && truncated && raw.len() == MAX_LINE);
        raw.clear();
        r.read_line(&mut raw, MAX_LINE).unwrap();
        assert_eq!(file.decode(&raw), "short");
        raw.clear();
        assert!(r.read_line(&mut raw, MAX_LINE).unwrap().0);
        assert_eq!(file.decode(&raw), "last");
        std::fs::remove_file(path).unwrap();
    }
}
