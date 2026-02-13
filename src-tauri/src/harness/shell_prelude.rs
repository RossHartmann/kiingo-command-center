use crate::errors::{AppError, AppResult};
use crate::models::ShellPreludeConfig;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct PreparedShellPrelude {
    pub path: PathBuf,
    pub env: BTreeMap<String, String>,
    pub cleanup_paths: Vec<PathBuf>,
}

pub fn prepare_shell_prelude(config: &ShellPreludeConfig, temp_dir: &Path) -> AppResult<PreparedShellPrelude> {
    let content = config.content.trim();
    if content.is_empty() {
        return Err(AppError::Policy("shellPrelude content cannot be empty".to_string()));
    }

    std::fs::create_dir_all(temp_dir).map_err(|err| AppError::Io(err.to_string()))?;
    let file_path = temp_dir.join(format!("harness-prelude-{}.sh", uuid::Uuid::new_v4()));
    std::fs::write(&file_path, format!("{}\n", content)).map_err(|err| AppError::Io(err.to_string()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&file_path)
            .map_err(|err| AppError::Io(err.to_string()))?
            .permissions();
        perms.set_mode(0o600);
        std::fs::set_permissions(&file_path, perms).map_err(|err| AppError::Io(err.to_string()))?;
    }

    let mut env = BTreeMap::new();
    if config.bash_env.unwrap_or(true) {
        env.insert("BASH_ENV".to_string(), file_path.to_string_lossy().to_string());
    }
    if config.sh_env.unwrap_or(true) {
        env.insert("ENV".to_string(), file_path.to_string_lossy().to_string());
    }

    Ok(PreparedShellPrelude {
        path: file_path.clone(),
        env,
        cleanup_paths: vec![file_path],
    })
}

#[cfg(test)]
mod tests {
    use super::prepare_shell_prelude;
    use crate::models::ShellPreludeConfig;

    #[test]
    fn creates_shell_prelude_file_and_env() {
        let dir = tempfile::tempdir().expect("tempdir");
        let prepared = prepare_shell_prelude(
            &ShellPreludeConfig {
                content: "echo prelude".to_string(),
                bash_env: Some(true),
                sh_env: Some(true),
            },
            dir.path(),
        )
        .expect("prepare");

        assert!(prepared.path.exists());
        assert!(prepared.env.contains_key("BASH_ENV"));
        assert!(prepared.env.contains_key("ENV"));
    }
}
