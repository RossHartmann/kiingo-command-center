use crate::errors::{AppError, AppResult};
use crate::models::{CapabilityProfile, Provider, RunMode};
use chrono::Utc;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

#[derive(Debug, Clone)]
pub struct MatrixEntry {
    pub min_version: &'static str,
    pub max_version: &'static str,
    pub supported_flags: &'static [&'static str],
    pub supports_interactive: bool,
}

#[derive(Debug, Default, Clone)]
pub struct CompatibilityRegistry;

impl CompatibilityRegistry {
    pub fn new() -> Self {
        Self
    }

    pub async fn detect_profile(&self, provider: Provider, binary_path: &str) -> CapabilityProfile {
        let cli_version = match detect_cli_version(binary_path).await {
            Ok(version) => version,
            Err(error) => {
                return CapabilityProfile {
                    provider,
                    cli_version: "unknown".to_string(),
                    supported: false,
                    degraded: false,
                    blocked: true,
                    supported_flags: vec![],
                    supported_modes: vec![RunMode::NonInteractive],
                    disabled_reasons: vec![format!("Unable to detect CLI version: {}", error)],
                }
            }
        };

        let entry = match provider {
            Provider::Codex => codex_matrix().into_iter().find(|candidate| version_between(&cli_version, candidate.min_version, candidate.max_version)),
            Provider::Claude => claude_matrix().into_iter().find(|candidate| version_between(&cli_version, candidate.min_version, candidate.max_version)),
        };

        match entry {
            Some(entry) => {
                let mut supported_modes = vec![RunMode::NonInteractive];
                if entry.supports_interactive {
                    supported_modes.push(RunMode::Interactive);
                }

                CapabilityProfile {
                    provider,
                    cli_version,
                    supported: true,
                    degraded: false,
                    blocked: false,
                    supported_flags: entry.supported_flags.iter().map(|flag| (*flag).to_string()).collect(),
                    supported_modes,
                    disabled_reasons: vec![],
                }
            }
            None => CapabilityProfile {
                provider,
                cli_version,
                supported: false,
                degraded: true,
                blocked: false,
                supported_flags: vec![],
                supported_modes: vec![RunMode::NonInteractive],
                disabled_reasons: vec![
                    "Detected version is outside tested matrix; advanced and interactive features may be gated".to_string(),
                ],
            },
        }
    }
}

async fn detect_cli_version(binary_path: &str) -> AppResult<String> {
    let mut command = Command::new(binary_path);
    command.arg("--version");

    let output = timeout(Duration::from_secs(3), command.output())
        .await
        .map_err(|_| AppError::Cli("Version command timed out".to_string()))?
        .map_err(|err| AppError::Cli(err.to_string()))?;

    if !output.status.success() {
        return Err(AppError::Cli(format!(
            "Version command failed with status {:?}",
            output.status.code()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Err(AppError::Cli("Version output was empty".to_string()));
    }

    Ok(extract_semver(&stdout))
}

pub fn extract_semver(raw: &str) -> String {
    let mut current = String::new();
    for ch in raw.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            current.push(ch);
        } else if !current.is_empty() {
            break;
        }
    }
    if current.is_empty() {
        Utc::now().format("0.0.%S").to_string()
    } else {
        current
    }
}

fn version_between(version: &str, min_version: &str, max_version: &str) -> bool {
    let parsed = parse_version(version);
    let min = parse_version(min_version);
    let max = parse_version(max_version);
    parsed >= min && parsed <= max
}

fn parse_version(version: &str) -> (u64, u64, u64) {
    let mut parts = version.split('.').filter_map(|segment| segment.parse::<u64>().ok());
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

fn codex_matrix() -> Vec<MatrixEntry> {
    vec![MatrixEntry {
        min_version: "0.24.0",
        max_version: "1.99.99",
        supported_flags: &[
            "--model",
            "--json",
            "--output-schema",
            "--output-last-message",
            "--sandbox",
            "--skip-git-repo-check",
            "--ephemeral",
        ],
        supports_interactive: true,
    }]
}

fn claude_matrix() -> Vec<MatrixEntry> {
    vec![MatrixEntry {
        min_version: "0.20.0",
        max_version: "99.99.99",
        supported_flags: &[
            "--output-format",
            "--input-format",
            "--json-schema",
            "--model",
            "--max-budget-usd",
            "--no-session-persistence",
            "--max-turns",
            "--resume",
            "--verbose",
            "--mcp-config",
            "--strict-mcp-config",
        ],
        supports_interactive: true,
    }]
}

#[cfg(test)]
mod tests {
    use super::{extract_semver, version_between};

    #[test]
    fn parses_semver_substring() {
        assert_eq!(extract_semver("codex 0.27.4"), "0.27.4");
    }

    #[test]
    fn checks_version_range() {
        assert!(version_between("0.30.0", "0.24.0", "1.0.0"));
        assert!(!version_between("0.10.0", "0.24.0", "1.0.0"));
    }

    #[test]
    fn accepts_claude_v2_with_expanded_upper_bound() {
        assert!(version_between("2.1.41", "0.20.0", "99.99.99"));
    }
}
