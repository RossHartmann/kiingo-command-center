use crate::errors::{AppError, AppResult};
use crate::models::{
    AppSettings, BindMetricToScreenPayload, CapabilitySnapshot, ConversationDetail, ConversationRecord,
    ConversationSummary, ListConversationsFilters, ListRunsFilters, MetricDefinition, MetricDiagnostics,
    MetricSnapshot, MetricSnapshotStatus, Profile, Provider, RunArtifact, RunDetail, RunEventRecord, RunMode,
    RunRecord, RunStatus, SaveMetricDefinitionPayload, SaveProfilePayload, SchedulerJob, ScreenMetricBinding,
    ScreenMetricLayoutItem, ScreenMetricView, WorkspaceGrant,
};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

const SCHEMA_SQL: &str = include_str!("schema.sql");

#[derive(Debug)]
pub struct Database {
    conn: Mutex<Connection>,
    db_path: PathBuf,
}

impl Database {
    pub fn new(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| AppError::Io(err.to_string()))?;
        }
        let conn = Connection::open(path).map_err(AppError::from)?;
        conn.execute_batch(SCHEMA_SQL).map_err(AppError::from)?;

        let db = Self {
            conn: Mutex::new(conn),
            db_path: path.to_path_buf(),
        };

        db.ensure_schema_extensions()?;
        db.seed_default_metrics()?;
        db.seed_revenue_metrics()?;
        db.ensure_default_settings()?;
        db.ensure_default_retention()?;

        Ok(db)
    }

    pub fn insert_run(
        &self,
        run_id: &str,
        provider: Provider,
        prompt: &str,
        model: Option<&str>,
        mode: RunMode,
        output_format: Option<&str>,
        cwd: &str,
        queue_priority: i32,
        profile_id: Option<&str>,
        capability_snapshot_id: Option<&str>,
        compatibility_warnings: &[String],
    ) -> AppResult<RunRecord> {
        let now = Utc::now();
        let warnings_json = serde_json::to_string(compatibility_warnings)?;

        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "INSERT INTO runs (
               id, provider, status, prompt, model, mode, output_format, cwd,
               started_at, queue_priority, profile_id, capability_snapshot_id, compatibility_warnings_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                run_id,
                provider.as_str(),
                RunStatus::Queued.as_str(),
                prompt,
                model,
                mode_as_str(mode),
                output_format,
                cwd,
                now.to_rfc3339(),
                queue_priority,
                profile_id,
                capability_snapshot_id,
                warnings_json,
            ],
        )?;

        Ok(RunRecord {
            id: run_id.to_string(),
            provider,
            status: RunStatus::Queued,
            prompt: prompt.to_string(),
            model: model.map(ToString::to_string),
            mode,
            output_format: output_format.map(ToString::to_string),
            cwd: cwd.to_string(),
            started_at: now,
            ended_at: None,
            exit_code: None,
            error_summary: None,
            queue_priority,
            profile_id: profile_id.map(ToString::to_string),
            capability_snapshot_id: capability_snapshot_id.map(ToString::to_string),
            compatibility_warnings: compatibility_warnings.to_vec(),
            conversation_id: None,
        })
    }

    pub fn update_run_status(
        &self,
        run_id: &str,
        status: RunStatus,
        exit_code: Option<i32>,
        error_summary: Option<&str>,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let ended = matches!(
            status,
            RunStatus::Completed | RunStatus::Failed | RunStatus::Canceled | RunStatus::Interrupted
        );

        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        if ended {
            conn.execute(
                "UPDATE runs SET status = ?1, ended_at = ?2, exit_code = ?3, error_summary = ?4 WHERE id = ?5",
                params![status.as_str(), now, exit_code, error_summary, run_id],
            )?;
        } else {
            conn.execute(
                "UPDATE runs SET status = ?1, exit_code = ?2, error_summary = ?3 WHERE id = ?4",
                params![status.as_str(), exit_code, error_summary, run_id],
            )?;
        }
        Ok(())
    }

    pub fn add_compatibility_warning(&self, run_id: &str, warning: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let existing: String = conn.query_row(
            "SELECT compatibility_warnings_json FROM runs WHERE id = ?1",
            [run_id],
            |row| row.get(0),
        )?;

        let mut warnings: Vec<String> = serde_json::from_str(&existing).unwrap_or_default();
        if !warnings.iter().any(|current| current == warning) {
            warnings.push(warning.to_string());
        }
        let warnings_json = serde_json::to_string(&warnings)?;

        conn.execute(
            "UPDATE runs SET compatibility_warnings_json = ?1 WHERE id = ?2",
            params![warnings_json, run_id],
        )?;
        Ok(())
    }

    pub fn insert_event(&self, run_id: &str, event_type: &str, payload: &serde_json::Value) -> AppResult<RunEventRecord> {
        let created_at = Utc::now();
        let id = Uuid::new_v4().to_string();

        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let seq: i64 = conn.query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM run_events WHERE run_id = ?1",
            [run_id],
            |row| row.get(0),
        )?;

        conn.execute(
            "INSERT INTO run_events (id, run_id, seq, event_type, payload_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                run_id,
                seq,
                event_type,
                serde_json::to_string(payload)?,
                created_at.to_rfc3339()
            ],
        )?;

        Ok(RunEventRecord {
            id,
            run_id: run_id.to_string(),
            seq,
            event_type: event_type.to_string(),
            payload: payload.clone(),
            created_at,
        })
    }

    pub fn insert_artifact(&self, run_id: &str, kind: &str, path: &str, metadata: &serde_json::Value) -> AppResult<RunArtifact> {
        let id = Uuid::new_v4().to_string();
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "INSERT INTO run_artifacts (id, run_id, kind, path, metadata_json) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, run_id, kind, path, serde_json::to_string(metadata)?],
        )?;

        Ok(RunArtifact {
            id,
            run_id: run_id.to_string(),
            kind: kind.to_string(),
            path: path.to_string(),
            metadata: metadata.clone(),
        })
    }

    pub fn list_runs(&self, filters: &ListRunsFilters) -> AppResult<Vec<RunRecord>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let mut query = String::from(
            "SELECT id, provider, status, prompt, model, mode, output_format, cwd, started_at, ended_at, exit_code, error_summary, queue_priority, profile_id, capability_snapshot_id, compatibility_warnings_json, conversation_id
             FROM runs WHERE 1 = 1",
        );

        let mut params_vec: Vec<String> = Vec::new();

        if let Some(provider) = filters.provider {
            query.push_str(" AND provider = ?");
            params_vec.push(provider.as_str().to_string());
        }
        if let Some(status) = filters.status {
            query.push_str(" AND status = ?");
            params_vec.push(status.as_str().to_string());
        }
        if let Some(conversation_id) = &filters.conversation_id {
            query.push_str(" AND conversation_id = ?");
            params_vec.push(conversation_id.clone());
        }
        if let Some(search) = &filters.search {
            query.push_str(" AND prompt LIKE ?");
            params_vec.push(format!("%{}%", search));
        }
        if let Some(date_from) = filters.date_from {
            query.push_str(" AND started_at >= ?");
            params_vec.push(date_from.to_rfc3339());
        }
        if let Some(date_to) = filters.date_to {
            query.push_str(" AND started_at <= ?");
            params_vec.push(date_to.to_rfc3339());
        }

        query.push_str(" ORDER BY started_at DESC");

        let limit = filters.limit.unwrap_or(100);
        let offset = filters.offset.unwrap_or(0);
        query.push_str(" LIMIT ? OFFSET ?");

        let mut statement = conn.prepare(&query)?;
        let mut dyn_params: Vec<&dyn rusqlite::ToSql> = params_vec
            .iter()
            .map(|param| param as &dyn rusqlite::ToSql)
            .collect();
        dyn_params.push(&limit);
        dyn_params.push(&offset);

        let rows = statement.query_map(rusqlite::params_from_iter(dyn_params), parse_run_row)?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn get_run(&self, run_id: &str) -> AppResult<Option<RunRecord>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.query_row(
            "SELECT id, provider, status, prompt, model, mode, output_format, cwd, started_at, ended_at, exit_code, error_summary, queue_priority, profile_id, capability_snapshot_id, compatibility_warnings_json, conversation_id
             FROM runs WHERE id = ?1",
            [run_id],
            parse_run_row,
        )
        .optional()
        .map_err(AppError::from)
    }

    pub fn get_run_detail(&self, run_id: &str) -> AppResult<Option<RunDetail>> {
        let run = match self.get_run(run_id)? {
            Some(run) => run,
            None => return Ok(None),
        };

        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;

        let mut event_stmt = conn.prepare(
            "SELECT id, run_id, seq, event_type, payload_json, created_at
             FROM run_events WHERE run_id = ?1 ORDER BY seq ASC",
        )?;
        let events = event_stmt
            .query_map([run_id], |row| {
                Ok(RunEventRecord {
                    id: row.get(0)?,
                    run_id: row.get(1)?,
                    seq: row.get(2)?,
                    event_type: row.get(3)?,
                    payload: serde_json::from_str::<serde_json::Value>(&row.get::<_, String>(4)?)
                        .unwrap_or(serde_json::json!({})),
                    created_at: parse_time(&row.get::<_, String>(5)?)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut artifact_stmt = conn.prepare(
            "SELECT id, run_id, kind, path, metadata_json
             FROM run_artifacts WHERE run_id = ?1 ORDER BY id ASC",
        )?;
        let artifacts = artifact_stmt
            .query_map([run_id], |row| {
                Ok(RunArtifact {
                    id: row.get(0)?,
                    run_id: row.get(1)?,
                    kind: row.get(2)?,
                    path: row.get(3)?,
                    metadata: serde_json::from_str::<serde_json::Value>(&row.get::<_, String>(4)?)
                        .unwrap_or(serde_json::json!({})),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Some(RunDetail {
            run,
            events,
            artifacts,
        }))
    }

    pub fn create_conversation(
        &self,
        provider: Provider,
        title: Option<&str>,
        metadata: Option<&serde_json::Value>,
    ) -> AppResult<ConversationRecord> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let title = normalize_conversation_title(title.unwrap_or_default());
        let metadata = metadata.cloned().unwrap_or_else(|| serde_json::json!({}));
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "INSERT INTO conversations (id, provider, title, provider_session_id, metadata_json, created_at, updated_at, archived_at)
             VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?5, NULL)",
            params![
                id,
                provider.as_str(),
                title,
                serde_json::to_string(&metadata)?,
                now.to_rfc3339()
            ],
        )?;
        Ok(ConversationRecord {
            id,
            provider,
            title,
            provider_session_id: None,
            metadata,
            created_at: now,
            updated_at: now,
            archived_at: None,
        })
    }

    pub fn list_conversations(&self, filters: &ListConversationsFilters) -> AppResult<Vec<ConversationSummary>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let mut query = String::from(
            "SELECT id, provider, title, provider_session_id, updated_at, archived_at
             FROM conversations WHERE 1 = 1",
        );
        let mut params_vec: Vec<String> = Vec::new();

        if let Some(provider) = filters.provider {
            query.push_str(" AND provider = ?");
            params_vec.push(provider.as_str().to_string());
        }
        if !filters.include_archived.unwrap_or(false) {
            query.push_str(" AND archived_at IS NULL");
        }
        if let Some(search) = &filters.search {
            query.push_str(" AND title LIKE ?");
            params_vec.push(format!("%{}%", search));
        }

        query.push_str(" ORDER BY updated_at DESC");
        let limit = filters.limit.unwrap_or(100);
        let offset = filters.offset.unwrap_or(0);
        query.push_str(" LIMIT ? OFFSET ?");

        let mut statement = conn.prepare(&query)?;
        let mut dyn_params: Vec<&dyn rusqlite::ToSql> = params_vec
            .iter()
            .map(|param| param as &dyn rusqlite::ToSql)
            .collect();
        dyn_params.push(&limit);
        dyn_params.push(&offset);

        let mut rows = statement.query(rusqlite::params_from_iter(dyn_params))?;
        let mut items = Vec::new();
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            let provider = parse_provider(&row.get::<_, String>(1)?)?;
            let title: String = row.get(2)?;
            let provider_session_id: Option<String> = row.get(3)?;
            let updated_at = parse_time(&row.get::<_, String>(4)?)?;
            let archived_at = row
                .get::<_, Option<String>>(5)?
                .map(|raw| parse_time(&raw))
                .transpose()?;

            let (last_run_id, last_message_preview): (Option<String>, Option<String>) = conn
                .query_row(
                    "SELECT r.id, r.prompt
                     FROM conversation_runs cr
                     JOIN runs r ON r.id = cr.run_id
                     WHERE cr.conversation_id = ?1
                     ORDER BY cr.seq DESC
                     LIMIT 1",
                    [&id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?
                .unwrap_or((None, None));

            items.push(ConversationSummary {
                id,
                provider,
                title,
                provider_session_id,
                updated_at,
                archived_at,
                last_run_id,
                last_message_preview,
            });
        }
        Ok(items)
    }

    pub fn get_conversation(&self, conversation_id: &str) -> AppResult<Option<ConversationRecord>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.query_row(
            "SELECT id, provider, title, provider_session_id, metadata_json, created_at, updated_at, archived_at
             FROM conversations WHERE id = ?1",
            [conversation_id],
            parse_conversation_row,
        )
        .optional()
        .map_err(AppError::from)
    }

    pub fn get_conversation_detail(&self, conversation_id: &str) -> AppResult<Option<ConversationDetail>> {
        let Some(conversation) = self.get_conversation(conversation_id)? else {
            return Ok(None);
        };
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT r.id, r.provider, r.status, r.prompt, r.model, r.mode, r.output_format, r.cwd,
                    r.started_at, r.ended_at, r.exit_code, r.error_summary, r.queue_priority,
                    r.profile_id, r.capability_snapshot_id, r.compatibility_warnings_json, r.conversation_id
             FROM conversation_runs cr
             JOIN runs r ON r.id = cr.run_id
             WHERE cr.conversation_id = ?1
             ORDER BY cr.seq ASC",
        )?;
        let runs = stmt
            .query_map([conversation_id], parse_run_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Some(ConversationDetail { conversation, runs }))
    }

    pub fn rename_conversation(&self, conversation_id: &str, title: &str) -> AppResult<Option<ConversationRecord>> {
        let normalized = normalize_conversation_title(title);
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let changed = conn.execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![normalized, now, conversation_id],
        )?;
        if changed == 0 {
            return Ok(None);
        }
        drop(conn);
        self.get_conversation(conversation_id)
    }

    pub fn archive_conversation(&self, conversation_id: &str, archived: bool) -> AppResult<bool> {
        let now = Utc::now().to_rfc3339();
        let archived_at = if archived { Some(now.clone()) } else { None };
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let changed = conn.execute(
            "UPDATE conversations SET archived_at = ?1, updated_at = ?2 WHERE id = ?3",
            params![archived_at, now, conversation_id],
        )?;
        Ok(changed > 0)
    }

    pub fn set_run_conversation_id(&self, run_id: &str, conversation_id: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "UPDATE runs SET conversation_id = ?1 WHERE id = ?2",
            params![conversation_id, run_id],
        )?;
        Ok(())
    }

    pub fn next_conversation_seq(&self, conversation_id: &str) -> AppResult<i64> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let seq: i64 = conn.query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM conversation_runs WHERE conversation_id = ?1",
            [conversation_id],
            |row| row.get(0),
        )?;
        Ok(seq)
    }

    pub fn attach_run_to_conversation(&self, conversation_id: &str, run_id: &str) -> AppResult<()> {
        let seq = self.next_conversation_seq(conversation_id)?;
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "INSERT OR IGNORE INTO conversation_runs (id, conversation_id, run_id, seq, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                Uuid::new_v4().to_string(),
                conversation_id,
                run_id,
                seq,
                Utc::now().to_rfc3339()
            ],
        )?;
        drop(conn);
        self.set_run_conversation_id(run_id, conversation_id)?;
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![Utc::now().to_rfc3339(), conversation_id],
        )?;
        Ok(())
    }

    pub fn set_conversation_session_id(&self, conversation_id: &str, session_id: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "UPDATE conversations SET provider_session_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![session_id, Utc::now().to_rfc3339(), conversation_id],
        )?;
        Ok(())
    }

    pub fn clear_conversation_session_id(&self, conversation_id: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "UPDATE conversations SET provider_session_id = NULL, updated_at = ?1 WHERE id = ?2",
            params![Utc::now().to_rfc3339(), conversation_id],
        )?;
        Ok(())
    }

    pub fn touch_conversation_updated_at(&self, conversation_id: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![Utc::now().to_rfc3339(), conversation_id],
        )?;
        Ok(())
    }

    pub fn find_conversation_id_by_run(&self, run_id: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let result: Option<Option<String>> = conn
            .query_row(
            "SELECT conversation_id FROM runs WHERE id = ?1",
            [run_id],
            |row| row.get::<_, Option<String>>(0),
        )
            .optional()?;
        Ok(result.flatten())
    }

    pub fn list_profiles(&self) -> AppResult<Vec<Profile>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let mut statement = conn.prepare(
            "SELECT id, name, provider, config_json, created_at, updated_at FROM profiles ORDER BY updated_at DESC",
        )?;

        let profiles = statement
            .query_map([], |row| {
                Ok(Profile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    provider: parse_provider(&row.get::<_, String>(2)?)?,
                    config: serde_json::from_str::<serde_json::Value>(&row.get::<_, String>(3)?)
                        .unwrap_or(serde_json::json!({})),
                    created_at: parse_time(&row.get::<_, String>(4)?)?,
                    updated_at: parse_time(&row.get::<_, String>(5)?)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(profiles)
    }

    pub fn get_profile_by_id(&self, profile_id: &str) -> AppResult<Option<Profile>> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.query_row(
            "SELECT id, name, provider, config_json, created_at, updated_at FROM profiles WHERE id = ?1",
            [profile_id],
            |row| {
                Ok(Profile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    provider: parse_provider(&row.get::<_, String>(2)?)?,
                    config: serde_json::from_str::<serde_json::Value>(&row.get::<_, String>(3)?)
                        .unwrap_or(serde_json::json!({})),
                    created_at: parse_time(&row.get::<_, String>(4)?)?,
                    updated_at: parse_time(&row.get::<_, String>(5)?)?,
                })
            },
        )
        .optional()
        .map_err(AppError::from)
    }

    pub fn save_profile(&self, payload: SaveProfilePayload) -> AppResult<Profile> {
        let now = Utc::now();
        let id = payload.id.unwrap_or_else(|| Uuid::new_v4().to_string());

        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let exists = conn
            .query_row(
                "SELECT COUNT(1) FROM profiles WHERE id = ?1",
                [id.as_str()],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;

        if exists {
            conn.execute(
                "UPDATE profiles SET name = ?1, provider = ?2, config_json = ?3, updated_at = ?4 WHERE id = ?5",
                params![
                    payload.name,
                    payload.provider.as_str(),
                    serde_json::to_string(&payload.config)?,
                    now.to_rfc3339(),
                    id,
                ],
            )?;
        } else {
            conn.execute(
                "INSERT INTO profiles (id, name, provider, config_json, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    id,
                    payload.name,
                    payload.provider.as_str(),
                    serde_json::to_string(&payload.config)?,
                    now.to_rfc3339(),
                    now.to_rfc3339(),
                ],
            )?;
        }

        Ok(Profile {
            id,
            name: payload.name,
            provider: payload.provider,
            config: payload.config,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn get_settings(&self) -> AppResult<AppSettings> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let raw = conn
            .query_row(
                "SELECT value_json FROM settings WHERE key = 'app'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        match raw {
            Some(raw) => Ok(serde_json::from_str::<AppSettings>(&raw).unwrap_or_default()),
            None => Ok(AppSettings::default()),
        }
    }

    pub fn update_settings(&self, update: serde_json::Value) -> AppResult<AppSettings> {
        let current = self.get_settings()?;
        let mut merged = serde_json::to_value(current)?;
        merge_json(&mut merged, update);
        let settings: AppSettings = serde_json::from_value(merged)?;

        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "INSERT INTO settings (key, value_json, updated_at)
             VALUES ('app', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            params![serde_json::to_string(&settings)?, Utc::now().to_rfc3339()],
        )?;

        Ok(settings)
    }

    pub fn insert_capability_snapshot(&self, snapshot: &CapabilitySnapshot) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "INSERT INTO capability_snapshots (id, provider, cli_version, profile_json, detected_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                snapshot.id,
                snapshot.provider.as_str(),
                snapshot.cli_version,
                serde_json::to_string(&snapshot.profile)?,
                snapshot.detected_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn list_capability_snapshots(&self) -> AppResult<Vec<CapabilitySnapshot>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, provider, cli_version, profile_json, detected_at
             FROM capability_snapshots ORDER BY detected_at DESC LIMIT 32",
        )?;

        let items = stmt
            .query_map([], |row| {
                let profile_raw: String = row.get(3)?;
                Ok(CapabilitySnapshot {
                    id: row.get(0)?,
                    provider: parse_provider(&row.get::<_, String>(1)?)?,
                    cli_version: row.get(2)?,
                    profile: serde_json::from_str(&profile_raw).unwrap_or_else(|_| crate::models::CapabilityProfile {
                        provider: Provider::Codex,
                        cli_version: "unknown".to_string(),
                        supported: false,
                        degraded: true,
                        blocked: true,
                        supported_flags: vec![],
                        supported_modes: vec![RunMode::NonInteractive],
                        disabled_reasons: vec!["Corrupt profile data".to_string()],
                    }),
                    detected_at: parse_time(&row.get::<_, String>(4)?)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(items)
    }

    pub fn get_capability_snapshot_by_id(&self, snapshot_id: &str) -> AppResult<Option<CapabilitySnapshot>> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.query_row(
            "SELECT id, provider, cli_version, profile_json, detected_at
             FROM capability_snapshots WHERE id = ?1",
            [snapshot_id],
            |row| {
                let profile_raw: String = row.get(3)?;
                Ok(CapabilitySnapshot {
                    id: row.get(0)?,
                    provider: parse_provider(&row.get::<_, String>(1)?)?,
                    cli_version: row.get(2)?,
                    profile: serde_json::from_str(&profile_raw).unwrap_or_else(|_| crate::models::CapabilityProfile {
                        provider: Provider::Codex,
                        cli_version: "unknown".to_string(),
                        supported: false,
                        degraded: true,
                        blocked: true,
                        supported_flags: vec![],
                        supported_modes: vec![RunMode::NonInteractive],
                        disabled_reasons: vec!["Corrupt profile data".to_string()],
                    }),
                    detected_at: parse_time(&row.get::<_, String>(4)?)?,
                })
            },
        )
        .optional()
        .map_err(AppError::from)
    }

    pub fn list_workspace_grants(&self) -> AppResult<Vec<WorkspaceGrant>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, path, granted_by, granted_at, revoked_at
             FROM workspace_grants ORDER BY granted_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(WorkspaceGrant {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    granted_by: row.get(2)?,
                    granted_at: parse_time(&row.get::<_, String>(3)?)?,
                    revoked_at: row
                        .get::<_, Option<String>>(4)?
                        .map(|raw| parse_time(&raw))
                        .transpose()?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn grant_workspace(&self, path: &str, granted_by: &str) -> AppResult<WorkspaceGrant> {
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "INSERT INTO workspace_grants (id, path, granted_by, granted_at, revoked_at)
             VALUES (?1, ?2, ?3, ?4, NULL)",
            params![id, path, granted_by, now.to_rfc3339()],
        )?;
        Ok(WorkspaceGrant {
            id,
            path: path.to_string(),
            granted_by: granted_by.to_string(),
            granted_at: now,
            revoked_at: None,
        })
    }

    pub fn insert_scheduler_job(
        &self,
        run_id: &str,
        priority: i32,
        next_run_at: Option<DateTime<Utc>>,
        max_retries: u32,
        retry_backoff_ms: u64,
    ) -> AppResult<SchedulerJob> {
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "INSERT INTO scheduler_jobs (id, run_id, priority, state, queued_at, next_run_at, attempts, max_retries, retry_backoff_ms, last_error)
             VALUES (?1, ?2, ?3, 'queued', ?4, ?5, 0, ?6, ?7, NULL)",
            params![
                id,
                run_id,
                priority,
                now.to_rfc3339(),
                next_run_at.map(|at| at.to_rfc3339()),
                max_retries,
                retry_backoff_ms
            ],
        )?;
        Ok(SchedulerJob {
            id,
            run_id: run_id.to_string(),
            priority,
            state: "queued".to_string(),
            queued_at: now,
            next_run_at,
            attempts: 0,
            max_retries,
            retry_backoff_ms,
            last_error: None,
            started_at: None,
            finished_at: None,
        })
    }

    pub fn mark_job_running(&self, run_id: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "UPDATE scheduler_jobs
             SET state = 'running', started_at = ?1, attempts = attempts + 1, last_error = NULL
             WHERE run_id = ?2 AND state = 'queued'",
            params![Utc::now().to_rfc3339(), run_id],
        )?;
        Ok(())
    }

    pub fn mark_job_retry(&self, run_id: &str, next_run_at: DateTime<Utc>, last_error: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "UPDATE scheduler_jobs
             SET state = 'queued', next_run_at = ?1, started_at = NULL, finished_at = NULL, last_error = ?2
             WHERE run_id = ?3",
            params![next_run_at.to_rfc3339(), last_error, run_id],
        )?;
        Ok(())
    }

    pub fn mark_job_finished(&self, run_id: &str, failed: bool) -> AppResult<()> {
        let state = if failed { "failed" } else { "completed" };
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "UPDATE scheduler_jobs
             SET state = ?1, finished_at = ?2
             WHERE run_id = ?3 AND state IN ('running', 'queued')",
            params![state, Utc::now().to_rfc3339(), run_id],
        )?;
        Ok(())
    }

    pub fn list_queue_jobs(&self) -> AppResult<Vec<SchedulerJob>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, run_id, priority, state, queued_at, started_at, finished_at
             , next_run_at, attempts, max_retries, retry_backoff_ms, last_error
             FROM scheduler_jobs ORDER BY queued_at DESC LIMIT 500",
        )?;

        let rows = stmt
            .query_map([], |row| {
                Ok(SchedulerJob {
                    id: row.get(0)?,
                    run_id: row.get(1)?,
                    priority: row.get(2)?,
                    state: row.get(3)?,
                    queued_at: parse_time(&row.get::<_, String>(4)?)?,
                    next_run_at: row
                        .get::<_, Option<String>>(7)?
                        .map(|raw| parse_time(&raw))
                        .transpose()?,
                    attempts: row.get(8)?,
                    max_retries: row.get(9)?,
                    retry_backoff_ms: row.get(10)?,
                    last_error: row.get(11)?,
                    started_at: row
                        .get::<_, Option<String>>(5)?
                        .map(|raw| parse_time(&raw))
                        .transpose()?,
                    finished_at: row
                        .get::<_, Option<String>>(6)?
                        .map(|raw| parse_time(&raw))
                        .transpose()?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(rows)
    }

    pub fn get_queue_job(&self, run_id: &str) -> AppResult<Option<SchedulerJob>> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.query_row(
            "SELECT id, run_id, priority, state, queued_at, started_at, finished_at
             , next_run_at, attempts, max_retries, retry_backoff_ms, last_error
             FROM scheduler_jobs WHERE run_id = ?1 ORDER BY queued_at DESC LIMIT 1",
            [run_id],
            |row| {
                Ok(SchedulerJob {
                    id: row.get(0)?,
                    run_id: row.get(1)?,
                    priority: row.get(2)?,
                    state: row.get(3)?,
                    queued_at: parse_time(&row.get::<_, String>(4)?)?,
                    next_run_at: row
                        .get::<_, Option<String>>(7)?
                        .map(|raw| parse_time(&raw))
                        .transpose()?,
                    attempts: row.get(8)?,
                    max_retries: row.get(9)?,
                    retry_backoff_ms: row.get(10)?,
                    last_error: row.get(11)?,
                    started_at: row
                        .get::<_, Option<String>>(5)?
                        .map(|raw| parse_time(&raw))
                        .transpose()?,
                    finished_at: row
                        .get::<_, Option<String>>(6)?
                        .map(|raw| parse_time(&raw))
                        .transpose()?,
                })
            },
        )
        .optional()
        .map_err(AppError::from)
    }

    pub fn mark_orphan_snapshots_failed(&self) -> AppResult<u64> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let changed = conn.execute(
            "UPDATE metric_snapshots
             SET status = 'failed', error_message = 'Run interrupted by app restart'
             WHERE status IN ('pending', 'running')",
            [],
        )?;
        Ok(changed as u64)
    }

    pub fn mark_orphan_runs_interrupted(&self) -> AppResult<u64> {
        let now = Utc::now().to_rfc3339();
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let changed = conn.execute(
            "UPDATE runs
             SET status = 'interrupted', ended_at = ?1, error_summary = 'Application restarted during run'
             WHERE status IN ('queued', 'running')",
            [now.clone()],
        )?;
        conn.execute(
            "UPDATE scheduler_jobs
             SET state = 'failed', finished_at = ?1
             WHERE state IN ('queued', 'running')",
            [now],
        )?;
        Ok(changed as u64)
    }

    pub fn run_retention_prune(&self, settings: &AppSettings) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "DELETE FROM runs WHERE started_at < datetime('now', ?1)",
            [format!("-{} days", settings.retention_days)],
        )?;
        conn.execute(
            "DELETE FROM metric_snapshots WHERE created_at < datetime('now', ?1)",
            [format!("-{} days", settings.retention_days)],
        )?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        drop(conn);

        self.enforce_storage_cap(settings.max_storage_mb)?;
        Ok(())
    }

    fn enforce_storage_cap(&self, max_storage_mb: u32) -> AppResult<()> {
        let max_bytes = u64::from(max_storage_mb) * 1024 * 1024;
        let mut current = self.database_size_bytes().unwrap_or(0);
        if current <= max_bytes {
            return Ok(());
        }

        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;

        while current > max_bytes {
            let deleted = conn.execute(
                "DELETE FROM runs WHERE id IN (
                   SELECT id FROM runs
                   WHERE status IN ('completed', 'failed', 'canceled', 'interrupted')
                   ORDER BY started_at ASC
                   LIMIT 50
                 )",
                [],
            )?;
            if deleted == 0 {
                break;
            }
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")?;
            current = self.database_size_bytes().unwrap_or(0);
        }

        Ok(())
    }

    fn database_size_bytes(&self) -> AppResult<u64> {
        let wal_path = self.db_path.with_extension("sqlite-wal");
        let mut total = std::fs::metadata(&self.db_path)
            .map_err(|error| AppError::Io(error.to_string()))?
            .len();
        if let Ok(meta) = std::fs::metadata(wal_path) {
            total += meta.len();
        }
        Ok(total)
    }

    // ─── Metric Definitions CRUD ──────────────────────────────────────────────

    pub fn save_metric_definition(&self, payload: SaveMetricDefinitionPayload) -> AppResult<MetricDefinition> {
        let now = Utc::now();
        let id = payload.id.unwrap_or_else(|| Uuid::new_v4().to_string());

        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let exists = conn
            .query_row(
                "SELECT COUNT(1) FROM metric_definitions WHERE id = ?1",
                [id.as_str()],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;

        let provider = payload.provider.unwrap_or(Provider::Claude);
        let template_html = payload.template_html.unwrap_or_default();
        let ttl_seconds = payload.ttl_seconds.unwrap_or(259200);
        let enabled = payload.enabled.unwrap_or(true);
        let proactive = payload.proactive.unwrap_or(false);
        let metadata = payload.metadata_json.unwrap_or_else(|| serde_json::json!({}));

        if exists {
            conn.execute(
                "UPDATE metric_definitions SET name=?1, slug=?2, instructions=?3, template_html=?4,
                 ttl_seconds=?5, provider=?6, model=?7, profile_id=?8, cwd=?9, enabled=?10,
                 proactive=?11, metadata_json=?12, updated_at=?13 WHERE id=?14",
                params![
                    payload.name,
                    payload.slug,
                    payload.instructions,
                    template_html,
                    ttl_seconds,
                    provider.as_str(),
                    payload.model,
                    payload.profile_id,
                    payload.cwd,
                    enabled as i32,
                    proactive as i32,
                    serde_json::to_string(&metadata)?,
                    now.to_rfc3339(),
                    id,
                ],
            )?;
        } else {
            conn.execute(
                "INSERT INTO metric_definitions (id, name, slug, instructions, template_html,
                 ttl_seconds, provider, model, profile_id, cwd, enabled, proactive,
                 metadata_json, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
                params![
                    id,
                    payload.name,
                    payload.slug,
                    payload.instructions,
                    template_html,
                    ttl_seconds,
                    provider.as_str(),
                    payload.model,
                    payload.profile_id,
                    payload.cwd,
                    enabled as i32,
                    proactive as i32,
                    serde_json::to_string(&metadata)?,
                    now.to_rfc3339(),
                ],
            )?;
        }

        Ok(MetricDefinition {
            id,
            name: payload.name,
            slug: payload.slug,
            instructions: payload.instructions,
            template_html,
            ttl_seconds,
            provider,
            model: payload.model,
            profile_id: payload.profile_id,
            cwd: payload.cwd,
            enabled,
            proactive,
            metadata_json: metadata,
            created_at: now,
            updated_at: now,
            archived_at: None,
        })
    }

    pub fn get_metric_definition(&self, id: &str) -> AppResult<Option<MetricDefinition>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.query_row(
            "SELECT id, name, slug, instructions, template_html, ttl_seconds, provider, model,
             profile_id, cwd, enabled, proactive, metadata_json, created_at, updated_at, archived_at
             FROM metric_definitions WHERE id = ?1",
            [id],
            parse_metric_definition_row,
        )
        .optional()
        .map_err(AppError::from)
    }

    pub fn get_metric_definition_by_slug(&self, slug: &str) -> AppResult<Option<MetricDefinition>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.query_row(
            "SELECT id, name, slug, instructions, template_html, ttl_seconds, provider, model,
             profile_id, cwd, enabled, proactive, metadata_json, created_at, updated_at, archived_at
             FROM metric_definitions WHERE slug = ?1",
            [slug],
            parse_metric_definition_row,
        )
        .optional()
        .map_err(AppError::from)
    }

    pub fn list_metric_definitions(&self, include_archived: bool) -> AppResult<Vec<MetricDefinition>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let query = if include_archived {
            "SELECT id, name, slug, instructions, template_html, ttl_seconds, provider, model,
             profile_id, cwd, enabled, proactive, metadata_json, created_at, updated_at, archived_at
             FROM metric_definitions ORDER BY name ASC"
        } else {
            "SELECT id, name, slug, instructions, template_html, ttl_seconds, provider, model,
             profile_id, cwd, enabled, proactive, metadata_json, created_at, updated_at, archived_at
             FROM metric_definitions WHERE archived_at IS NULL ORDER BY name ASC"
        };
        let mut stmt = conn.prepare(query)?;
        let rows = stmt.query_map([], parse_metric_definition_row)?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn archive_metric_definition(&self, id: &str) -> AppResult<bool> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let changed = conn.execute(
            "UPDATE metric_definitions SET archived_at = ?1, updated_at = ?1 WHERE id = ?2 AND archived_at IS NULL",
            params![now, id],
        )?;
        Ok(changed > 0)
    }

    pub fn delete_metric_definition(&self, id: &str) -> AppResult<bool> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let changed = conn.execute("DELETE FROM metric_definitions WHERE id = ?1", [id])?;
        Ok(changed > 0)
    }

    // ─── Metric Snapshots CRUD ──────────────────────────────────────────────

    pub fn insert_metric_snapshot(&self, metric_id: &str) -> AppResult<MetricSnapshot> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "INSERT INTO metric_snapshots (id, metric_id, status, created_at) VALUES (?1, ?2, 'pending', ?3)",
            params![id, metric_id, now.to_rfc3339()],
        )?;
        Ok(MetricSnapshot {
            id,
            metric_id: metric_id.to_string(),
            run_id: None,
            values_json: serde_json::json!({}),
            rendered_html: String::new(),
            status: MetricSnapshotStatus::Pending,
            error_message: None,
            created_at: now,
            completed_at: None,
        })
    }

    pub fn update_metric_snapshot_status(&self, id: &str, status: MetricSnapshotStatus) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "UPDATE metric_snapshots SET status = ?1 WHERE id = ?2",
            params![status.as_str(), id],
        )?;
        Ok(())
    }

    pub fn update_metric_snapshot_run_id(&self, id: &str, run_id: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "UPDATE metric_snapshots SET run_id = ?1, status = 'running' WHERE id = ?2",
            params![run_id, id],
        )?;
        Ok(())
    }

    pub fn complete_metric_snapshot(
        &self,
        id: &str,
        values_json: &serde_json::Value,
        rendered_html: &str,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "UPDATE metric_snapshots SET status='completed', values_json=?1, rendered_html=?2, completed_at=?3 WHERE id=?4",
            params![serde_json::to_string(values_json)?, rendered_html, now, id],
        )?;
        Ok(())
    }

    pub fn mark_metrics_invalidated_by_dependency(
        &self,
        source_metric_id: &str,
        metric_ids: &[String],
    ) -> AppResult<usize> {
        if metric_ids.is_empty() {
            return Ok(0);
        }
        let now = Utc::now().to_rfc3339();
        let mut conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let tx = conn.transaction()?;
        let mut affected = 0usize;
        for metric_id in metric_ids {
            affected += tx.execute(
                "INSERT INTO metric_dependency_invalidations (metric_id, source_metric_id, invalidated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(metric_id) DO UPDATE SET
                   source_metric_id = excluded.source_metric_id,
                   invalidated_at = excluded.invalidated_at",
                params![metric_id, source_metric_id, now],
            )?;
        }
        tx.commit()?;
        Ok(affected)
    }

    pub fn clear_metric_dependency_invalidation(&self, metric_id: &str) -> AppResult<bool> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let changed = conn.execute(
            "DELETE FROM metric_dependency_invalidations WHERE metric_id = ?1",
            [metric_id],
        )?;
        Ok(changed > 0)
    }

    pub fn fail_metric_snapshot(&self, id: &str, error_message: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "UPDATE metric_snapshots SET status='failed', error_message=?1, completed_at=?2 WHERE id=?3",
            params![error_message, now, id],
        )?;
        Ok(())
    }

    pub fn get_latest_snapshot(&self, metric_id: &str) -> AppResult<Option<MetricSnapshot>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.query_row(
            "SELECT id, metric_id, run_id, values_json, rendered_html, status, error_message, created_at, completed_at
             FROM metric_snapshots WHERE metric_id = ?1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1",
            [metric_id],
            parse_metric_snapshot_row,
        )
        .optional()
        .map_err(AppError::from)
    }

    pub fn get_snapshot(&self, id: &str) -> AppResult<Option<MetricSnapshot>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.query_row(
            "SELECT id, metric_id, run_id, values_json, rendered_html, status, error_message, created_at, completed_at
             FROM metric_snapshots WHERE id = ?1",
            [id],
            parse_metric_snapshot_row,
        )
        .optional()
        .map_err(AppError::from)
    }

    pub fn list_snapshots(&self, metric_id: &str, limit: u32) -> AppResult<Vec<MetricSnapshot>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, metric_id, run_id, values_json, rendered_html, status, error_message, created_at, completed_at
             FROM metric_snapshots WHERE metric_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![metric_id, limit], parse_metric_snapshot_row)?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn get_latest_inflight_snapshot_id(&self, metric_id: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.query_row(
            "SELECT id FROM metric_snapshots
             WHERE metric_id = ?1 AND status IN ('pending', 'running')
             ORDER BY created_at DESC
             LIMIT 1",
            [metric_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::from)
    }

    pub fn get_metric_diagnostics(&self, metric_id: &str) -> AppResult<MetricDiagnostics> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;

        // Aggregation stats from executed refresh runs only.
        // Seeded snapshots use run_id = NULL and should not be treated as timing baselines.
        let (total_runs, completed_runs, failed_runs, avg_dur, min_dur, max_dur): (i64, i64, i64, Option<f64>, Option<f64>, Option<f64>) = conn.query_row(
            "SELECT
                COUNT(1),
                COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0),
                AVG(CASE WHEN status = 'completed' AND completed_at IS NOT NULL
                    THEN (julianday(completed_at) - julianday(created_at)) * 86400.0 END),
                MIN(CASE WHEN status = 'completed' AND completed_at IS NOT NULL
                    THEN (julianday(completed_at) - julianday(created_at)) * 86400.0 END),
                MAX(CASE WHEN status = 'completed' AND completed_at IS NOT NULL
                    THEN (julianday(completed_at) - julianday(created_at)) * 86400.0 END)
             FROM metric_snapshots WHERE metric_id = ?1 AND run_id IS NOT NULL",
            [metric_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        )?;

        // Last completed snapshot duration + timestamp
        let last_completed: Option<(f64, String)> = conn.query_row(
            "SELECT (julianday(completed_at) - julianday(created_at)) * 86400.0, completed_at
             FROM metric_snapshots
             WHERE metric_id = ?1 AND run_id IS NOT NULL AND status = 'completed' AND completed_at IS NOT NULL
             ORDER BY completed_at DESC LIMIT 1",
            [metric_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional()?;

        // Most recent snapshot status
        let current_status: Option<String> = conn.query_row(
            "SELECT status FROM metric_snapshots WHERE metric_id = ?1 ORDER BY created_at DESC LIMIT 1",
            [metric_id],
            |row| row.get(0),
        ).optional()?;

        // Last error message
        let last_error: Option<String> = conn.query_row(
            "SELECT error_message FROM metric_snapshots
             WHERE metric_id = ?1 AND status = 'failed' AND error_message IS NOT NULL
             ORDER BY created_at DESC LIMIT 1",
            [metric_id],
            |row| row.get(0),
        ).optional()?;

        // Metric definition for TTL, provider, model
        let (ttl_seconds, provider, model): (i64, String, Option<String>) = conn.query_row(
            "SELECT ttl_seconds, provider, model FROM metric_definitions WHERE id = ?1",
            [metric_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(|_| AppError::NotFound(format!("metric definition {metric_id}")))?;

        let success_rate = if total_runs > 0 {
            (completed_runs as f64) / (total_runs as f64) * 100.0
        } else {
            0.0
        };

        let last_completed_at = last_completed.as_ref().map(|(_, ts)| ts.clone());
        let last_run_duration_secs = last_completed.map(|(dur, _)| dur);

        let next_refresh_at = last_completed_at.as_ref().map(|ts| {
            if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S") {
                let next = dt + chrono::Duration::seconds(ttl_seconds);
                next.format("%Y-%m-%d %H:%M:%S").to_string()
            } else {
                "unknown".to_string()
            }
        });

        Ok(MetricDiagnostics {
            metric_id: metric_id.to_string(),
            total_runs,
            completed_runs,
            failed_runs,
            success_rate,
            last_run_duration_secs,
            avg_run_duration_secs: avg_dur,
            min_run_duration_secs: min_dur,
            max_run_duration_secs: max_dur,
            ttl_seconds,
            provider,
            model,
            current_status,
            last_error,
            last_completed_at,
            next_refresh_at,
        })
    }

    pub fn find_snapshot_by_run_id(&self, run_id: &str) -> AppResult<Option<MetricSnapshot>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.query_row(
            "SELECT id, metric_id, run_id, values_json, rendered_html, status, error_message, created_at, completed_at
             FROM metric_snapshots WHERE run_id = ?1",
            [run_id],
            parse_metric_snapshot_row,
        )
        .optional()
        .map_err(AppError::from)
    }

    // ─── Screen Bindings CRUD ───────────────────────────────────────────────

    pub fn bind_metric_to_screen(&self, payload: &BindMetricToScreenPayload) -> AppResult<ScreenMetricBinding> {
        let id = Uuid::new_v4().to_string();
        let position = payload.position.unwrap_or(0);
        let layout_hint = payload.layout_hint.as_deref().unwrap_or("card");
        let grid_x = payload.grid_x.unwrap_or(-1);
        let grid_y = payload.grid_y.unwrap_or(-1);
        let grid_w = payload.grid_w.unwrap_or(4);
        let grid_h = payload.grid_h.unwrap_or(6);
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        conn.execute(
            "INSERT INTO screen_metrics (id, screen_id, metric_id, position, layout_hint, grid_x, grid_y, grid_w, grid_h)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, payload.screen_id, payload.metric_id, position, layout_hint, grid_x, grid_y, grid_w, grid_h],
        )?;
        Ok(ScreenMetricBinding {
            id,
            screen_id: payload.screen_id.clone(),
            metric_id: payload.metric_id.clone(),
            position,
            layout_hint: layout_hint.to_string(),
            grid_x,
            grid_y,
            grid_w,
            grid_h,
        })
    }

    pub fn unbind_metric_from_screen(&self, binding_id: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let screen_id: Option<String> = conn
            .query_row(
                "SELECT screen_id FROM screen_metrics WHERE id = ?1",
                [binding_id],
                |row| row.get(0),
            )
            .optional()?;
        conn.execute(
            "DELETE FROM screen_metrics WHERE id = ?1",
            [binding_id],
        )?;
        Ok(screen_id)
    }

    pub fn list_screen_metrics(&self, screen_id: &str) -> AppResult<Vec<ScreenMetricView>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT sm.id, sm.screen_id, sm.metric_id, sm.position, sm.layout_hint,
                    sm.grid_x, sm.grid_y, sm.grid_w, sm.grid_h,
                    md.id, md.name, md.slug, md.instructions, md.template_html, md.ttl_seconds,
                    md.provider, md.model, md.profile_id, md.cwd, md.enabled, md.proactive,
                    md.metadata_json, md.created_at, md.updated_at, md.archived_at
             FROM screen_metrics sm
             JOIN metric_definitions md ON md.id = sm.metric_id
             WHERE sm.screen_id = ?1
             ORDER BY sm.position ASC",
        )?;

        let mut views = Vec::new();
        let mut rows = stmt.query([screen_id])?;
        while let Some(row) = rows.next()? {
            let binding = ScreenMetricBinding {
                id: row.get(0)?,
                screen_id: row.get(1)?,
                metric_id: row.get(2)?,
                position: row.get(3)?,
                layout_hint: row.get(4)?,
                grid_x: row.get(5)?,
                grid_y: row.get(6)?,
                grid_w: row.get(7)?,
                grid_h: row.get(8)?,
            };
            let metric_id_str: String = row.get(9)?;
            let definition = MetricDefinition {
                id: metric_id_str.clone(),
                name: row.get(10)?,
                slug: row.get(11)?,
                instructions: row.get(12)?,
                template_html: row.get(13)?,
                ttl_seconds: row.get(14)?,
                provider: parse_provider(&row.get::<_, String>(15)?)?,
                model: row.get(16)?,
                profile_id: row.get(17)?,
                cwd: row.get(18)?,
                enabled: row.get::<_, i32>(19)? != 0,
                proactive: row.get::<_, i32>(20)? != 0,
                metadata_json: serde_json::from_str::<serde_json::Value>(&row.get::<_, String>(21)?)
                    .unwrap_or(serde_json::json!({})),
                created_at: parse_time(&row.get::<_, String>(22)?)?,
                updated_at: parse_time(&row.get::<_, String>(23)?)?,
                archived_at: row
                    .get::<_, Option<String>>(24)?
                    .map(|raw| parse_time(&raw))
                    .transpose()?,
            };

            // Fetch latest snapshot (completed or failed) so the UI can show errors.
            // Prefer the most recent completed snapshot; fall back to the most recent
            // failed one so the error state is surfaced in the card.
            let latest_snapshot: Option<MetricSnapshot> = {
                let mut snap_stmt = conn.prepare(
                    "SELECT id, metric_id, run_id, values_json, rendered_html, status, error_message, created_at, completed_at
                     FROM metric_snapshots WHERE metric_id = ?1 AND status IN ('completed', 'failed') ORDER BY created_at DESC LIMIT 1",
                )?;
                snap_stmt
                    .query_row([&metric_id_str], parse_metric_snapshot_row)
                    .optional()?
            };

            // Fetch the newest in-flight snapshot (pending/running) so the UI can
            // anchor elapsed refresh timers to the active run's real start time.
            let inflight_snapshot: Option<MetricSnapshot> = {
                let mut snap_stmt = conn.prepare(
                    "SELECT id, metric_id, run_id, values_json, rendered_html, status, error_message, created_at, completed_at
                     FROM metric_snapshots
                     WHERE metric_id = ?1 AND status IN ('pending', 'running')
                     ORDER BY created_at DESC
                     LIMIT 1",
                )?;
                snap_stmt
                    .query_row([&metric_id_str], parse_metric_snapshot_row)
                    .optional()?
            };
            let refresh_in_progress = inflight_snapshot.is_some();

            let is_stale = match &latest_snapshot {
                None => true,
                Some(snap) => {
                    if let Some(completed) = snap.completed_at {
                        let elapsed = Utc::now().signed_duration_since(completed).num_seconds();
                        elapsed >= definition.ttl_seconds
                    } else {
                        true
                    }
                }
            };

            views.push(ScreenMetricView {
                binding,
                definition,
                latest_snapshot,
                inflight_snapshot,
                is_stale,
                refresh_in_progress,
            });
        }

        Ok(views)
    }

    pub fn reorder_screen_metrics(&self, screen_id: &str, binding_ids: &[String]) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        for (i, binding_id) in binding_ids.iter().enumerate() {
            conn.execute(
                "UPDATE screen_metrics SET position = ?1 WHERE id = ?2 AND screen_id = ?3",
                params![i as i32, binding_id, screen_id],
            )?;
        }
        Ok(())
    }

    pub fn update_screen_metric_layouts(&self, screen_id: &str, layouts: &[ScreenMetricLayoutItem]) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        for item in layouts {
            conn.execute(
                "UPDATE screen_metrics SET grid_x = ?1, grid_y = ?2, grid_w = ?3, grid_h = ?4 WHERE id = ?5 AND screen_id = ?6",
                params![item.grid_x, item.grid_y, item.grid_w, item.grid_h, item.binding_id, screen_id],
            )?;
        }
        Ok(())
    }

    // ─── Staleness queries ──────────────────────────────────────────────────

    pub fn find_stale_metrics_for_screen(&self, screen_id: &str) -> AppResult<Vec<MetricDefinition>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT md.id, md.name, md.slug, md.instructions, md.template_html, md.ttl_seconds,
                    md.provider, md.model, md.profile_id, md.cwd, md.enabled, md.proactive,
                    md.metadata_json, md.created_at, md.updated_at, md.archived_at
             FROM screen_metrics sm
             JOIN metric_definitions md ON md.id = sm.metric_id
             WHERE sm.screen_id = ?1
               AND md.enabled = 1
               AND md.archived_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM metric_snapshots ms
                 WHERE ms.metric_id = md.id AND ms.status IN ('pending', 'running')
               )
               AND (
                 NOT EXISTS (
                   SELECT 1 FROM metric_snapshots ms2
                   WHERE ms2.metric_id = md.id AND ms2.status = 'completed'
                 )
                 OR (
                   SELECT MAX(ms3.completed_at) FROM metric_snapshots ms3
                   WHERE ms3.metric_id = md.id AND ms3.status = 'completed'
                 ) < datetime('now', '-' || md.ttl_seconds || ' seconds')
                 OR EXISTS (
                   SELECT 1 FROM metric_dependency_invalidations mdi
                   WHERE mdi.metric_id = md.id
                     AND julianday(mdi.invalidated_at) > COALESCE(
                       (
                         SELECT MAX(julianday(ms4.completed_at))
                         FROM metric_snapshots ms4
                         WHERE ms4.metric_id = md.id AND ms4.status = 'completed'
                       ),
                       -1
                     )
                 )
               )",
        )?;
        let rows = stmt.query_map([screen_id], parse_metric_definition_row)?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn find_proactive_stale_metrics(&self) -> AppResult<Vec<MetricDefinition>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT md.id, md.name, md.slug, md.instructions, md.template_html, md.ttl_seconds,
                    md.provider, md.model, md.profile_id, md.cwd, md.enabled, md.proactive,
                    md.metadata_json, md.created_at, md.updated_at, md.archived_at
             FROM metric_definitions md
             WHERE md.proactive = 1
               AND md.enabled = 1
               AND md.archived_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM metric_snapshots ms
                 WHERE ms.metric_id = md.id AND ms.status IN ('pending', 'running')
               )
               AND (
                 NOT EXISTS (
                   SELECT 1 FROM metric_snapshots ms2
                   WHERE ms2.metric_id = md.id AND ms2.status = 'completed'
                 )
                 OR (
                   SELECT MAX(ms3.completed_at) FROM metric_snapshots ms3
                   WHERE ms3.metric_id = md.id AND ms3.status = 'completed'
                 ) < datetime('now', '-' || md.ttl_seconds || ' seconds')
                 OR EXISTS (
                   SELECT 1 FROM metric_dependency_invalidations mdi
                   WHERE mdi.metric_id = md.id
                     AND julianday(mdi.invalidated_at) > COALESCE(
                       (
                         SELECT MAX(julianday(ms4.completed_at))
                         FROM metric_snapshots ms4
                         WHERE ms4.metric_id = md.id AND ms4.status = 'completed'
                       ),
                       -1
                     )
                 )
               )",
        )?;
        let rows = stmt.query_map([], parse_metric_definition_row)?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    fn ensure_default_settings(&self) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let count: i64 = conn.query_row("SELECT COUNT(1) FROM settings WHERE key = 'app'", [], |row| row.get(0))?;
        if count == 0 {
            conn.execute(
                "INSERT INTO settings (key, value_json, updated_at) VALUES ('app', ?1, ?2)",
                params![
                    serde_json::to_string(&AppSettings::default())?,
                    Utc::now().to_rfc3339()
                ],
            )?;
        }
        Ok(())
    }

    fn seed_default_metrics(&self) -> AppResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;

        // Check if trailing-30-day-leads already exists
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM metric_definitions WHERE slug = 'trailing-30-day-leads'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if exists {
            return Ok(());
        }

        let now = chrono::Utc::now().to_rfc3339();
        let metric_id = Uuid::new_v4().to_string();
        let snapshot_id = Uuid::new_v4().to_string();
        let binding_id = Uuid::new_v4().to_string();

        let instructions = r#"Retrieve all HubSpot leads and compute the trailing 30-day lead count measured weekly.

## Data Source
HubSpot Leads object via Kiingo MCP `hubspot.listLeads()`.

## Retrieval Steps
1. Paginate through ALL leads: call `hubspot.listLeads({ limit: 100, properties: ['createdate', 'hs_lead_name'], after })` in a loop until `paging.next.after` is absent.
2. Parse `createdate` from each lead's properties (fall back to `createdAt`). Sort ascending.
3. Compute trailing 30-day count for each week starting from the first full Sunday after the earliest lead:
   - For each week-ending date, count leads created in the 30-day window ending on that date.
4. Also compute: current trailing 30 count (from today), by-month breakdown, peak/trough/average.

## Narrative Context
- Steady state baseline is ~40-50 trailing leads (Oct-Nov 2025 was 45-52).
- Expect holiday dip mid-Dec through early Jan (Dec 2025-Jan 2026 bottomed at 22).
- Single-day spikes usually indicate campaigns or events.
- Always report: trailing window dates, whether current period is complete, current vs peak vs trough.

## Values to Return
- `trailing30`: current trailing 30-day count
- `peak`: highest weekly trailing 30 value and which week
- `trough`: lowest weekly trailing 30 value (excluding ramp-up) and which week
- `total`: total lead count
- `avgTrailing`: average trailing 30 across all weeks
- `weeklyData`: array of { weekOf, trailing30 } for the chart
- `byMonth`: object of month -> count"#;

        let template_jsx = r##"(() => {
  const data = DATA_PLACEHOLDER;
  const current = CURRENT_PLACEHOLDER;
  const peak = PEAK_PLACEHOLDER;
  const trough = TROUGH_PLACEHOLDER;
  const avgValue = AVG_PLACEHOLDER;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Current" value={current} subtitle="Trailing 30d" />
        <StatCard label="Peak" value={peak} subtitle="Best week" />
        <StatCard label="Trough" value={trough} subtitle="Lowest week" />
      </MetricRow>
      <div style={{ height: 320, background: theme.panel, borderRadius: 16, padding: 20, border: `1px solid ${theme.line}` }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="leadGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.gradientFrom} stopOpacity={0.3} />
                <stop offset="100%" stopColor={theme.gradientFrom} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="week" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} interval={2} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} domain={[0, 'auto']} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <ReferenceLine y={avgValue} stroke={theme.line} strokeDasharray="6 4" />
            <Area type="monotone" dataKey="value" stroke={theme.accent} strokeWidth={2.5} fill="url(#leadGradient)" dot={{ fill: theme.accent, r: 3, strokeWidth: 0 }} activeDot={{ fill: theme.accentStrong, r: 5, strokeWidth: 2, stroke: theme.line }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Each point = trailing 30-day leads · Source: HubSpot CRM via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()"##;

        // Initial snapshot with real data from Feb 14, 2026
        let initial_values = r#"{"trailing30":90,"peak":70,"peakWeek":"2026-02-08","trough":22,"troughWeek":"2026-01-11","total":247,"avgTrailing":39,"weeklyData":[{"weekOf":"2025-09-21","trailing30":2},{"weekOf":"2025-09-28","trailing30":13},{"weekOf":"2025-10-05","trailing30":20},{"weekOf":"2025-10-12","trailing30":32},{"weekOf":"2025-10-19","trailing30":45},{"weekOf":"2025-10-26","trailing30":44},{"weekOf":"2025-11-02","trailing30":49},{"weekOf":"2025-11-09","trailing30":48},{"weekOf":"2025-11-16","trailing30":44},{"weekOf":"2025-11-23","trailing30":52},{"weekOf":"2025-11-30","trailing30":45},{"weekOf":"2025-12-07","trailing30":42},{"weekOf":"2025-12-14","trailing30":41},{"weekOf":"2025-12-21","trailing30":35},{"weekOf":"2025-12-28","trailing30":32},{"weekOf":"2026-01-04","trailing30":23},{"weekOf":"2026-01-11","trailing30":22},{"weekOf":"2026-01-18","trailing30":38},{"weekOf":"2026-01-25","trailing30":53},{"weekOf":"2026-02-01","trailing30":65},{"weekOf":"2026-02-08","trailing30":70}],"byMonth":{"2025-09":13,"2025-10":54,"2025-11":45,"2025-12":33,"2026-01":65,"2026-02":37}}"#;

        let initial_html = r##"(() => {
  const data = [{ week: "Sep 21", value: 2 }, { week: "Sep 28", value: 13 }, { week: "Oct 5", value: 20 }, { week: "Oct 12", value: 32 }, { week: "Oct 19", value: 45 }, { week: "Oct 26", value: 44 }, { week: "Nov 2", value: 49 }, { week: "Nov 9", value: 48 }, { week: "Nov 16", value: 44 }, { week: "Nov 23", value: 52 }, { week: "Nov 30", value: 45 }, { week: "Dec 7", value: 42 }, { week: "Dec 14", value: 41 }, { week: "Dec 21", value: 35 }, { week: "Dec 28", value: 32 }, { week: "Jan 4", value: 23 }, { week: "Jan 11", value: 22 }, { week: "Jan 18", value: 38 }, { week: "Jan 25", value: 53 }, { week: "Feb 1", value: 65 }, { week: "Feb 8", value: 70 }];
  const current = 90;
  const peak = 70;
  const trough = 22;
  const avgValue = 39;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Current" value={current} subtitle="Trailing 30d" />
        <StatCard label="Peak" value={peak} subtitle="Best week" />
        <StatCard label="Trough" value={trough} subtitle="Lowest week" />
      </MetricRow>
      <div style={{ height: 320, background: theme.panel, borderRadius: 16, padding: 20, border: `1px solid ${theme.line}` }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="leadGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.gradientFrom} stopOpacity={0.3} />
                <stop offset="100%" stopColor={theme.gradientFrom} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="week" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} interval={2} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} domain={[0, 'auto']} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <ReferenceLine y={avgValue} stroke={theme.line} strokeDasharray="6 4" />
            <Area type="monotone" dataKey="value" stroke={theme.accent} strokeWidth={2.5} fill="url(#leadGradient)" dot={{ fill: theme.accent, r: 3, strokeWidth: 0 }} activeDot={{ fill: theme.accentStrong, r: 5, strokeWidth: 2, stroke: theme.line }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Each point = trailing 30-day leads · Source: HubSpot CRM via Kiingo MCP · Snapshot: Feb 14, 2026</MetricNote>
    </MetricSection>
  );
})()"##;

        // Insert metric definition
        conn.execute(
            "INSERT INTO metric_definitions (id, name, slug, instructions, template_html,
             ttl_seconds, provider, enabled, proactive, metadata_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![
                metric_id,
                "Trailing 30-Day Leads",
                "trailing-30-day-leads",
                instructions,
                template_jsx,
                3600, // 1 hour TTL
                "claude",
                1,    // enabled
                0,    // not proactive by default
                "{}",
                now,
            ],
        )?;

        // Insert initial completed snapshot with real data
        conn.execute(
            "INSERT INTO metric_snapshots (id, metric_id, values_json, rendered_html, status, created_at, completed_at)
             VALUES (?1, ?2, ?3, ?4, 'completed', ?5, ?5)",
            params![
                snapshot_id,
                metric_id,
                initial_values,
                initial_html,
                now,
            ],
        )?;

        // Bind to dashboard screen as a full-width card
        conn.execute(
            "INSERT INTO screen_metrics (id, screen_id, metric_id, position, layout_hint, grid_x, grid_y, grid_w, grid_h)
             VALUES (?1, ?2, ?3, 0, 'full', -1, -1, 12, 8)",
            params![binding_id, "dashboard", metric_id],
        )?;

        Ok(())
    }

    fn seed_revenue_metrics(&self) -> AppResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;

        // Guard: skip if any revenue metric already exists
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM metric_definitions WHERE slug = 'monthly-revenue'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if exists {
            return Ok(());
        }

        let now = chrono::Utc::now().to_rfc3339();

        // ─── Helper: insert one metric + snapshot + binding ───────────────
        struct MetricSeed<'a> {
            slug: &'a str,
            name: &'a str,
            instructions: &'a str,
            template_jsx: &'a str,
            initial_values: &'a str,
            initial_html: &'a str,
            ttl: i32,
            layout_hint: &'a str,
            grid_w: i32,
            grid_h: i32,
            grid_y: i32,
        }

        let seeds = vec![
            // ═══════════════════════════════════════════════════════════════
            // 1. Monthly Revenue Invoiced
            // ═══════════════════════════════════════════════════════════════
            MetricSeed {
                slug: "monthly-revenue",
                name: "Monthly Revenue Invoiced",
                instructions: r#"Retrieve monthly invoiced revenue from QuickBooks invoices.

## Data Source
QuickBooks Online Invoices via Kiingo MCP `quickbooks.query()`.

## Retrieval Steps
1. Query all invoices for the trailing 12 months:
   `quickbooks.query({ query: "SELECT TxnDate, TotalAmt, Balance FROM Invoice WHERE TxnDate >= '<12 months ago, 1st of month>' AND TxnDate <= '<last day of current month>' ORDERBY TxnDate", maxResults: 1000 })`.
2. Group invoices by month (from TxnDate). For each month compute:
   - `invoiced`: sum of TotalAmt (total invoiced)
   - `collected`: sum of (TotalAmt - Balance) (amount already paid)
   - `count`: number of invoices
3. Build monthly data array with { month (short label e.g. "Mar 25"), invoiced, collected, count }.
4. Compute currentMonth, priorMonth, and ltmTotal from the invoiced amounts.

## Narrative Context
- This metric tracks invoiced revenue (what was billed), not P&L recognized revenue.
- The difference between invoiced and collected shows outstanding AR aging.
- A large gap between invoiced and collected in recent months is normal; older months should be mostly collected.

## Values to Return
- `monthlyData`: array of { month, invoiced, collected, count }
- `currentMonth`: invoiced total for current (partial) month
- `priorMonth`: invoiced total for prior full month
- `ltmTotal`: sum of all 12 months invoiced"#,
                template_jsx: r##"(() => {
  const data = DATA_PLACEHOLDER;
  const currentMonth = CURRENT_MONTH_PLACEHOLDER;
  const priorMonth = PRIOR_MONTH_PLACEHOLDER;
  const ltmTotal = LTM_PLACEHOLDER;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="This Month" value={'$' + (currentMonth / 1000).toFixed(0) + 'K'} subtitle="Invoiced" />
        <StatCard label="Last Month" value={'$' + (priorMonth / 1000).toFixed(0) + 'K'} subtitle="Invoiced" />
        <StatCard label="LTM Invoiced" value={'$' + (ltmTotal / 1000).toFixed(0) + 'K'} subtitle="Last 12 months" />
      </MetricRow>
      <div style={{ height: 320, background: theme.panel, borderRadius: 16, padding: 20, border: `1px solid ${theme.line}` }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v / 1000) + 'K'} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => '$' + Number(v).toLocaleString()} />
            <Line type="monotone" dataKey="invoiced" name="Invoiced" stroke={theme.accent} strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="collected" name="Collected" stroke={theme.accentStrong} strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: QuickBooks Invoices via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()"##,
                initial_values: r#"{"currentMonth":152193,"priorMonth":209568,"ltmTotal":1925712,"monthlyData":[{"month":"Mar 25","invoiced":190174,"collected":190174,"count":66},{"month":"Apr 25","invoiced":106283,"collected":106283,"count":62},{"month":"May 25","invoiced":125354,"collected":125354,"count":34},{"month":"Jun 25","invoiced":139671,"collected":139671,"count":61},{"month":"Jul 25","invoiced":98864,"collected":98864,"count":48},{"month":"Aug 25","invoiced":114698,"collected":114698,"count":51},{"month":"Sep 25","invoiced":263725,"collected":263725,"count":56},{"month":"Oct 25","invoiced":197685,"collected":197685,"count":48},{"month":"Nov 25","invoiced":206919,"collected":201269,"count":48},{"month":"Dec 25","invoiced":120579,"collected":115088,"count":60},{"month":"Jan 26","invoiced":209568,"collected":127830,"count":57},{"month":"Feb 26","invoiced":152193,"collected":39157,"count":25}]}"#,
                initial_html: r##"(() => {
  const data = [{"month":"Mar 25","invoiced":190174,"collected":190174,"count":66},{"month":"Apr 25","invoiced":106283,"collected":106283,"count":62},{"month":"May 25","invoiced":125354,"collected":125354,"count":34},{"month":"Jun 25","invoiced":139671,"collected":139671,"count":61},{"month":"Jul 25","invoiced":98864,"collected":98864,"count":48},{"month":"Aug 25","invoiced":114698,"collected":114698,"count":51},{"month":"Sep 25","invoiced":263725,"collected":263725,"count":56},{"month":"Oct 25","invoiced":197685,"collected":197685,"count":48},{"month":"Nov 25","invoiced":206919,"collected":201269,"count":48},{"month":"Dec 25","invoiced":120579,"collected":115088,"count":60},{"month":"Jan 26","invoiced":209568,"collected":127830,"count":57},{"month":"Feb 26","invoiced":152193,"collected":39157,"count":25}];
  const currentMonth = 152193;
  const priorMonth = 209568;
  const ltmTotal = 1925712;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="This Month" value={'$' + (currentMonth / 1000).toFixed(0) + 'K'} subtitle="Invoiced" />
        <StatCard label="Last Month" value={'$' + (priorMonth / 1000).toFixed(0) + 'K'} subtitle="Invoiced" />
        <StatCard label="LTM Invoiced" value={'$' + (ltmTotal / 1000).toFixed(0) + 'K'} subtitle="Last 12 months" />
      </MetricRow>
      <div style={{ height: 320, background: theme.panel, borderRadius: 16, padding: 20, border: `1px solid ${theme.line}` }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v / 1000) + 'K'} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => '$' + Number(v).toLocaleString()} />
            <Line type="monotone" dataKey="invoiced" name="Invoiced" stroke={theme.accent} strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="collected" name="Collected" stroke={theme.accentStrong} strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: QuickBooks Invoices via Kiingo MCP · Snapshot: Feb 14, 2026</MetricNote>
    </MetricSection>
  );
})()"##,
                ttl: 86400,
                layout_hint: "full",
                grid_w: 12,
                grid_h: 8,
                grid_y: 0,
            },

            // ═══════════════════════════════════════════════════════════════
            // 2. Monthly Net Income
            // ═══════════════════════════════════════════════════════════════
            MetricSeed {
                slug: "monthly-net-income",
                name: "Monthly Net Income",
                instructions: r#"Retrieve monthly net income from QuickBooks P&L.

## Data Source
QuickBooks Online P&L via Kiingo MCP `quickbooks.profitAndLoss()`.

## Retrieval Steps
1. Call `quickbooks.profitAndLoss({ params: { start_date: '<12 months ago, 1st of month>', end_date: '<last day of current month>', summarize_column_by: 'Month' } })`.
2. Parse the Rows tree. Extract "Net Income" row for each month column.
3. Also extract "Gross Profit" and "Total Expenses" for context.
4. Compute trailing 3-month average of net income.

## Values to Return
- `monthlyData`: array of { month (short label), netIncome, grossProfit, expenses }
- `currentMonth`: net income for current (partial) month
- `priorMonth`: net income for prior full month
- `trailing3Avg`: average net income for last 3 full months
- `ltmTotal`: sum of last 12 months net income"#,
                template_jsx: r##"(() => {
  const data = DATA_PLACEHOLDER;
  const currentMonth = CURRENT_MONTH_PLACEHOLDER;
  const trailing3Avg = TRAILING3_PLACEHOLDER;
  const ltmTotal = LTM_PLACEHOLDER;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="This Month" value={'$' + (currentMonth / 1000).toFixed(0) + 'K'} subtitle="In progress" />
        <StatCard label="3-Mo Avg" value={'$' + (trailing3Avg / 1000).toFixed(0) + 'K'} subtitle="Trailing avg" />
        <StatCard label="LTM Net Income" value={'$' + (ltmTotal / 1000).toFixed(0) + 'K'} subtitle="Last 12 months" />
      </MetricRow>
      <div style={{ height: 320, background: theme.panel, borderRadius: 16, padding: 20, border: `1px solid ${theme.line}` }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="niGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.gradientFrom} stopOpacity={0.3} />
                <stop offset="100%" stopColor={theme.gradientFrom} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v / 1000) + 'K'} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => '$' + Number(v).toLocaleString()} />
            <ReferenceLine y={0} stroke={theme.danger} strokeWidth={1.5} />
            <Area type="monotone" dataKey="netIncome" name="Net Income" stroke={theme.accent} strokeWidth={2.5} fill="url(#niGrad)" dot={{ fill: theme.accent, r: 3, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: QuickBooks P&L (Accrual) via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()"##,
                initial_values: r#"{"currentMonth":-56498,"priorMonth":9749,"trailing3Avg":-18821,"ltmTotal":637991,"monthlyData":[{"month":"Mar 25","netIncome":133329},{"month":"Apr 25","netIncome":34326},{"month":"May 25","netIncome":58996},{"month":"Jun 25","netIncome":62925},{"month":"Jul 25","netIncome":18712},{"month":"Aug 25","netIncome":25139},{"month":"Sep 25","netIncome":161054},{"month":"Oct 25","netIncome":99890},{"month":"Nov 25","netIncome":100082},{"month":"Dec 25","netIncome":-9713},{"month":"Jan 26","netIncome":9749},{"month":"Feb 26","netIncome":-56498}]}"#,
                initial_html: r##"(() => {
  const data = [{"month":"Mar 25","netIncome":133329},{"month":"Apr 25","netIncome":34326},{"month":"May 25","netIncome":58996},{"month":"Jun 25","netIncome":62925},{"month":"Jul 25","netIncome":18712},{"month":"Aug 25","netIncome":25139},{"month":"Sep 25","netIncome":161054},{"month":"Oct 25","netIncome":99890},{"month":"Nov 25","netIncome":100082},{"month":"Dec 25","netIncome":-9713},{"month":"Jan 26","netIncome":9749},{"month":"Feb 26","netIncome":-56498}];
  const currentMonth = -56498;
  const trailing3Avg = -18821;
  const ltmTotal = 637991;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="This Month" value={'$' + (currentMonth / 1000).toFixed(0) + 'K'} subtitle="In progress" />
        <StatCard label="3-Mo Avg" value={'$' + (trailing3Avg / 1000).toFixed(0) + 'K'} subtitle="Trailing avg" />
        <StatCard label="LTM Net Income" value={'$' + (ltmTotal / 1000).toFixed(0) + 'K'} subtitle="Last 12 months" />
      </MetricRow>
      <div style={{ height: 320, background: theme.panel, borderRadius: 16, padding: 20, border: `1px solid ${theme.line}` }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="niGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.gradientFrom} stopOpacity={0.3} />
                <stop offset="100%" stopColor={theme.gradientFrom} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v / 1000) + 'K'} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => '$' + Number(v).toLocaleString()} />
            <ReferenceLine y={0} stroke={theme.danger} strokeWidth={1.5} />
            <Area type="monotone" dataKey="netIncome" name="Net Income" stroke={theme.accent} strokeWidth={2.5} fill="url(#niGrad)" dot={{ fill: theme.accent, r: 3, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: QuickBooks P&L (Accrual) via Kiingo MCP · Snapshot: Feb 14, 2026</MetricNote>
    </MetricSection>
  );
})()"##,
                ttl: 86400,
                layout_hint: "full",
                grid_w: 12,
                grid_h: 8,
                grid_y: 9,
            },

            // ═══════════════════════════════════════════════════════════════
            // 3. Sales Pipeline Value
            // ═══════════════════════════════════════════════════════════════
            MetricSeed {
                slug: "sales-pipeline-value",
                name: "Sales Pipeline Value",
                instructions: r#"Retrieve open deal pipeline from HubSpot and display by stage.

## Data Source
HubSpot Deals via Kiingo MCP `hubspot.listDeals()`.

## Retrieval Steps
1. Paginate through ALL deals: `hubspot.listDeals({ limit: 100, properties: ['dealname', 'amount', 'dealstage', 'pipeline', 'closedate', 'hs_deal_stage_probability', 'hs_is_closed_won', 'hs_is_closed'], after })`.
2. Filter to open deals (hs_is_closed !== 'true') in sales pipelines: 'default' (New Business), '798580396' (Upsells), '796136972' (Partnership).
3. Group by stage. For each stage, compute count, total amount, and weighted amount (amount * hs_deal_stage_probability).
4. Also compute closing-this-month and closing-next-month totals by checking closedate.
5. Map stage IDs to labels: 161270894 = "Proposal Sent", appointmentscheduled = "Discovery Call", 161298562 = "On Hold", 1166399563 = "Cold", 1172014718 = "Outreach (Upsell)", 1172014719 = "Proposal (Upsell)", 1172014717 = "Discovery (Upsell)".

## Values to Return
- `totalUnweighted`: total open pipeline value
- `totalWeighted`: probability-weighted pipeline value
- `dealCount`: number of open deals
- `closingThisMonth`: value of deals closing this month
- `closingNextMonth`: value of deals closing next month
- `byStage`: array of { stage (label), count, amount, weighted } sorted by amount desc"#,
                template_jsx: r##"(() => {
  const data = DATA_PLACEHOLDER;
  const totalUnweighted = UNWEIGHTED_PLACEHOLDER;
  const totalWeighted = WEIGHTED_PLACEHOLDER;
  const dealCount = COUNT_PLACEHOLDER;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Open Pipeline" value={'$' + (totalUnweighted / 1000).toFixed(0) + 'K'} subtitle={dealCount + ' deals'} />
        <StatCard label="Weighted" value={'$' + (totalWeighted / 1000).toFixed(0) + 'K'} subtitle="Probability-adjusted" />
      </MetricRow>
      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: 20, border: `1px solid ${theme.line}` }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 100, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} horizontal={false} />
            <XAxis type="number" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v / 1000) + 'K'} />
            <YAxis type="category" dataKey="stage" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} width={95} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => '$' + Number(v).toLocaleString()} />
            <Bar dataKey="amount" name="Pipeline Value" fill={theme.accent} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Open sales deals (New Business + Upsells + Partnership) · Source: HubSpot CRM via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()"##,
                initial_values: r#"{"totalUnweighted":1070629,"totalWeighted":370078,"dealCount":264,"closingThisMonth":269394,"closingNextMonth":228249,"byStage":[{"stage":"Proposal Sent","count":80,"amount":533690,"weighted":266845},{"stage":"On Hold","count":71,"amount":370747,"weighted":37075},{"stage":"Proposal (Upsell)","count":17,"amount":106998,"weighted":53499},{"stage":"Discovery Call","count":24,"amount":32850,"weighted":9855},{"stage":"Outreach (Upsell)","count":27,"amount":7298,"weighted":730},{"stage":"Cold (Upsell)","count":9,"amount":11498,"weighted":1150}]}"#,
                initial_html: r##"(() => {
  const data = [{"stage":"Proposal Sent","count":80,"amount":533690,"weighted":266845},{"stage":"On Hold","count":71,"amount":370747,"weighted":37075},{"stage":"Proposal (Upsell)","count":17,"amount":106998,"weighted":53499},{"stage":"Discovery Call","count":24,"amount":32850,"weighted":9855},{"stage":"Cold (Upsell)","count":9,"amount":11498,"weighted":1150},{"stage":"Outreach (Upsell)","count":27,"amount":7298,"weighted":730}];
  const totalUnweighted = 1070629;
  const totalWeighted = 370078;
  const dealCount = 264;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Open Pipeline" value={'$' + (totalUnweighted / 1000).toFixed(0) + 'K'} subtitle={dealCount + ' deals'} />
        <StatCard label="Weighted" value={'$' + (totalWeighted / 1000).toFixed(0) + 'K'} subtitle="Probability-adjusted" />
      </MetricRow>
      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: 20, border: `1px solid ${theme.line}` }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 100, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} horizontal={false} />
            <XAxis type="number" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v / 1000) + 'K'} />
            <YAxis type="category" dataKey="stage" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} width={95} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => '$' + Number(v).toLocaleString()} />
            <Bar dataKey="amount" name="Pipeline Value" fill={theme.accent} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Open sales deals (New Business + Upsells + Partnership) · Source: HubSpot CRM via Kiingo MCP · Snapshot: Feb 14, 2026</MetricNote>
    </MetricSection>
  );
})()"##,
                ttl: 3600,
                layout_hint: "wide",
                grid_w: 6,
                grid_h: 8,
                grid_y: 18,
            },

            // ═══════════════════════════════════════════════════════════════
            // 4. Closed Won Revenue by Month
            // ═══════════════════════════════════════════════════════════════
            MetricSeed {
                slug: "closed-won-monthly",
                name: "Closed Won Revenue by Month",
                instructions: r#"Retrieve closed-won deals from HubSpot and display revenue by month.

## Data Source
HubSpot Deals via Kiingo MCP `hubspot.listDeals()`.

## Retrieval Steps
1. Paginate through ALL deals with `hubspot.listDeals({ limit: 100, properties: ['amount', 'closedate', 'pipeline', 'hs_is_closed_won'], after })`.
2. Filter to closed-won deals (hs_is_closed_won === 'true').
3. Group by close-date month. Sum amounts per month.
4. Compute current month total, best month, trailing average.

## Values to Return
- `monthlyData`: array of { month (short label), amount, count }
- `currentMonth`: amount closed this month
- `bestMonth`: { month, amount } - highest revenue month
- `trailingAvg`: average monthly closed-won over all months with data
- `totalWon`: total closed-won amount"#,
                template_jsx: r##"(() => {
  const data = DATA_PLACEHOLDER;
  const currentMonth = CURRENT_PLACEHOLDER;
  const bestMonth = BEST_PLACEHOLDER;
  const trailingAvg = AVG_PLACEHOLDER;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="This Month" value={'$' + (currentMonth / 1000).toFixed(0) + 'K'} subtitle="Closed won" />
        <StatCard label="Best Month" value={'$' + (bestMonth / 1000).toFixed(0) + 'K'} subtitle="Peak" />
        <StatCard label="Monthly Avg" value={'$' + (trailingAvg / 1000).toFixed(0) + 'K'} subtitle="Average" />
      </MetricRow>
      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: 20, border: `1px solid ${theme.line}` }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v / 1000) + 'K'} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => '$' + Number(v).toLocaleString()} />
            <ReferenceLine y={trailingAvg} stroke={theme.line} strokeDasharray="6 4" />
            <Bar dataKey="amount" name="Closed Won" fill={theme.accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>HubSpot closed-won deals across all sales pipelines · Source: HubSpot CRM via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()"##,
                initial_values: r#"{"currentMonth":130899,"bestMonth":369676,"trailingAvg":173524,"totalWon":1567217,"monthlyData":[{"month":"Jun 25","amount":19420,"count":6},{"month":"Jul 25","amount":25387,"count":10},{"month":"Aug 25","amount":106600,"count":34},{"month":"Sep 25","amount":212700,"count":39},{"month":"Oct 25","amount":369676,"count":117},{"month":"Nov 25","amount":247744,"count":63},{"month":"Dec 25","amount":152094,"count":61},{"month":"Jan 26","amount":299297,"count":53},{"month":"Feb 26","amount":130899,"count":28}]}"#,
                initial_html: r##"(() => {
  const data = [{"month":"Jun 25","amount":19420,"count":6},{"month":"Jul 25","amount":25387,"count":10},{"month":"Aug 25","amount":106600,"count":34},{"month":"Sep 25","amount":212700,"count":39},{"month":"Oct 25","amount":369676,"count":117},{"month":"Nov 25","amount":247744,"count":63},{"month":"Dec 25","amount":152094,"count":61},{"month":"Jan 26","amount":299297,"count":53},{"month":"Feb 26","amount":130899,"count":28}];
  const currentMonth = 130899;
  const bestMonth = 369676;
  const trailingAvg = 173524;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="This Month" value={'$' + (currentMonth / 1000).toFixed(0) + 'K'} subtitle="Closed won" />
        <StatCard label="Best Month" value={'$' + (bestMonth / 1000).toFixed(0) + 'K'} subtitle="Peak" />
        <StatCard label="Monthly Avg" value={'$' + (trailingAvg / 1000).toFixed(0) + 'K'} subtitle="Average" />
      </MetricRow>
      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: 20, border: `1px solid ${theme.line}` }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v / 1000) + 'K'} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => '$' + Number(v).toLocaleString()} />
            <ReferenceLine y={trailingAvg} stroke={theme.line} strokeDasharray="6 4" />
            <Bar dataKey="amount" name="Closed Won" fill={theme.accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>HubSpot closed-won deals across all sales pipelines · Source: HubSpot CRM via Kiingo MCP · Snapshot: Feb 14, 2026</MetricNote>
    </MetricSection>
  );
})()"##,
                ttl: 3600,
                layout_hint: "wide",
                grid_w: 6,
                grid_h: 8,
                grid_y: 18,
            },

            // ═══════════════════════════════════════════════════════════════
            // 5. Cash Position & AR
            // ═══════════════════════════════════════════════════════════════
            MetricSeed {
                slug: "cash-position-ar",
                name: "Cash Position & AR",
                instructions: r#"Retrieve current cash position and accounts receivable from QuickBooks, with cash flow split by operating vs financing activities.

## Data Source
QuickBooks Online via Kiingo MCP `quickbooks.balanceSheet()` and `quickbooks.cashFlow()`.

## Retrieval Steps
1. Call `quickbooks.balanceSheet({ params: { start_date: '<1st of current month>', end_date: '<today>' } })`.
2. Parse the Rows tree. Find "Total Bank Accounts" for cash and "Total Accounts Receivable" for AR.
3. Call `quickbooks.cashFlow({ params: { start_date: '<6 months ago>', end_date: '<last day of current month>', summarize_column_by: 'Month' } })`.
4. For each month column, extract:
   - "Net cash provided by operating activities" → `operating`
   - "Net cash provided by financing activities" → `financing`
   - "Net cash increase for period" → `net`

## Values to Return
- `cash`: current cash balance
- `ar`: current accounts receivable
- `totalLiquid`: cash + AR
- `cashFlowByMonth`: array of { month, operating, financing, net } for last 6 months"#,
                template_jsx: r##"(() => {
  const cash = CASH_PLACEHOLDER;
  const ar = AR_PLACEHOLDER;
  const totalLiquid = TOTAL_PLACEHOLDER;
  const data = DATA_PLACEHOLDER;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Cash" value={'$' + (cash / 1000).toFixed(0) + 'K'} subtitle="Bank accounts" />
        <StatCard label="Receivables" value={'$' + (ar / 1000).toFixed(0) + 'K'} subtitle="Accounts receivable" />
        <StatCard label="Total Liquid" value={'$' + (totalLiquid / 1000).toFixed(0) + 'K'} subtitle="Cash + AR" />
      </MetricRow>
      <div style={{ height: 220, background: theme.panel, borderRadius: 16, padding: 20, border: `1px solid ${theme.line}` }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v / 1000) + 'K'} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => '$' + Number(v).toLocaleString()} />
            <Legend wrapperStyle={{ fontSize: 11, color: theme.inkMuted }} />
            <ReferenceLine y={0} stroke={theme.inkMuted} strokeWidth={1} strokeDasharray="3 3" />
            <Bar dataKey="operating" name="Operating" fill={theme.accent} radius={[4, 4, 0, 0]} />
            <Bar dataKey="financing" name="Financing" fill={theme.danger} radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="net" name="Net" stroke={theme.inkMuted} strokeWidth={2} dot={{ r: 3, fill: theme.inkMuted }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: QuickBooks Balance Sheet + Cash Flow via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()"##,
                initial_values: r#"{"cash":283681,"ar":187987,"totalLiquid":471668,"cashFlowByMonth":[{"month":"Sep 25","operating":66097,"financing":-63000,"net":3097},{"month":"Oct 25","operating":76407,"financing":0,"net":76407},{"month":"Nov 25","operating":97239,"financing":0,"net":97239},{"month":"Dec 25","operating":92473,"financing":-233037,"net":-140564},{"month":"Jan 26","operating":5786,"financing":0,"net":5786},{"month":"Feb 26","operating":33695,"financing":0,"net":33695}]}"#,
                initial_html: r##"(() => {
  const cash = 283681;
  const ar = 187987;
  const totalLiquid = 471668;
  const data = [{"month":"Sep 25","operating":66097,"financing":-63000,"net":3097},{"month":"Oct 25","operating":76407,"financing":0,"net":76407},{"month":"Nov 25","operating":97239,"financing":0,"net":97239},{"month":"Dec 25","operating":92473,"financing":-233037,"net":-140564},{"month":"Jan 26","operating":5786,"financing":0,"net":5786},{"month":"Feb 26","operating":33695,"financing":0,"net":33695}];

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Cash" value={'$' + (cash / 1000).toFixed(0) + 'K'} subtitle="Bank accounts" />
        <StatCard label="Receivables" value={'$' + (ar / 1000).toFixed(0) + 'K'} subtitle="Accounts receivable" />
        <StatCard label="Total Liquid" value={'$' + (totalLiquid / 1000).toFixed(0) + 'K'} subtitle="Cash + AR" />
      </MetricRow>
      <div style={{ height: 220, background: theme.panel, borderRadius: 16, padding: 20, border: `1px solid ${theme.line}` }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v / 1000) + 'K'} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => '$' + Number(v).toLocaleString()} />
            <Legend wrapperStyle={{ fontSize: 11, color: theme.inkMuted }} />
            <ReferenceLine y={0} stroke={theme.inkMuted} strokeWidth={1} strokeDasharray="3 3" />
            <Bar dataKey="operating" name="Operating" fill={theme.accent} radius={[4, 4, 0, 0]} />
            <Bar dataKey="financing" name="Financing" fill={theme.danger} radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="net" name="Net" stroke={theme.inkMuted} strokeWidth={2} dot={{ r: 3, fill: theme.inkMuted }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: QuickBooks Balance Sheet + Cash Flow via Kiingo MCP · Snapshot: Feb 14, 2026</MetricNote>
    </MetricSection>
  );
})()"##,
                ttl: 86400,
                layout_hint: "full",
                grid_w: 12,
                grid_h: 7,
                grid_y: 27,
            },
        ];

        for (pos, seed) in seeds.iter().enumerate() {
            let metric_id = Uuid::new_v4().to_string();
            let snapshot_id = Uuid::new_v4().to_string();
            let binding_id = Uuid::new_v4().to_string();

            conn.execute(
                "INSERT INTO metric_definitions (id, name, slug, instructions, template_html,
                 ttl_seconds, provider, enabled, proactive, metadata_json, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
                params![
                    metric_id,
                    seed.name,
                    seed.slug,
                    seed.instructions,
                    seed.template_jsx,
                    seed.ttl,
                    "claude",
                    1,    // enabled
                    0,    // not proactive
                    "{}",
                    now,
                ],
            )?;

            conn.execute(
                "INSERT INTO metric_snapshots (id, metric_id, values_json, rendered_html, status, created_at, completed_at)
                 VALUES (?1, ?2, ?3, ?4, 'completed', ?5, ?5)",
                params![
                    snapshot_id,
                    metric_id,
                    seed.initial_values,
                    seed.initial_html,
                    now,
                ],
            )?;

            conn.execute(
                "INSERT INTO screen_metrics (id, screen_id, metric_id, position, layout_hint, grid_x, grid_y, grid_w, grid_h)
                 VALUES (?1, 'revenue', ?2, ?3, ?4, -1, ?5, ?6, ?7)",
                params![
                    binding_id,
                    metric_id,
                    pos as i32,
                    seed.layout_hint,
                    seed.grid_y,
                    seed.grid_w,
                    seed.grid_h,
                ],
            )?;
        }

        Ok(())
    }

    fn ensure_schema_extensions(&self) -> AppResult<()> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;

        conn.execute_batch("PRAGMA foreign_keys = ON;")?;

        if !column_exists(&conn, "runs", "profile_id")? {
            conn.execute("ALTER TABLE runs ADD COLUMN profile_id TEXT", [])?;
        }
        if !column_exists(&conn, "runs", "capability_snapshot_id")? {
            conn.execute(
                "ALTER TABLE runs ADD COLUMN capability_snapshot_id TEXT",
                [],
            )?;
        }
        if !column_exists(&conn, "runs", "conversation_id")? {
            conn.execute("ALTER TABLE runs ADD COLUMN conversation_id TEXT", [])?;
        }

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS conversations (
               id TEXT PRIMARY KEY,
               provider TEXT NOT NULL,
               title TEXT NOT NULL,
               provider_session_id TEXT,
               metadata_json TEXT NOT NULL DEFAULT '{}',
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL,
               archived_at TEXT
             );
             CREATE TABLE IF NOT EXISTS conversation_runs (
               id TEXT PRIMARY KEY,
               conversation_id TEXT NOT NULL,
               run_id TEXT NOT NULL,
               seq INTEGER NOT NULL,
               created_at TEXT NOT NULL,
               FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
               FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
               UNIQUE(conversation_id, run_id),
               UNIQUE(conversation_id, seq)
             );
             CREATE INDEX IF NOT EXISTS idx_runs_conversation_started ON runs(conversation_id, started_at ASC);
             CREATE INDEX IF NOT EXISTS idx_conversations_provider_updated ON conversations(provider, updated_at DESC);
             CREATE INDEX IF NOT EXISTS idx_conversations_archived_updated ON conversations(archived_at, updated_at DESC);
             CREATE INDEX IF NOT EXISTS idx_conversation_runs_conversation_seq ON conversation_runs(conversation_id, seq ASC);
             CREATE INDEX IF NOT EXISTS idx_conversation_runs_run ON conversation_runs(run_id);",
        )?;

        self.repair_missing_conversation_links(&conn)?;
        self.backfill_conversation_threads_if_needed(&mut conn)?;
        self.repair_missing_conversation_links(&conn)?;

        // Metric library tables
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS metric_definitions (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               slug TEXT UNIQUE NOT NULL,
               instructions TEXT NOT NULL,
               template_html TEXT DEFAULT '',
               ttl_seconds INTEGER DEFAULT 259200,
               provider TEXT DEFAULT 'claude',
               model TEXT,
               profile_id TEXT,
               cwd TEXT,
               enabled INTEGER DEFAULT 1,
               proactive INTEGER DEFAULT 0,
               metadata_json TEXT DEFAULT '{}',
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL,
               archived_at TEXT
             );
             CREATE TABLE IF NOT EXISTS metric_snapshots (
               id TEXT PRIMARY KEY,
               metric_id TEXT NOT NULL,
               run_id TEXT,
               values_json TEXT DEFAULT '{}',
               rendered_html TEXT DEFAULT '',
               status TEXT DEFAULT 'pending',
               error_message TEXT,
               created_at TEXT NOT NULL,
               completed_at TEXT,
               FOREIGN KEY(metric_id) REFERENCES metric_definitions(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS metric_dependency_invalidations (
               metric_id TEXT PRIMARY KEY,
               source_metric_id TEXT NOT NULL,
               invalidated_at TEXT NOT NULL,
               FOREIGN KEY(metric_id) REFERENCES metric_definitions(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS screen_metrics (
               id TEXT PRIMARY KEY,
               screen_id TEXT NOT NULL,
               metric_id TEXT NOT NULL,
               position INTEGER DEFAULT 0,
               layout_hint TEXT DEFAULT 'card',
               FOREIGN KEY(metric_id) REFERENCES metric_definitions(id) ON DELETE CASCADE,
               UNIQUE(screen_id, metric_id)
             );
             CREATE INDEX IF NOT EXISTS idx_metric_definitions_slug ON metric_definitions(slug);
             CREATE INDEX IF NOT EXISTS idx_metric_definitions_enabled ON metric_definitions(enabled, archived_at);
             CREATE INDEX IF NOT EXISTS idx_metric_snapshots_metric_created ON metric_snapshots(metric_id, created_at DESC);
             CREATE INDEX IF NOT EXISTS idx_metric_snapshots_run ON metric_snapshots(run_id);
             CREATE INDEX IF NOT EXISTS idx_metric_snapshots_status ON metric_snapshots(status);
             CREATE INDEX IF NOT EXISTS idx_metric_dependency_invalidations_source
               ON metric_dependency_invalidations(source_metric_id, invalidated_at DESC);
             CREATE INDEX IF NOT EXISTS idx_screen_metrics_screen ON screen_metrics(screen_id, position);
             CREATE INDEX IF NOT EXISTS idx_screen_metrics_metric ON screen_metrics(metric_id);",
        )?;

        // Grid layout columns for react-grid-layout
        if !column_exists(&conn, "screen_metrics", "grid_x")? {
            conn.execute("ALTER TABLE screen_metrics ADD COLUMN grid_x INTEGER DEFAULT -1", [])?;
            conn.execute("ALTER TABLE screen_metrics ADD COLUMN grid_y INTEGER DEFAULT -1", [])?;
            conn.execute("ALTER TABLE screen_metrics ADD COLUMN grid_w INTEGER DEFAULT 4", [])?;
            conn.execute("ALTER TABLE screen_metrics ADD COLUMN grid_h INTEGER DEFAULT 6", [])?;

            // Migrate existing layout_hint values to grid sizes
            conn.execute(
                "UPDATE screen_metrics SET grid_w = 8, grid_h = 6 WHERE layout_hint = 'wide'",
                [],
            )?;
            conn.execute(
                "UPDATE screen_metrics SET grid_w = 12, grid_h = 8 WHERE layout_hint = 'full'",
                [],
            )?;
        }

        // One-time migration: double grid_h values for rowHeight change (80→40)
        {
            let migrated: i64 = conn.query_row(
                "SELECT COUNT(1) FROM settings WHERE key = 'migration:grid_rowheight_v2'",
                [],
                |row| row.get(0),
            ).unwrap_or(0);
            if migrated == 0 {
                conn.execute(
                    "UPDATE screen_metrics SET grid_h = grid_h * 2 WHERE grid_h <= 4",
                    [],
                )?;
                conn.execute(
                    "INSERT INTO settings (key, value_json, updated_at) VALUES ('migration:grid_rowheight_v2', '\"done\"', ?1)
                     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
                    params![Utc::now().to_rfc3339()],
                )?;
            }
        }

        // Drop UNIQUE(screen_id, metric_id) to allow multiple widgets of the same metric
        {
            let migrated: i64 = conn.query_row(
                "SELECT COUNT(1) FROM settings WHERE key = 'migration:screen_metrics_multi_widget'",
                [],
                |row| row.get(0),
            ).unwrap_or(0);
            if migrated == 0 {
                conn.execute_batch(
                    "CREATE TABLE screen_metrics_new (
                       id TEXT PRIMARY KEY,
                       screen_id TEXT NOT NULL,
                       metric_id TEXT NOT NULL,
                       position INTEGER DEFAULT 0,
                       layout_hint TEXT DEFAULT 'card',
                       grid_x INTEGER DEFAULT -1,
                       grid_y INTEGER DEFAULT -1,
                       grid_w INTEGER DEFAULT 4,
                       grid_h INTEGER DEFAULT 6,
                       FOREIGN KEY(metric_id) REFERENCES metric_definitions(id) ON DELETE CASCADE
                     );
                     INSERT INTO screen_metrics_new SELECT id, screen_id, metric_id, position, layout_hint, grid_x, grid_y, grid_w, grid_h FROM screen_metrics;
                     DROP TABLE screen_metrics;
                     ALTER TABLE screen_metrics_new RENAME TO screen_metrics;
                     CREATE INDEX IF NOT EXISTS idx_screen_metrics_screen ON screen_metrics(screen_id, position);
                     CREATE INDEX IF NOT EXISTS idx_screen_metrics_metric ON screen_metrics(metric_id);",
                )?;
                conn.execute(
                    "INSERT INTO settings (key, value_json, updated_at) VALUES ('migration:screen_metrics_multi_widget', '\"done\"', ?1)
                     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
                    params![Utc::now().to_rfc3339()],
                )?;
            }
        }

        Ok(())
    }

    fn backfill_conversation_threads_if_needed(&self, conn: &mut Connection) -> AppResult<()> {
        const MIGRATION_KEY: &str = "migration:conversation_threads_v1";

        let marker_exists: i64 = conn.query_row(
            "SELECT COUNT(1) FROM settings WHERE key = ?1",
            [MIGRATION_KEY],
            |row| row.get(0),
        )?;
        if marker_exists > 0 {
            return Ok(());
        }

        let tx = conn.transaction()?;
        let mut stmt = tx.prepare(
            "SELECT id, provider, prompt, started_at
             FROM runs
             WHERE conversation_id IS NULL
             ORDER BY started_at ASC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);

        for (run_id, provider_raw, prompt, started_at) in rows {
            let conversation_id = Uuid::new_v4().to_string();
            let title = normalize_conversation_title(&prompt);
            tx.execute(
                "INSERT INTO conversations (id, provider, title, provider_session_id, metadata_json, created_at, updated_at, archived_at)
                 VALUES (?1, ?2, ?3, NULL, '{}', ?4, ?4, NULL)",
                params![conversation_id, provider_raw, title, started_at],
            )?;
            tx.execute(
                "UPDATE runs SET conversation_id = ?1 WHERE id = ?2",
                params![conversation_id, run_id],
            )?;
            tx.execute(
                "INSERT INTO conversation_runs (id, conversation_id, run_id, seq, created_at)
                 VALUES (?1, ?2, ?3, 1, ?4)",
                params![Uuid::new_v4().to_string(), conversation_id, run_id, started_at],
            )?;
        }

        tx.execute(
            "INSERT INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            params![
                MIGRATION_KEY,
                serde_json::json!({
                    "completedAt": Utc::now().to_rfc3339(),
                    "strategy": "one-run-per-conversation"
                })
                .to_string(),
                Utc::now().to_rfc3339()
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    fn repair_missing_conversation_links(&self, conn: &Connection) -> AppResult<()> {
        conn.execute(
            "UPDATE runs
             SET conversation_id = NULL
             WHERE conversation_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM conversations c WHERE c.id = runs.conversation_id
               )",
            [],
        )?;

        let mut stmt = conn.prepare(
            "SELECT r.id, r.conversation_id, r.started_at
             FROM runs r
             WHERE r.conversation_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = r.conversation_id)
               AND NOT EXISTS (
                 SELECT 1
                 FROM conversation_runs cr
                 WHERE cr.run_id = r.id
                   AND cr.conversation_id = r.conversation_id
               )
             ORDER BY r.started_at ASC",
        )?;
        let missing = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);

        for (run_id, conversation_id, started_at) in missing {
            let seq: i64 = conn.query_row(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM conversation_runs WHERE conversation_id = ?1",
                [conversation_id.as_str()],
                |row| row.get(0),
            )?;
            conn.execute(
                "INSERT OR IGNORE INTO conversation_runs (id, conversation_id, run_id, seq, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![Uuid::new_v4().to_string(), conversation_id, run_id, seq, started_at],
            )?;
        }
        Ok(())
    }

    #[cfg(test)]
    fn validate_conversation_link_consistency(&self) -> AppResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;

        let missing_rows: i64 = conn.query_row(
            "SELECT COUNT(1)
             FROM runs r
             WHERE r.conversation_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1
                 FROM conversation_runs cr
                 WHERE cr.run_id = r.id
                   AND cr.conversation_id = r.conversation_id
               )",
            [],
            |row| row.get(0),
        )?;
        if missing_rows > 0 {
            return Err(AppError::Internal(format!(
                "conversation link invariant violated: {} runs missing conversation_runs row",
                missing_rows
            )));
        }

        let mismatched_rows: i64 = conn.query_row(
            "SELECT COUNT(1)
             FROM conversation_runs cr
             JOIN runs r ON r.id = cr.run_id
             WHERE r.conversation_id IS NULL OR r.conversation_id != cr.conversation_id",
            [],
            |row| row.get(0),
        )?;
        if mismatched_rows > 0 {
            return Err(AppError::Internal(format!(
                "conversation link invariant violated: {} mismatched rows",
                mismatched_rows
            )));
        }
        Ok(())
    }

    fn ensure_default_retention(&self) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let count: i64 = conn.query_row("SELECT COUNT(1) FROM retention_policies", [], |row| row.get(0))?;
        if count == 0 {
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO retention_policies (id, scope, days_to_keep, max_storage_mb, created_at, updated_at)
                 VALUES (?1, 'global', 90, 1024, ?2, ?2)",
                params![Uuid::new_v4().to_string(), now],
            )?;
        }
        Ok(())
    }

    pub fn ensure_bootstrap_workspace_grant(&self) -> AppResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Internal("database mutex poisoned".to_string()))?;
        let active_grants: i64 = conn.query_row(
            "SELECT COUNT(1) FROM workspace_grants WHERE revoked_at IS NULL",
            [],
            |row| row.get(0),
        )?;
        if active_grants > 0 {
            if active_grants == 1 {
                let existing: Option<(String, String, String)> = conn
                    .query_row(
                        "SELECT id, path, granted_by
                         FROM workspace_grants
                         WHERE revoked_at IS NULL
                         LIMIT 1",
                        [],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .optional()?;

                if let Some((id, path, granted_by)) = existing {
                    if granted_by == "bootstrap" {
                        let existing_path = PathBuf::from(path);
                        let should_promote_parent = existing_path
                            .file_name()
                            .and_then(|value| value.to_str())
                            .map(|value| value == "src-tauri")
                            .unwrap_or(false);
                        if should_promote_parent {
                            if let Some(parent) = existing_path.parent() {
                                if parent.join("package.json").is_file() {
                                    let canonical_parent = parent.canonicalize().map_err(|error| {
                                        AppError::Policy(format!(
                                            "Unable to canonicalize promoted workspace path: {}",
                                            error
                                        ))
                                    })?;
                                    conn.execute(
                                        "UPDATE workspace_grants SET path = ?1 WHERE id = ?2",
                                        params![canonical_parent.to_string_lossy(), id],
                                    )?;
                                }
                            }
                        }
                    }
                }
            }
            return Ok(());
        }

        let default_path = default_workspace_candidate()?;
        if !default_path.is_absolute() || !default_path.exists() || !default_path.is_dir() {
            return Err(AppError::Policy(format!(
                "Bootstrap workspace path '{}' is not a valid directory",
                default_path.to_string_lossy()
            )));
        }
        let canonical = default_path
            .canonicalize()
            .map_err(|error| AppError::Policy(format!("Unable to resolve bootstrap workspace path: {}", error)))?;

        conn.execute(
            "INSERT INTO workspace_grants (id, path, granted_by, granted_at, revoked_at)
             VALUES (?1, ?2, 'bootstrap', ?3, NULL)",
            params![
                Uuid::new_v4().to_string(),
                canonical.to_string_lossy(),
                Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }
}

fn parse_run_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunRecord> {
    let warnings_raw: String = row.get(15)?;
    Ok(RunRecord {
        id: row.get(0)?,
        provider: parse_provider(&row.get::<_, String>(1)?)?,
        status: parse_status(&row.get::<_, String>(2)?)?,
        prompt: row.get(3)?,
        model: row.get(4)?,
        mode: parse_mode(&row.get::<_, String>(5)?)?,
        output_format: row.get(6)?,
        cwd: row.get(7)?,
        started_at: parse_time(&row.get::<_, String>(8)?)?,
        ended_at: row
            .get::<_, Option<String>>(9)?
            .map(|raw| parse_time(&raw))
            .transpose()?,
        exit_code: row.get(10)?,
        error_summary: row.get(11)?,
        queue_priority: row.get(12)?,
        profile_id: row.get(13)?,
        capability_snapshot_id: row.get(14)?,
        compatibility_warnings: serde_json::from_str::<Vec<String>>(&warnings_raw).unwrap_or_default(),
        conversation_id: row.get(16)?,
    })
}

fn parse_conversation_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConversationRecord> {
    let metadata_raw: String = row.get(4)?;
    Ok(ConversationRecord {
        id: row.get(0)?,
        provider: parse_provider(&row.get::<_, String>(1)?)?,
        title: row.get(2)?,
        provider_session_id: row.get(3)?,
        metadata: serde_json::from_str::<serde_json::Value>(&metadata_raw).unwrap_or_else(|_| serde_json::json!({})),
        created_at: parse_time(&row.get::<_, String>(5)?)?,
        updated_at: parse_time(&row.get::<_, String>(6)?)?,
        archived_at: row
            .get::<_, Option<String>>(7)?
            .map(|raw| parse_time(&raw))
            .transpose()?,
    })
}

fn parse_metric_definition_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MetricDefinition> {
    Ok(MetricDefinition {
        id: row.get(0)?,
        name: row.get(1)?,
        slug: row.get(2)?,
        instructions: row.get(3)?,
        template_html: row.get(4)?,
        ttl_seconds: row.get(5)?,
        provider: parse_provider(&row.get::<_, String>(6)?)?,
        model: row.get(7)?,
        profile_id: row.get(8)?,
        cwd: row.get(9)?,
        enabled: row.get::<_, i32>(10)? != 0,
        proactive: row.get::<_, i32>(11)? != 0,
        metadata_json: serde_json::from_str::<serde_json::Value>(&row.get::<_, String>(12)?)
            .unwrap_or(serde_json::json!({})),
        created_at: parse_time(&row.get::<_, String>(13)?)?,
        updated_at: parse_time(&row.get::<_, String>(14)?)?,
        archived_at: row
            .get::<_, Option<String>>(15)?
            .map(|raw| parse_time(&raw))
            .transpose()?,
    })
}

fn parse_metric_snapshot_status(raw: &str) -> MetricSnapshotStatus {
    match raw {
        "pending" => MetricSnapshotStatus::Pending,
        "running" => MetricSnapshotStatus::Running,
        "completed" => MetricSnapshotStatus::Completed,
        "failed" => MetricSnapshotStatus::Failed,
        _ => MetricSnapshotStatus::Failed,
    }
}

fn parse_metric_snapshot_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MetricSnapshot> {
    Ok(MetricSnapshot {
        id: row.get(0)?,
        metric_id: row.get(1)?,
        run_id: row.get(2)?,
        values_json: serde_json::from_str::<serde_json::Value>(&row.get::<_, String>(3)?)
            .unwrap_or(serde_json::json!({})),
        rendered_html: row.get(4)?,
        status: parse_metric_snapshot_status(&row.get::<_, String>(5)?),
        error_message: row.get(6)?,
        created_at: parse_time(&row.get::<_, String>(7)?)?,
        completed_at: row
            .get::<_, Option<String>>(8)?
            .map(|raw| parse_time(&raw))
            .transpose()?,
    })
}

fn normalize_conversation_title(raw: &str) -> String {
    let first_line = raw.lines().next().unwrap_or_default().trim();
    if first_line.is_empty() {
        return "New chat".to_string();
    }
    let max_chars = 80;
    if first_line.chars().count() <= max_chars {
        return first_line.to_string();
    }
    let truncated: String = first_line.chars().take(max_chars - 1).collect();
    format!("{}...", truncated)
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> AppResult<bool> {
    let pragma = format!("PRAGMA table_info({})", table);
    let mut stmt = conn.prepare(&pragma)?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn parse_provider(raw: &str) -> rusqlite::Result<Provider> {
    match raw {
        "codex" => Ok(Provider::Codex),
        "claude" => Ok(Provider::Claude),
        "kiingo-mcp" => Ok(Provider::KiingoMcp),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Unknown provider '{}'", other),
            )),
        )),
    }
}

fn parse_status(raw: &str) -> rusqlite::Result<RunStatus> {
    match raw {
        "queued" => Ok(RunStatus::Queued),
        "running" => Ok(RunStatus::Running),
        "completed" => Ok(RunStatus::Completed),
        "failed" => Ok(RunStatus::Failed),
        "canceled" => Ok(RunStatus::Canceled),
        "interrupted" => Ok(RunStatus::Interrupted),
        _ => Ok(RunStatus::Failed),
    }
}

fn parse_mode(raw: &str) -> rusqlite::Result<RunMode> {
    match raw {
        "non-interactive" => Ok(RunMode::NonInteractive),
        "interactive" => Ok(RunMode::Interactive),
        _ => Ok(RunMode::NonInteractive),
    }
}

fn mode_as_str(mode: RunMode) -> &'static str {
    match mode {
        RunMode::NonInteractive => "non-interactive",
        RunMode::Interactive => "interactive",
    }
}

fn parse_time(raw: &str) -> rusqlite::Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string())),
            )
        })
}

fn merge_json(target: &mut serde_json::Value, update: serde_json::Value) {
    match (target, update) {
        (serde_json::Value::Object(target_map), serde_json::Value::Object(update_map)) => {
            for (key, value) in update_map {
                merge_json(target_map.entry(key).or_insert(serde_json::Value::Null), value);
            }
        }
        (target, update) => {
            *target = update;
        }
    }
}

fn default_workspace_candidate() -> AppResult<PathBuf> {
    if let Ok(cwd) = std::env::current_dir() {
        if cwd
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value == "src-tauri")
            .unwrap_or(false)
        {
            if let Some(parent) = cwd.parent() {
                if parent.join("package.json").is_file() {
                    return Ok(parent.to_path_buf());
                }
            }
        }
        return Ok(cwd);
    }

    #[cfg(unix)]
    {
        if let Ok(home) = std::env::var("HOME") {
            return Ok(PathBuf::from(home));
        }
    }

    #[cfg(windows)]
    {
        if let Ok(home) = std::env::var("USERPROFILE") {
            return Ok(PathBuf::from(home));
        }
    }

    Err(AppError::Policy(
        "Unable to determine a default workspace path".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::Database;
    use crate::models::{
        BindMetricToScreenPayload, ListConversationsFilters, ListRunsFilters, Provider, RunMode,
        SaveMetricDefinitionPayload, SaveProfilePayload,
    };

    #[test]
    fn database_can_insert_and_read_run() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("test.db");
        let db = Database::new(&db_path).expect("db");

        db.insert_run(
            "run-1",
            Provider::Codex,
            "hello",
            Some("gpt-5"),
            RunMode::NonInteractive,
            Some("text"),
            dir.path().to_string_lossy().as_ref(),
            0,
            None,
            None,
            &[],
        )
        .expect("insert run");

        let runs = db.list_runs(&ListRunsFilters::default()).expect("list runs");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].id, "run-1");
        assert!(runs[0].profile_id.is_none());
        assert!(runs[0].capability_snapshot_id.is_none());
    }

    #[test]
    fn can_round_trip_profile_by_id() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("test.db");
        let db = Database::new(&db_path).expect("db");

        let saved = db
            .save_profile(SaveProfilePayload {
                id: None,
                name: "profile-a".to_string(),
                provider: Provider::Claude,
                config: serde_json::json!({
                    "model": "claude-sonnet",
                    "optionalFlags": { "max-turns": 5 }
                }),
            })
            .expect("save profile");

        let loaded = db
            .get_profile_by_id(&saved.id)
            .expect("get profile")
            .expect("profile exists");
        assert_eq!(loaded.id, saved.id);
        assert_eq!(loaded.provider, Provider::Claude);
    }

    #[test]
    fn bootstrap_grant_is_created_when_none_exist() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("test.db");
        let db = Database::new(&db_path).expect("db");

        db.ensure_bootstrap_workspace_grant()
            .expect("bootstrap grant");
        let grants = db.list_workspace_grants().expect("list grants");
        assert!(!grants.is_empty());
        assert!(grants.iter().any(|grant| grant.revoked_at.is_none()));
    }

    #[test]
    fn conversation_round_trip_and_run_linking_work() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("test.db");
        let db = Database::new(&db_path).expect("db");

        let conversation = db
            .create_conversation(Provider::Codex, Some("hello world"), None)
            .expect("create conversation");
        assert_eq!(conversation.provider, Provider::Codex);

        db.insert_run(
            "run-1",
            Provider::Codex,
            "prompt",
            Some("gpt-5.3-codex"),
            RunMode::NonInteractive,
            Some("text"),
            dir.path().to_string_lossy().as_ref(),
            0,
            None,
            None,
            &[],
        )
        .expect("insert run");
        db.attach_run_to_conversation(&conversation.id, "run-1")
            .expect("attach run");

        let detail = db
            .get_conversation_detail(&conversation.id)
            .expect("get detail")
            .expect("exists");
        assert_eq!(detail.runs.len(), 1);
        assert_eq!(detail.runs[0].id, "run-1");
        assert_eq!(detail.runs[0].conversation_id.as_deref(), Some(conversation.id.as_str()));

        let filtered = db
            .list_runs(&ListRunsFilters {
                conversation_id: Some(conversation.id.clone()),
                ..ListRunsFilters::default()
            })
            .expect("list runs by conversation");
        assert_eq!(filtered.len(), 1);
    }

    #[test]
    fn conversation_session_and_archive_fields_update() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("test.db");
        let db = Database::new(&db_path).expect("db");

        let conversation = db
            .create_conversation(Provider::Claude, Some("session test"), None)
            .expect("create conversation");
        db.set_conversation_session_id(&conversation.id, "session-123")
            .expect("set session");
        let updated = db
            .get_conversation(&conversation.id)
            .expect("get conversation")
            .expect("exists");
        assert_eq!(updated.provider_session_id.as_deref(), Some("session-123"));

        let archived = db
            .archive_conversation(&conversation.id, true)
            .expect("archive conversation");
        assert!(archived);

        let active = db
            .list_conversations(&ListConversationsFilters {
                provider: Some(Provider::Claude),
                include_archived: Some(false),
                ..ListConversationsFilters::default()
            })
            .expect("list active");
        assert!(active.is_empty());

        let all = db
            .list_conversations(&ListConversationsFilters {
                provider: Some(Provider::Claude),
                include_archived: Some(true),
                ..ListConversationsFilters::default()
            })
            .expect("list all");
        assert_eq!(all.len(), 1);
        assert!(all[0].archived_at.is_some());
    }

    #[test]
    fn repairs_missing_conversation_run_links_and_validates_invariants() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("test.db");
        let db = Database::new(&db_path).expect("db");

        let conversation = db
            .create_conversation(Provider::Codex, Some("repair test"), None)
            .expect("create conversation");
        db.insert_run(
            "run-repair",
            Provider::Codex,
            "prompt",
            Some("gpt-5.3-codex"),
            RunMode::NonInteractive,
            Some("text"),
            dir.path().to_string_lossy().as_ref(),
            0,
            None,
            None,
            &[],
        )
        .expect("insert run");
        db.attach_run_to_conversation(&conversation.id, "run-repair")
            .expect("attach run");

        {
            let conn = db.conn.lock().expect("db lock");
            conn.execute("DELETE FROM conversation_runs WHERE run_id = 'run-repair'", [])
                .expect("delete conversation_runs row");
        }

        {
            let conn = db.conn.lock().expect("db lock");
            db.repair_missing_conversation_links(&conn)
                .expect("repair links");
        }

        db.validate_conversation_link_consistency()
            .expect("validate invariants");
    }

    #[test]
    fn dependency_invalidation_marks_metric_stale_until_recomputed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("test.db");
        let db = Database::new(&db_path).expect("db");

        let source = db
            .save_metric_definition(SaveMetricDefinitionPayload {
                id: None,
                name: "Source".to_string(),
                slug: "source-metric".to_string(),
                instructions: "source".to_string(),
                template_html: None,
                ttl_seconds: Some(3_600),
                provider: Some(Provider::Claude),
                model: None,
                profile_id: None,
                cwd: None,
                enabled: Some(true),
                proactive: Some(false),
                metadata_json: Some(serde_json::json!({})),
            })
            .expect("save source metric");

        let dependent = db
            .save_metric_definition(SaveMetricDefinitionPayload {
                id: None,
                name: "Dependent".to_string(),
                slug: "dependent-metric".to_string(),
                instructions: "dependent".to_string(),
                template_html: None,
                ttl_seconds: Some(3_600),
                provider: Some(Provider::Claude),
                model: None,
                profile_id: None,
                cwd: None,
                enabled: Some(true),
                proactive: Some(false),
                metadata_json: Some(serde_json::json!({
                    "dependencies": [source.slug]
                })),
            })
            .expect("save dependent metric");

        db.bind_metric_to_screen(&BindMetricToScreenPayload {
            screen_id: "dashboard".to_string(),
            metric_id: dependent.id.clone(),
            position: Some(0),
            layout_hint: Some("card".to_string()),
            grid_x: Some(0),
            grid_y: Some(0),
            grid_w: Some(4),
            grid_h: Some(6),
        })
        .expect("bind metric");

        let first_snapshot = db
            .insert_metric_snapshot(&dependent.id)
            .expect("insert first snapshot");
        db.complete_metric_snapshot(
            &first_snapshot.id,
            &serde_json::json!({ "value": 1 }),
            "<div>ok</div>",
        )
        .expect("complete first snapshot");

        let stale_before = db
            .find_stale_metrics_for_screen("dashboard")
            .expect("stale before");
        assert!(!stale_before.iter().any(|metric| metric.id == dependent.id));

        let invalidated = db
            .mark_metrics_invalidated_by_dependency(&source.id, &[dependent.id.clone()])
            .expect("invalidate dependent");
        assert_eq!(invalidated, 1);

        let stale_after_invalidate = db
            .find_stale_metrics_for_screen("dashboard")
            .expect("stale after invalidate");
        assert!(stale_after_invalidate.iter().any(|metric| metric.id == dependent.id));

        let second_snapshot = db
            .insert_metric_snapshot(&dependent.id)
            .expect("insert second snapshot");
        db.complete_metric_snapshot(
            &second_snapshot.id,
            &serde_json::json!({ "value": 2 }),
            "<div>ok2</div>",
        )
        .expect("complete second snapshot");
        db.clear_metric_dependency_invalidation(&dependent.id)
            .expect("clear invalidation");

        let stale_after_recompute = db
            .find_stale_metrics_for_screen("dashboard")
            .expect("stale after recompute");
        assert!(!stale_after_recompute
            .iter()
            .any(|metric| metric.id == dependent.id));
    }
}
