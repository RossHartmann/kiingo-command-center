use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("CLI_INVALID: {0}")]
    Cli(String),
    #[error("POLICY_DENIED: {0}")]
    Policy(String),
    #[error("IO_FAILURE: {0}")]
    Io(String),
    #[error("NOT_FOUND: {0}")]
    NotFound(String),
    #[error("INTERNAL: {0}")]
    Internal(String),
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Internal(value.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self::Internal(value.to_string())
    }
}

impl From<anyhow::Error> for AppError {
    fn from(value: anyhow::Error) -> Self {
        Self::Internal(value.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
