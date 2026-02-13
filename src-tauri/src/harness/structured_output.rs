use serde_json::Value;

#[derive(Debug, Clone)]
pub struct StructuredOutputValidationResult {
    pub value: Option<Value>,
    pub error: Option<String>,
    pub errors: Vec<String>,
}

pub fn resolve_structured_output(
    content: Option<&str>,
    fallback_text: Option<&str>,
) -> Option<Value> {
    if let Some(value) = content.and_then(parse_json_value) {
        return Some(value);
    }
    fallback_text.and_then(parse_json_value)
}

fn parse_json_value(raw: &str) -> Option<Value> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    serde_json::from_str(trimmed).ok()
}

pub fn validate_structured_output(
    value: Option<Value>,
    schema: Option<&Value>,
) -> StructuredOutputValidationResult {
    let Some(value) = value else {
        if schema.is_some() {
            return StructuredOutputValidationResult {
                value: None,
                error: Some("Structured output is missing or invalid JSON.".to_string()),
                errors: vec![],
            };
        }
        return StructuredOutputValidationResult {
            value: None,
            error: None,
            errors: vec![],
        };
    };

    let Some(schema) = schema else {
        return StructuredOutputValidationResult {
            value: Some(value),
            error: None,
            errors: vec![],
        };
    };

    let compiled = match jsonschema::JSONSchema::compile(schema) {
        Ok(compiled) => compiled,
        Err(error) => {
            return StructuredOutputValidationResult {
                value: Some(value),
                error: Some(format!("Failed to validate structured output schema: {}", error)),
                errors: vec![],
            }
        }
    };

    let errors: Vec<String> = compiled
        .validate(&value)
        .err()
        .map(|errors| {
            errors
                .map(|error| {
                    let path = error.instance_path.to_string();
                    if path.is_empty() {
                        error.to_string()
                    } else {
                        format!("{}: {}", path, error)
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if errors.is_empty() {
        StructuredOutputValidationResult {
            value: Some(value),
            error: None,
            errors,
        }
    } else {
        StructuredOutputValidationResult {
            value: Some(value),
            error: Some("Structured output did not match schema.".to_string()),
            errors,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_structured_output, validate_structured_output};

    #[test]
    fn resolves_from_content_before_fallback() {
        let value = resolve_structured_output(Some("{\"a\":1}"), Some("{\"a\":2}"));
        assert_eq!(value, Some(serde_json::json!({"a": 1})));
    }

    #[test]
    fn validates_schema_and_reports_errors() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "ok": { "type": "boolean" }
            },
            "required": ["ok"],
            "additionalProperties": false
        });
        let validation = validate_structured_output(
            Some(serde_json::json!({"ok": "nope"})),
            Some(&schema),
        );
        assert!(validation.error.is_some());
        assert!(!validation.errors.is_empty());
    }
}
