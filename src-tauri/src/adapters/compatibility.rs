use crate::errors::{AppError, AppResult};
use crate::models::{CapabilityProfile, Provider, RunMode};
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

#[derive(Debug, Clone)]
pub struct MatrixEntry {
    pub min_version: &'static str,
    pub max_version: &'static str,
    pub supported_flags: &'static [&'static str],
    pub supports_interactive: bool,
}

const CLI_VERSION_TIMEOUT_SECONDS: u64 = 10;
const CAPABILITY_CACHE_TTL_SECONDS: u64 = 60;
const VERSION_PROBE_ARGS: &[&str] = &["--version", "-v"];

#[derive(Debug, Clone)]
struct CachedProfile {
    profile: CapabilityProfile,
    detected_at: Instant,
}

#[derive(Debug, Clone, Default)]
struct RegistryState {
    cache: HashMap<String, CachedProfile>,
}

#[derive(Debug, Clone, Default)]
pub struct CompatibilityRegistry {
    state: Arc<Mutex<RegistryState>>,
}

impl CompatibilityRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn detect_profile(&self, provider: Provider, binary_path: &str) -> CapabilityProfile {
        let cache_key = format!("{}::{}", provider.as_str(), binary_path);
        let mut state = self.state.lock().await;
        if let Some(cached) = state.cache.get(&cache_key) {
            if cached.detected_at.elapsed() <= Duration::from_secs(CAPABILITY_CACHE_TTL_SECONDS) {
                return cached.profile.clone();
            }
        }

        let profile = detect_profile_uncached(provider, binary_path).await;
        state.cache.insert(
            cache_key,
            CachedProfile {
                profile: profile.clone(),
                detected_at: Instant::now(),
            },
        );
        profile
    }
}

async fn detect_profile_uncached(provider: Provider, binary_path: &str) -> CapabilityProfile {
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
        Provider::Codex => codex_matrix().into_iter().find(|candidate| {
            version_between(&cli_version, candidate.min_version, candidate.max_version)
        }),
        Provider::Claude | Provider::KiingoMcp => claude_matrix().into_iter().find(|candidate| {
            version_between(&cli_version, candidate.min_version, candidate.max_version)
        }),
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
                supported_flags: entry
                    .supported_flags
                    .iter()
                    .map(|flag| (*flag).to_string())
                    .collect(),
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

async fn detect_cli_version(binary_path: &str) -> AppResult<String> {
    let mut last_error: Option<AppError> = None;
    for version_flag in VERSION_PROBE_ARGS {
        match detect_cli_version_with_arg(binary_path, version_flag).await {
            Ok(version) => return Ok(version),
            Err(error) => {
                last_error = Some(error);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| AppError::Cli("Unable to detect CLI version".to_string())))
}

async fn detect_cli_version_with_arg(binary_path: &str, version_flag: &str) -> AppResult<String> {
    let mut command = Command::new(binary_path);
    command.arg(version_flag);
    command.kill_on_drop(true);
    command.env_remove("CLAUDECODE");
    command.env_remove("CODEX_SHELL");

    let output = timeout(
        Duration::from_secs(CLI_VERSION_TIMEOUT_SECONDS),
        command.output(),
    )
    .await
    .map_err(|_| {
        AppError::Cli(format!(
            "Version command timed out ({} {})",
            binary_path, version_flag
        ))
    })?
    .map_err(|err| AppError::Cli(err.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Cli(if stderr.is_empty() {
            format!(
                "Version command failed with status {:?}",
                output.status.code()
            )
        } else {
            format!(
                "Version command failed with status {:?}: {}",
                output.status.code(),
                stderr
            )
        }));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let version_output = if stdout.is_empty() { stderr } else { stdout };

    if version_output.is_empty() {
        return Err(AppError::Cli("Version output was empty".to_string()));
    }

    Ok(extract_semver(&version_output))
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
    let mut parts = version
        .split('.')
        .filter_map(|segment| segment.parse::<u64>().ok());
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
            "--reasoning-effort",
            "--ask-for-approval",
            "--output-schema",
            "--output-last-message",
            "--sandbox",
            "--search",
            "--add-dir",
            "--image",
            "--config",
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
            "--fallback-model",
            "--max-budget-usd",
            "--no-session-persistence",
            "--max-turns",
            "--tools",
            "--allowedTools",
            "--permission-mode",
            "--system-prompt",
            "--append-system-prompt",
            "--include-partial-messages",
            "--continue",
            "--agent",
            "--agents",
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
    use super::{detect_cli_version, extract_semver, version_between, CompatibilityRegistry};
    use crate::models::Provider;

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

    #[cfg(unix)]
    fn make_executable(path: &std::path::Path) {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions).expect("set permissions");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn parses_version_from_stderr_output() {
        let temp = tempfile::tempdir().expect("temp dir");
        let script = temp.path().join("stderr-version.sh");
        std::fs::write(
            &script,
            r#"#!/bin/sh
echo "Claude Code 2.1.47" 1>&2
"#,
        )
        .expect("write script");
        make_executable(&script);

        let version = detect_cli_version(script.to_str().expect("script path"))
            .await
            .expect("version");
        assert_eq!(version, "2.1.47");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn caches_detected_profile_to_prevent_duplicate_version_probes() {
        let temp = tempfile::tempdir().expect("temp dir");
        let script = temp.path().join("counted-version.sh");
        let count_file = temp.path().join("probe-count.txt");
        let count_file_str = count_file.to_string_lossy();
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh
count_file='{}'
count=0
if [ -f \"$count_file\" ]; then
  count=$(cat \"$count_file\")
fi
count=$((count + 1))
printf \"%s\" \"$count\" > \"$count_file\"
echo \"Claude Code 2.1.47\"
",
                count_file_str
            ),
        )
        .expect("write script");
        make_executable(&script);

        let registry = CompatibilityRegistry::new();
        let binary = script.to_str().expect("script path");

        let first = registry.detect_profile(Provider::Claude, binary).await;
        let second = registry.detect_profile(Provider::Claude, binary).await;

        assert_eq!(first.cli_version, "2.1.47");
        assert_eq!(second.cli_version, "2.1.47");
        let probe_count = std::fs::read_to_string(&count_file).expect("count file");
        assert_eq!(probe_count, "1");
    }
}
