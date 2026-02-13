use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

static SECRET_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r#"(?i)(api[_-]?key|token|secret|password)\s*[:=]\s*["']?([A-Za-z0-9_\-\.]{6,})["']?"#)
            .expect("valid regex"),
        Regex::new(r"\b(sk-[A-Za-z0-9]{20,})\b").expect("valid regex"),
        Regex::new(r"\b(AKIA[0-9A-Z]{16})\b").expect("valid regex"),
        Regex::new(r"\b([A-Fa-f0-9]{32,})\b").expect("valid regex"),
    ]
});

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RedactionResult {
    pub content: String,
    pub redaction_count: usize,
}

#[derive(Debug, Default, Clone)]
pub struct Redactor {
    aggressive: bool,
}

impl Redactor {
    pub fn new(aggressive: bool) -> Self {
        Self { aggressive }
    }

    pub fn redact(&self, input: &str) -> RedactionResult {
        if input.is_empty() {
            return RedactionResult {
                content: String::new(),
                redaction_count: 0,
            };
        }

        let mut result = input.to_string();
        let mut redaction_count = 0usize;

        if self.aggressive {
            let normalized = result
                .split_whitespace()
                .map(|token| {
                    if token.len() > 48 && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                        redaction_count += 1;
                        "[REDACTED_LONG_TOKEN]".to_string()
                    } else {
                        token.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            result = normalized;
        }

        for pattern in SECRET_PATTERNS.iter() {
            let matches = pattern.find_iter(&result).count();
            if matches == 0 {
                continue;
            }

            redaction_count += matches;
            result = pattern
                .replace_all(&result, |caps: &regex::Captures<'_>| {
                    let key = caps
                        .get(1)
                        .map(|m| m.as_str())
                        .unwrap_or("secret")
                        .to_ascii_lowercase();
                    format!("{}=[REDACTED]", key)
                })
                .to_string();
        }

        RedactionResult {
            content: result,
            redaction_count,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Redactor;

    #[test]
    fn redacts_named_secret() {
        let redactor = Redactor::new(true);
        let result = redactor.redact("api_key=abcd1234abcd1234");
        assert!(result.content.contains("api_key=[REDACTED]"));
        assert!(result.redaction_count >= 1);
    }

    #[test]
    fn redacts_long_token() {
        let redactor = Redactor::new(true);
        let result = redactor.redact("prefix AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA suffix");
        assert!(result.content.contains("[REDACTED_LONG_TOKEN]"));
    }
}
