use crate::errors::{AppError, AppResult};
use crate::models::{CliAllowlistConfig, CliAllowlistMode};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct PreparedCliAllowlist {
    pub bin_dir: PathBuf,
    pub env: BTreeMap<String, String>,
    pub cleanup_paths: Vec<PathBuf>,
    pub exposed_commands: Vec<String>,
}

const SAFE_COMMAND_PATTERN: &str = r"^[A-Za-z0-9_-]+$";

fn normalize_name(value: &str, label: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Policy(format!("{} cannot be empty", label)));
    }
    let regex = regex::Regex::new(SAFE_COMMAND_PATTERN).expect("valid regex");
    if !regex.is_match(trimmed) {
        return Err(AppError::Policy(format!(
            "{} '{}' contains invalid characters",
            label, value
        )));
    }
    Ok(trimmed.to_string())
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn cmd_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn path_env_with_prepend(bin_dir: &Path) -> BTreeMap<String, String> {
    let delimiter = if cfg!(windows) { ';' } else { ':' };
    let path_key = std::env::vars()
        .find(|(key, _)| key.eq_ignore_ascii_case("PATH"))
        .map(|(key, _)| key)
        .unwrap_or_else(|| "PATH".to_string());
    let current = std::env::var(&path_key).unwrap_or_default();
    let next = if current.is_empty() {
        bin_dir.to_string_lossy().to_string()
    } else {
        format!("{}{}{}", bin_dir.to_string_lossy(), delimiter, current)
    };
    let mut env = BTreeMap::new();
    env.insert(path_key, next);
    env
}

pub fn prepare_cli_allowlist(config: &CliAllowlistConfig, temp_dir: &Path) -> AppResult<PreparedCliAllowlist> {
    if config.entries.is_empty() {
        return Err(AppError::Policy("cliAllowlist.entries is required".to_string()));
    }

    let mode = config.mode.unwrap_or(CliAllowlistMode::Shims);
    let bin_dir = if let Some(bin_dir) = &config.bin_dir {
        PathBuf::from(bin_dir)
    } else {
        temp_dir.join(format!("harness-bin-{}", uuid::Uuid::new_v4()))
    };
    std::fs::create_dir_all(&bin_dir).map_err(|err| AppError::Io(err.to_string()))?;

    let mut cleanup_paths = Vec::new();
    if config.bin_dir.is_none() && !config.keep_bin_dir.unwrap_or(false) {
        cleanup_paths.push(bin_dir.clone());
    }

    let mut exposed_commands = Vec::new();

    match mode {
        CliAllowlistMode::Shims => {
            let mut seen = std::collections::BTreeSet::new();
            for entry in &config.entries {
                let name = normalize_name(&entry.name, "CLI name")?;
                if !seen.insert(name.clone()) {
                    return Err(AppError::Policy(format!("Duplicate allowed CLI name: {}", name)));
                }
                if entry.path.trim().is_empty() {
                    return Err(AppError::Policy(format!("CLI path is required for {}", name)));
                }

                let args_prefix = entry
                    .args
                    .clone()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|arg| shell_quote(&arg))
                    .collect::<Vec<_>>()
                    .join(" ");
                let env_lines = entry
                    .env
                    .clone()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|(k, v)| format!("export {}={}", k, shell_quote(&v)))
                    .collect::<Vec<_>>()
                    .join("\n");
                let shell = [
                    "#!/usr/bin/env bash".to_string(),
                    "set -euo pipefail".to_string(),
                    env_lines,
                    if args_prefix.is_empty() {
                        format!("exec {} \"$@\"", shell_quote(&entry.path))
                    } else {
                        format!("exec {} {} \"$@\"", shell_quote(&entry.path), args_prefix)
                    },
                    "".to_string(),
                ]
                .into_iter()
                .filter(|line| !line.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n");

                let cmd_args_prefix = entry
                    .args
                    .clone()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|arg| cmd_quote(&arg))
                    .collect::<Vec<_>>()
                    .join(" ");
                let cmd_env_lines = entry
                    .env
                    .clone()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|(k, v)| format!("set \"{}={}\"", k, v))
                    .collect::<Vec<_>>()
                    .join("\r\n");
                let cmd = [
                    "@echo off".to_string(),
                    "setlocal".to_string(),
                    cmd_env_lines,
                    if cmd_args_prefix.is_empty() {
                        format!("{} %*", cmd_quote(&entry.path))
                    } else {
                        format!("{} {} %*", cmd_quote(&entry.path), cmd_args_prefix)
                    },
                    "".to_string(),
                ]
                .into_iter()
                .filter(|line| !line.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\r\n");

                let shim_path = if cfg!(windows) {
                    bin_dir.join(format!("{}.cmd", name))
                } else {
                    bin_dir.join(&name)
                };

                std::fs::write(&shim_path, if cfg!(windows) { cmd } else { shell })
                    .map_err(|err| AppError::Io(err.to_string()))?;

                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let mut perms = std::fs::metadata(&shim_path)
                        .map_err(|err| AppError::Io(err.to_string()))?
                        .permissions();
                    perms.set_mode(0o755);
                    std::fs::set_permissions(&shim_path, perms)
                        .map_err(|err| AppError::Io(err.to_string()))?;
                }

                exposed_commands.push(name);
            }
        }
        CliAllowlistMode::Wrapper => {
            let wrapper_name = normalize_name(
                config
                    .wrapper_name
                    .as_deref()
                    .unwrap_or("kiingo-cli"),
                "Wrapper name",
            )?;

            let mut commands = Vec::new();
            for entry in &config.entries {
                commands.push(normalize_name(&entry.name, "CLI name")?);
            }

            let mut lines = vec![
                "#!/usr/bin/env bash".to_string(),
                "set -euo pipefail".to_string(),
                "cmd=\"${1:-}\"".to_string(),
                format!("if [[ -z \"$cmd\" ]]; then echo \"Usage: {} <command> [args...]\" >&2; exit 2; fi", wrapper_name),
                "shift".to_string(),
                "case \"$cmd\" in".to_string(),
            ];

            for entry in &config.entries {
                let name = normalize_name(&entry.name, "CLI name")?;
                lines.push(format!("  {})", name));
                if let Some(env) = &entry.env {
                    for (k, v) in env {
                        lines.push(format!("    export {}={}", k, shell_quote(v)));
                    }
                }
                let args_prefix = entry
                    .args
                    .clone()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|arg| shell_quote(&arg))
                    .collect::<Vec<_>>()
                    .join(" ");
                if args_prefix.is_empty() {
                    lines.push(format!("    exec {} \"$@\"", shell_quote(&entry.path)));
                } else {
                    lines.push(format!("    exec {} {} \"$@\"", shell_quote(&entry.path), args_prefix));
                }
                lines.push("    ;;".to_string());
            }
            lines.push("  *) echo \"Command not allowed: $cmd\" >&2; exit 3 ;;".to_string());
            lines.push("esac".to_string());

            let wrapper_path = if cfg!(windows) {
                bin_dir.join(format!("{}.cmd", wrapper_name))
            } else {
                bin_dir.join(&wrapper_name)
            };
            std::fs::write(&wrapper_path, lines.join("\n")).map_err(|err| AppError::Io(err.to_string()))?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = std::fs::metadata(&wrapper_path)
                    .map_err(|err| AppError::Io(err.to_string()))?
                    .permissions();
                perms.set_mode(0o755);
                std::fs::set_permissions(&wrapper_path, perms)
                    .map_err(|err| AppError::Io(err.to_string()))?;
            }

            exposed_commands.push(wrapper_name);
        }
    }

    Ok(PreparedCliAllowlist {
        bin_dir: bin_dir.clone(),
        env: path_env_with_prepend(&bin_dir),
        cleanup_paths,
        exposed_commands,
    })
}

#[cfg(test)]
mod tests {
    use super::prepare_cli_allowlist;
    use crate::models::{CliAllowlistConfig, CliAllowlistEntry, CliAllowlistMode};

    #[test]
    fn creates_shim_allowlist_bin() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config = CliAllowlistConfig {
            entries: vec![CliAllowlistEntry {
                name: "echo-safe".to_string(),
                path: "/bin/echo".to_string(),
                args: None,
                env: None,
            }],
            mode: Some(CliAllowlistMode::Shims),
            wrapper_name: None,
            bin_dir: None,
            keep_bin_dir: Some(false),
        };
        let prepared = prepare_cli_allowlist(&config, dir.path()).expect("prepare");
        assert!(prepared.bin_dir.exists());
        assert!(prepared.env.iter().any(|(key, _)| key.eq_ignore_ascii_case("PATH")));
        assert_eq!(prepared.exposed_commands, vec!["echo-safe".to_string()]);
    }
}
