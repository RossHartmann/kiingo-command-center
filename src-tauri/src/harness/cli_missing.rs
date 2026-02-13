use crate::models::Provider;

static CLI_MISSING_PATTERNS: &[&str] = &[
    "not installed",
    "command not found",
    "no such file or directory",
    "is not recognized as an internal or external command",
];

pub fn is_cli_missing_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    CLI_MISSING_PATTERNS
        .iter()
        .any(|pattern| lower.contains(pattern))
}

pub fn build_cli_missing_payload(line: &str, provider: Provider) -> Option<serde_json::Value> {
    if !is_cli_missing_line(line) {
        return None;
    }

    Some(serde_json::json!({
        "provider": provider.as_str(),
        "message": line,
        "code": "CLI_MISSING"
    }))
}

#[cfg(test)]
mod tests {
    use super::is_cli_missing_line;

    #[test]
    fn detects_cli_missing_variants() {
        assert!(is_cli_missing_line("command not found: claude"));
        assert!(is_cli_missing_line("is not recognized as an internal or external command"));
        assert!(!is_cli_missing_line("normal stderr line"));
    }
}
