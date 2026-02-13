#[derive(Debug, Default)]
pub struct LineBuffer {
    buffer: String,
    max_buffer_bytes: Option<usize>,
    overflowed_bytes: usize,
}

impl LineBuffer {
    pub fn new(max_buffer_bytes: Option<usize>) -> Self {
        Self {
            buffer: String::new(),
            max_buffer_bytes,
            overflowed_bytes: 0,
        }
    }

    pub fn push(&mut self, chunk: &str) -> Vec<String> {
        self.buffer.push_str(chunk);
        if let Some(max) = self.max_buffer_bytes {
            if self.buffer.len() > max {
                let excess = self.buffer.len() - max;
                self.buffer.drain(..excess);
                self.overflowed_bytes = self.overflowed_bytes.saturating_add(excess);
            }
        }

        let mut lines = Vec::new();
        loop {
            let idx_n = self.buffer.find('\n');
            let idx_r = self.buffer.find('\r');
            let idx = match (idx_n, idx_r) {
                (None, None) => break,
                (Some(n), None) => n,
                (None, Some(r)) => r,
                (Some(n), Some(r)) => n.min(r),
            };

            let line = self.buffer[..idx].to_string();
            let mut advance = 1;
            if self.buffer.as_bytes().get(idx) == Some(&b'\r')
                && self.buffer.as_bytes().get(idx + 1) == Some(&b'\n')
            {
                advance = 2;
            }
            self.buffer.drain(..idx + advance);
            lines.push(line);
        }

        lines
    }

    pub fn consume_overflowed_bytes(&mut self) -> usize {
        let value = self.overflowed_bytes;
        self.overflowed_bytes = 0;
        value
    }

    pub fn flush(&mut self) -> String {
        std::mem::take(&mut self.buffer)
    }
}

#[cfg(test)]
mod tests {
    use super::LineBuffer;

    #[test]
    fn splits_mixed_newlines() {
        let mut buffer = LineBuffer::new(None);
        let lines = buffer.push("a\nb\r\nc\rd");
        assert_eq!(lines, vec!["a", "b", "c"]);
        assert_eq!(buffer.flush(), "d");
    }

    #[test]
    fn trims_when_over_limit() {
        let mut buffer = LineBuffer::new(Some(4));
        let _ = buffer.push("abcdef");
        assert_eq!(buffer.consume_overflowed_bytes(), 2);
        assert_eq!(buffer.flush(), "cdef");
    }
}
