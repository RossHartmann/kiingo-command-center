use crate::models::{CapabilityProfile, HarnessRequestOptions, UnifiedTool};

#[derive(Debug, Default)]
pub struct CapabilityAdjustment {
    pub harness: Option<HarnessRequestOptions>,
    pub warnings: Vec<String>,
}

pub fn apply_harness_capabilities(
    input: Option<HarnessRequestOptions>,
    capabilities: &CapabilityProfile,
) -> CapabilityAdjustment {
    let mut warnings = Vec::new();
    let Some(mut harness) = input else {
        return CapabilityAdjustment {
            harness: None,
            warnings,
        };
    };

    let supports = |flag: &str| capabilities.supported_flags.iter().any(|value| value == flag);
    let supports_any = |flags: &[&str]| flags.iter().any(|flag| supports(flag));

    if (harness.resume_session_id.is_some() || harness.continue_session == Some(true))
        && !supports_any(&["--resume", "--continue"])
    {
        warnings.push(
            "Resume requested but CLI capability does not support resume flags. Dropping resume request."
                .to_string(),
        );
        harness.resume_session_id = None;
        harness.continue_session = None;
    }

    if harness.structured_output.is_some()
        && !supports("--json-schema")
        && !supports("--output-schema")
    {
        warnings.push("Structured output requested but CLI capability does not support schema flags. Dropping structured output.".to_string());
        harness.structured_output = None;
    }

    if harness.mcp.is_some() && !supports_any(&["--mcp-config", "--config"]) {
        warnings.push(
            "MCP requested but CLI capability does not support MCP configuration flags. Dropping MCP config."
                .to_string(),
        );
        harness.mcp = None;
    }

    if harness
        .system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
        && !supports("--system-prompt")
    {
        warnings.push(
            "System prompt requested but CLI capability does not support --system-prompt. Dropping system prompt."
                .to_string(),
        );
        harness.system_prompt = None;
    }

    if harness
        .append_system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
        && !supports("--append-system-prompt")
    {
        warnings.push(
            "Append system prompt requested but CLI capability does not support --append-system-prompt. Dropping append system prompt."
                .to_string(),
        );
        harness.append_system_prompt = None;
    }

    if harness.tools.as_ref().map(|tools| !tools.is_empty()).unwrap_or(false)
        && !supports_any(&["--tools", "--allowedTools"])
    {
        warnings.push(
            "Tools were requested but CLI capability does not support tool flags. Dropping tools."
                .to_string(),
        );
        harness.tools = None;
    }

    if harness.images.as_ref().map(|images| !images.is_empty()).unwrap_or(false)
        && !supports_any(&["--image", "--input-format"])
    {
        warnings.push(
            "Images were provided but CLI capability does not support image input flags. Dropping images."
                .to_string(),
        );
        harness.images = None;
    }

    if harness.mcp.is_some() {
        let mut tools = harness.tools.clone().unwrap_or_default();
        if !tools.contains(&UnifiedTool::Mcp) {
            tools.push(UnifiedTool::Mcp);
            harness.tools = Some(tools);
            warnings.push(
                "MCP servers configured but tools list did not include mcp. Added mcp tool automatically."
                    .to_string(),
            );
        }
    }

    CapabilityAdjustment {
        harness: Some(harness),
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::apply_harness_capabilities;
    use crate::models::{
        CapabilityProfile, HarnessRequestOptions, McpConfig, McpServerConfig, Provider, RunMode,
        StructuredOutputConfig, UnifiedTool,
    };

    #[test]
    fn drops_resume_when_resume_flag_unsupported() {
        let capability = CapabilityProfile {
            provider: Provider::Claude,
            cli_version: "1.0.0".to_string(),
            supported: true,
            degraded: false,
            blocked: false,
            supported_flags: vec!["--model".to_string()],
            supported_modes: vec![RunMode::NonInteractive],
            disabled_reasons: vec![],
        };
        let harness = HarnessRequestOptions {
            resume_session_id: Some("abc".to_string()),
            continue_session: Some(true),
            ..Default::default()
        };
        let adjusted = apply_harness_capabilities(Some(harness), &capability);
        assert!(adjusted
            .warnings
            .iter()
            .any(|warning| warning.contains("Resume requested")));
        assert!(adjusted
            .harness
            .as_ref()
            .and_then(|h| h.resume_session_id.as_ref())
            .is_none());
    }

    #[test]
    fn keeps_structured_output_when_supported() {
        let capability = CapabilityProfile {
            provider: Provider::Claude,
            cli_version: "1.0.0".to_string(),
            supported: true,
            degraded: false,
            blocked: false,
            supported_flags: vec!["--json-schema".to_string()],
            supported_modes: vec![RunMode::NonInteractive],
            disabled_reasons: vec![],
        };
        let harness = HarnessRequestOptions {
            structured_output: Some(StructuredOutputConfig {
                schema: serde_json::json!({"type": "object"}),
                strict: Some(true),
            }),
            ..Default::default()
        };
        let adjusted = apply_harness_capabilities(Some(harness), &capability);
        assert!(adjusted.warnings.is_empty());
        assert!(adjusted
            .harness
            .as_ref()
            .and_then(|h| h.structured_output.as_ref())
            .is_some());
    }

    #[test]
    fn injects_mcp_tool_when_servers_configured() {
        let capability = CapabilityProfile {
            provider: Provider::Claude,
            cli_version: "1.0.0".to_string(),
            supported: true,
            degraded: false,
            blocked: false,
            supported_flags: vec!["--mcp-config".to_string(), "--tools".to_string()],
            supported_modes: vec![RunMode::NonInteractive],
            disabled_reasons: vec![],
        };
        let harness = HarnessRequestOptions {
            tools: Some(vec![UnifiedTool::FileRead]),
            mcp: Some(McpConfig {
                servers: vec![McpServerConfig {
                    name: "local".to_string(),
                    command: Some("echo".to_string()),
                    ..Default::default()
                }],
            }),
            ..Default::default()
        };
        let adjusted = apply_harness_capabilities(Some(harness), &capability);
        let tools = adjusted
            .harness
            .as_ref()
            .and_then(|h| h.tools.as_ref())
            .cloned()
            .unwrap_or_default();
        assert!(tools.contains(&UnifiedTool::Mcp));
    }
}
