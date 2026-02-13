use crate::errors::{AppError, AppResult};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct SessionHandle {
    pub session_id: String,
    pub sender: mpsc::Sender<String>,
}

#[derive(Clone, Default)]
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, SessionHandle>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn open_session(&self, run_id: &str) -> (String, mpsc::Receiver<String>) {
        let session_id = Uuid::new_v4().to_string();
        let (sender, receiver) = mpsc::channel::<String>(256);
        let handle = SessionHandle {
            session_id: session_id.clone(),
            sender,
        };

        let mut sessions = self.sessions.lock().await;
        sessions.insert(run_id.to_string(), handle);

        (session_id, receiver)
    }

    pub async fn session_id(&self, run_id: &str) -> Option<String> {
        let sessions = self.sessions.lock().await;
        sessions.get(run_id).map(|entry| entry.session_id.clone())
    }

    pub async fn send_input(&self, run_id: &str, data: String) -> AppResult<()> {
        let sender = {
            let sessions = self.sessions.lock().await;
            let Some(handle) = sessions.get(run_id) else {
                return Err(AppError::NotFound(format!("No active session for run {}", run_id)));
            };
            handle.sender.clone()
        };

        sender
            .send(data)
            .await
            .map_err(|_| AppError::Io("Failed to send session input".to_string()))?;

        Ok(())
    }

pub async fn close_session(&self, run_id: &str) {
        let mut sessions = self.sessions.lock().await;
        sessions.remove(run_id);
    }
}
