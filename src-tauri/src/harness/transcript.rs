#![allow(dead_code)]

#[derive(Debug, Default, Clone)]
pub struct TranscriptCollector {
    text: String,
    thinking: String,
    structured_output: Option<String>,
}

impl TranscriptCollector {
    pub fn on_semantic_event(&mut self, event_type: &str, payload: &serde_json::Value) {
        match event_type {
            "text_delta" => {
                if let Some(text) = payload.get("text").and_then(|v| v.as_str()) {
                    self.text.push_str(text);
                }
            }
            "text_complete" => {
                if let Some(text) = payload.get("text").and_then(|v| v.as_str()) {
                    if !text.trim().is_empty() {
                        self.text = text.to_string();
                    }
                }
            }
            "thinking_delta" => {
                if let Some(text) = payload.get("text").and_then(|v| v.as_str()) {
                    self.thinking.push_str(text);
                }
            }
            "thinking_complete" => {
                if let Some(text) = payload.get("text").and_then(|v| v.as_str()) {
                    if !text.trim().is_empty() {
                        self.thinking = text.to_string();
                    }
                }
            }
            "structured_output" => {
                if let Some(result) = payload.get("result") {
                    self.structured_output = Some(result.to_string());
                }
            }
            _ => {}
        }
    }

    pub fn text(&self) -> String {
        self.text.trim().to_string()
    }

    pub fn thinking(&self) -> String {
        self.thinking.trim().to_string()
    }

    pub fn structured_output(&self) -> Option<String> {
        self.structured_output.clone()
    }
}
