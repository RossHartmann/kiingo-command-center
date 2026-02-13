use crate::errors::{AppError, AppResult};
use crate::models::{
    AppSettings, CapabilityProfile, CliAllowlistMode, Provider, SandboxMode, StartRunPayload, WorkspaceGrant,
};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

const MIN_QUEUE_PRIORITY: i32 = -10;
const MAX_QUEUE_PRIORITY: i32 = 10;
const MIN_TIMEOUT_SECONDS: u64 = 5;
const MAX_TIMEOUT_SECONDS: u64 = 10_800;
const MAX_RETRIES_ALLOWED: u32 = 10;
const MIN_RETRY_BACKOFF_MS: u64 = 100;
const MAX_RETRY_BACKOFF_MS: u64 = 600_000;

#[derive(Debug, Clone)]
pub struct PolicyEngine {
    codex_base_flags: BTreeSet<String>,
    claude_base_flags: BTreeSet<String>,
    advanced_flags: BTreeSet<String>,
}

impl Default for PolicyEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl PolicyEngine {
    pub fn new() -> Self {
        let codex_base_flags = [
            "model",
            "json",
            "reasoning-effort",
            "output-schema",
            "output-last-message",
            "ask-for-approval",
            "sandbox",
            "search",
            "add-dir",
            "image",
            "config",
            "skip-git-repo-check",
            "ephemeral",
        ]
        .into_iter()
        .map(ToString::to_string)
        .collect();

        let claude_base_flags = [
            "output-format",
            "input-format",
            "json-schema",
            "model",
            "fallback-model",
            "max-budget-usd",
            "no-session-persistence",
            "max-turns",
            "tools",
            "allowedTools",
            "permission-mode",
            "system-prompt",
            "append-system-prompt",
            "include-partial-messages",
            "continue",
            "agent",
            "agents",
            "resume",
            "verbose",
        ]
        .into_iter()
        .map(ToString::to_string)
        .collect();

        let advanced_flags = ["mcp-config", "strict-mcp-config", "dangerously-skip-permissions"]
            .into_iter()
            .map(ToString::to_string)
            .collect();

        Self {
            codex_base_flags,
            claude_base_flags,
            advanced_flags,
        }
    }

    pub fn validate(
        &self,
        payload: &StartRunPayload,
        settings: &AppSettings,
        workspace_grants: &[WorkspaceGrant],
        capability: &CapabilityProfile,
    ) -> AppResult<()> {
        self.validate_workspace(&payload.cwd, workspace_grants)?;
        self.validate_runtime_bounds(payload)?;
        self.validate_harness(payload)?;
        self.validate_flags(payload.provider, &payload.optional_flags, settings, capability)?;

        if capability.blocked {
            return Err(AppError::Cli(format!(
                "Installed {} CLI version {} is blocked: {}",
                capability.provider.as_str(),
                capability.cli_version,
                capability.disabled_reasons.join("; ")
            )));
        }

        if !capability.supported && !settings.allow_advanced_policy {
            return Err(AppError::Cli(format!(
                "Installed {} CLI version {} is outside supported matrix. Enable advanced policy mode to proceed in degraded mode.",
                capability.provider.as_str(),
                capability.cli_version
            )));
        }

        if !capability.supported_modes.contains(&payload.mode) {
            return Err(AppError::Cli(format!(
                "Run mode '{:?}' is not supported by CLI version {}",
                payload.mode, capability.cli_version
            )));
        }

        Ok(())
    }

    fn validate_runtime_bounds(&self, payload: &StartRunPayload) -> AppResult<()> {
        if let Some(priority) = payload.queue_priority {
            if !(MIN_QUEUE_PRIORITY..=MAX_QUEUE_PRIORITY).contains(&priority) {
                return Err(AppError::Policy(format!(
                    "Queue priority {} is out of allowed range ({}..={})",
                    priority, MIN_QUEUE_PRIORITY, MAX_QUEUE_PRIORITY
                )));
            }
        }

        if let Some(timeout) = payload.timeout_seconds {
            if !(MIN_TIMEOUT_SECONDS..=MAX_TIMEOUT_SECONDS).contains(&timeout) {
                return Err(AppError::Policy(format!(
                    "Timeout {} is out of allowed range ({}..={}) seconds",
                    timeout, MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS
                )));
            }
        }

        if let Some(max_retries) = payload.max_retries {
            if max_retries > MAX_RETRIES_ALLOWED {
                return Err(AppError::Policy(format!(
                    "Max retries {} exceeds allowed limit {}",
                    max_retries, MAX_RETRIES_ALLOWED
                )));
            }
        }

        if let Some(backoff_ms) = payload.retry_backoff_ms {
            if !(MIN_RETRY_BACKOFF_MS..=MAX_RETRY_BACKOFF_MS).contains(&backoff_ms) {
                return Err(AppError::Policy(format!(
                    "Retry backoff {}ms is out of allowed range ({}..={})",
                    backoff_ms, MIN_RETRY_BACKOFF_MS, MAX_RETRY_BACKOFF_MS
                )));
            }
        }

        if let Some(harness) = &payload.harness {
            if let Some(limits) = &harness.limits {
                if let Some(timeout_ms) = limits.timeout_ms {
                    if !(5_000..=10_800_000).contains(&timeout_ms) {
                        return Err(AppError::Policy(format!(
                            "Harness timeout {}ms is out of allowed range (5000..=10800000)",
                            timeout_ms
                        )));
                    }
                }
                if let Some(max_tool_result_lines) = limits.max_tool_result_lines {
                    if max_tool_result_lines > 20_000 {
                        return Err(AppError::Policy(format!(
                            "maxToolResultLines {} exceeds limit 20000",
                            max_tool_result_lines
                        )));
                    }
                }
            }
        }

        Ok(())
    }

    fn validate_harness(&self, payload: &StartRunPayload) -> AppResult<()> {
        let Some(harness) = &payload.harness else {
            return Ok(());
        };

        if let Some(permissions) = &harness.permissions {
            if permissions.auto_approve
                && permissions.sandbox_mode == SandboxMode::FullAccess
            {
                return Err(AppError::Policy(
                    "autoApprove + full-access sandbox is denied by policy".to_string(),
                ));
            }
        }

        if let Some(allowlist) = &harness.cli_allowlist {
            if allowlist.entries.is_empty() {
                return Err(AppError::Policy("cliAllowlist.entries cannot be empty".to_string()));
            }
            for entry in &allowlist.entries {
                if entry.name.trim().is_empty() {
                    return Err(AppError::Policy("cliAllowlist entry name cannot be empty".to_string()));
                }
                if entry.path.trim().is_empty() {
                    return Err(AppError::Policy(format!(
                        "cliAllowlist path cannot be empty for '{}'",
                        entry.name
                    )));
                }
            }
            if allowlist.mode == Some(CliAllowlistMode::Wrapper)
                && allowlist.wrapper_name.as_deref().map(str::trim).unwrap_or_default().is_empty()
            {
                return Err(AppError::Policy(
                    "cliAllowlist.wrapperName cannot be empty in wrapper mode".to_string(),
                ));
            }
        }

        if let Some(prelude) = &harness.shell_prelude {
            if prelude.content.trim().is_empty() {
                return Err(AppError::Policy("shellPrelude content cannot be empty".to_string()));
            }
        }

        Ok(())
    }

    pub fn validate_resolved_args(
        &self,
        provider: Provider,
        args: &[String],
        settings: &AppSettings,
        capability: &CapabilityProfile,
    ) -> AppResult<Vec<String>> {
        let allowed_base = match provider {
            Provider::Codex => &self.codex_base_flags,
            Provider::Claude => &self.claude_base_flags,
        };
        let capability_allowed: BTreeSet<_> = capability
            .supported_flags
            .iter()
            .map(|flag| flag.trim_start_matches("--").to_string())
            .collect();

        let mut seen_flags = Vec::new();
        for arg in args {
            if arg.contains('\0') {
                return Err(AppError::Policy("Resolved command contains null byte".to_string()));
            }

            if arg
                .chars()
                .any(|ch| ch.is_control() && ch != '\n' && ch != '\r' && ch != '\t')
            {
                return Err(AppError::Policy(format!(
                    "Resolved command contains unsupported control character in argument '{}'",
                    arg
                )));
            }

            if let Some(raw_key) = arg.strip_prefix("--") {
                let key = raw_key.split('=').next().unwrap_or_default();
                if key.is_empty() {
                    return Err(AppError::Policy("Resolved command contains empty long flag".to_string()));
                }
                self.validate_flag_key(
                    key,
                    allowed_base,
                    &capability_allowed,
                    settings,
                    &capability.cli_version,
                )?;
                seen_flags.push(key.to_string());
                continue;
            }

            if arg.starts_with('-') {
                let allowed_short = matches!((provider, arg.as_str()), (Provider::Claude, "-p"));
                if !allowed_short {
                    return Err(AppError::Policy(format!(
                        "Resolved command contains disallowed short flag '{}'",
                        arg
                    )));
                }
            }
        }

        Ok(seen_flags)
    }

    fn validate_workspace(&self, cwd: &str, grants: &[WorkspaceGrant]) -> AppResult<()> {
        let cwd_path = normalize_path(cwd)?;
        let active_grants = grants
            .iter()
            .filter(|grant| grant.revoked_at.is_none())
            .map(|grant| normalize_path(&grant.path))
            .collect::<AppResult<Vec<_>>>()?;

        let allowed = active_grants.iter().any(|grant| cwd_path.starts_with(grant));
        if !allowed {
            return Err(AppError::Policy(format!(
                "Workspace {} is not granted. Add a workspace grant in Settings.",
                cwd
            )));
        }

        Ok(())
    }

    fn validate_flags(
        &self,
        provider: Provider,
        flags: &BTreeMap<String, serde_json::Value>,
        settings: &AppSettings,
        capability: &CapabilityProfile,
    ) -> AppResult<()> {
        let allowed_base = match provider {
            Provider::Codex => &self.codex_base_flags,
            Provider::Claude => &self.claude_base_flags,
        };

        let capability_allowed: BTreeSet<_> = capability
            .supported_flags
            .iter()
            .map(|flag| flag.trim_start_matches("--").to_string())
            .collect();

        for key in flags.keys() {
            if is_internal_optional_flag(key) {
                continue;
            }
            self.validate_flag_key(
                key,
                allowed_base,
                &capability_allowed,
                settings,
                &capability.cli_version,
            )?;
        }

        Ok(())
    }

    fn validate_flag_key(
        &self,
        key: &str,
        allowed_base: &BTreeSet<String>,
        capability_allowed: &BTreeSet<String>,
        settings: &AppSettings,
        cli_version: &str,
    ) -> AppResult<()> {
        let is_base = allowed_base.contains(key);
        let is_advanced = self.advanced_flags.contains(key);

        if is_advanced && !settings.allow_advanced_policy {
            return Err(AppError::Policy(format!(
                "Advanced flag '{}' denied because advanced policy mode is disabled.",
                key
            )));
        }

        if !is_base && !is_advanced {
            return Err(AppError::Policy(format!(
                "Flag '{}' is not in the provider allowlist.",
                key
            )));
        }

        if !capability_allowed.is_empty() && !capability_allowed.contains(key) {
            return Err(AppError::Cli(format!(
                "Flag '{}' is not supported by detected CLI version {}.",
                key, cli_version
            )));
        }

        if capability_allowed.is_empty() && !settings.allow_advanced_policy {
            return Err(AppError::Cli(format!(
                "Capability map unavailable for detected version {}; optional flags are blocked outside advanced mode.",
                cli_version
            )));
        }

        Ok(())
    }
}

fn is_internal_optional_flag(key: &str) -> bool {
    key.starts_with("__")
}

fn normalize_path(path: &str) -> AppResult<PathBuf> {
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return Err(AppError::Policy(format!(
            "Workspace path '{}' must be absolute",
            path
        )));
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|err| AppError::Policy(format!("Failed to resolve '{}': {}", path, err)))?;
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::PolicyEngine;
    use crate::models::{
        AppSettings, CapabilityProfile, Provider, RunMode, StartRunPayload, WorkspaceGrant,
    };
    use chrono::Utc;
    use std::collections::BTreeMap;

    #[test]
    fn rejects_ungranted_workspace() {
        let engine = PolicyEngine::new();
        let payload = StartRunPayload {
            provider: Provider::Codex,
            prompt: "hello".to_string(),
            model: None,
            mode: RunMode::NonInteractive,
            output_format: None,
            cwd: "/tmp/not-granted".to_string(),
            optional_flags: BTreeMap::new(),
            profile_id: None,
            queue_priority: None,
            timeout_seconds: None,
            scheduled_at: None,
            max_retries: None,
            retry_backoff_ms: None,
            harness: None,
        };

        let cap = CapabilityProfile {
            provider: Provider::Codex,
            cli_version: "1.0.0".to_string(),
            supported: true,
            degraded: false,
            blocked: false,
            supported_flags: vec!["--model".to_string()],
            supported_modes: vec![RunMode::NonInteractive],
            disabled_reasons: vec![],
        };

        let result = engine.validate(&payload, &AppSettings::default(), &[], &cap);
        assert!(result.is_err());
    }

    #[test]
    fn denies_advanced_flag_when_disabled() {
        let engine = PolicyEngine::new();
        let cwd = std::env::temp_dir().join("policy-test");
        let _ = std::fs::create_dir_all(&cwd);
        let path = cwd.to_string_lossy().to_string();

        let mut flags = BTreeMap::new();
        flags.insert("mcp-config".to_string(), serde_json::json!("cfg.json"));

        let payload = StartRunPayload {
            provider: Provider::Claude,
            prompt: "hello".to_string(),
            model: None,
            mode: RunMode::NonInteractive,
            output_format: None,
            cwd: path.clone(),
            optional_flags: flags,
            profile_id: None,
            queue_priority: None,
            timeout_seconds: None,
            scheduled_at: None,
            max_retries: None,
            retry_backoff_ms: None,
            harness: None,
        };

        let grant = WorkspaceGrant {
            id: "1".to_string(),
            path,
            granted_by: "test".to_string(),
            granted_at: Utc::now(),
            revoked_at: None,
        };

        let cap = CapabilityProfile {
            provider: Provider::Claude,
            cli_version: "1.0.0".to_string(),
            supported: true,
            degraded: false,
            blocked: false,
            supported_flags: vec!["--mcp-config".to_string()],
            supported_modes: vec![RunMode::NonInteractive],
            disabled_reasons: vec![],
        };

        let result = engine.validate(&payload, &AppSettings::default(), &[grant], &cap);
        assert!(result.is_err());
    }

    #[test]
    fn validates_resolved_args_and_rejects_unknown_short_flag() {
        let engine = PolicyEngine::new();
        let cap = CapabilityProfile {
            provider: Provider::Claude,
            cli_version: "1.0.0".to_string(),
            supported: true,
            degraded: false,
            blocked: false,
            supported_flags: vec!["--output-format".to_string(), "--model".to_string()],
            supported_modes: vec![RunMode::NonInteractive],
            disabled_reasons: vec![],
        };

        let ok = engine.validate_resolved_args(
            Provider::Claude,
            &["-p".to_string(), "--model".to_string(), "haiku".to_string()],
            &AppSettings::default(),
            &cap,
        );
        assert!(ok.is_ok());

        let bad = engine.validate_resolved_args(
            Provider::Claude,
            &["-x".to_string(), "prompt".to_string()],
            &AppSettings::default(),
            &cap,
        );
        assert!(bad.is_err());
    }

    #[test]
    fn rejects_out_of_bounds_runtime_controls() {
        let engine = PolicyEngine::new();
        let cwd = std::env::temp_dir().join("policy-bounds-test");
        let _ = std::fs::create_dir_all(&cwd);
        let path = cwd.to_string_lossy().to_string();

        let payload = StartRunPayload {
            provider: Provider::Codex,
            prompt: "bounds".to_string(),
            model: None,
            mode: RunMode::NonInteractive,
            output_format: None,
            cwd: path.clone(),
            optional_flags: BTreeMap::new(),
            profile_id: None,
            queue_priority: Some(42),
            timeout_seconds: Some(1),
            scheduled_at: None,
            max_retries: Some(11),
            retry_backoff_ms: Some(50),
            harness: None,
        };

        let grant = WorkspaceGrant {
            id: "2".to_string(),
            path,
            granted_by: "test".to_string(),
            granted_at: Utc::now(),
            revoked_at: None,
        };

        let cap = CapabilityProfile {
            provider: Provider::Codex,
            cli_version: "1.0.0".to_string(),
            supported: true,
            degraded: false,
            blocked: false,
            supported_flags: vec!["--model".to_string()],
            supported_modes: vec![RunMode::NonInteractive],
            disabled_reasons: vec![],
        };

        let result = engine.validate(&payload, &AppSettings::default(), &[grant], &cap);
        assert!(result.is_err());
    }

    #[test]
    fn ignores_internal_optional_flags() {
        let engine = PolicyEngine::new();
        let cwd = std::env::temp_dir().join("policy-internal-flag-test");
        let _ = std::fs::create_dir_all(&cwd);
        let path = cwd.to_string_lossy().to_string();

        let mut flags = BTreeMap::new();
        flags.insert("__resume_session_id".to_string(), serde_json::json!("session-1"));

        let payload = StartRunPayload {
            provider: Provider::Codex,
            prompt: "hello".to_string(),
            model: None,
            mode: RunMode::NonInteractive,
            output_format: Some("text".to_string()),
            cwd: path.clone(),
            optional_flags: flags,
            profile_id: None,
            queue_priority: None,
            timeout_seconds: None,
            scheduled_at: None,
            max_retries: None,
            retry_backoff_ms: None,
            harness: None,
        };

        let grant = WorkspaceGrant {
            id: "3".to_string(),
            path,
            granted_by: "test".to_string(),
            granted_at: Utc::now(),
            revoked_at: None,
        };

        let cap = CapabilityProfile {
            provider: Provider::Codex,
            cli_version: "1.0.0".to_string(),
            supported: true,
            degraded: false,
            blocked: false,
            supported_flags: vec!["--model".to_string(), "--json".to_string()],
            supported_modes: vec![RunMode::NonInteractive],
            disabled_reasons: vec![],
        };

        let result = engine.validate(&payload, &AppSettings::default(), &[grant], &cap);
        assert!(result.is_ok());
    }
}
