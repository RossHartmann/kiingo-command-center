import { useState } from "react";
import { useAppActions } from "../state/appState";
import type { MetricDefinition, SaveMetricDefinitionPayload } from "../lib/types";

interface MetricDefinitionEditorProps {
  definition?: MetricDefinition;
  onClose: () => void;
}

export function MetricDefinitionEditor({ definition, onClose }: MetricDefinitionEditorProps): JSX.Element {
  const actions = useAppActions();
  const [name, setName] = useState(definition?.name ?? "");
  const [slug, setSlug] = useState(definition?.slug ?? "");
  const [instructions, setInstructions] = useState(definition?.instructions ?? "");
  const [templateHtml, setTemplateHtml] = useState(definition?.templateHtml ?? "");
  const [ttlSeconds, setTtlSeconds] = useState(definition?.ttlSeconds ?? 3600);
  const [provider, setProvider] = useState<"codex" | "claude">(definition?.provider ?? "claude");
  const [model, setModel] = useState(definition?.model ?? "");
  const [cwd, setCwd] = useState(definition?.cwd ?? "");
  const [enabled, setEnabled] = useState(definition?.enabled ?? true);
  const [proactive, setProactive] = useState(definition?.proactive ?? false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleSlugify = (value: string) => {
    const slugified = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    setSlug(slugified);
  };

  const handleSave = async () => {
    if (!name.trim() || !slug.trim() || !instructions.trim()) return;
    setSaving(true);
    try {
      const payload: SaveMetricDefinitionPayload = {
        id: definition?.id,
        name: name.trim(),
        slug: slug.trim(),
        instructions: instructions.trim(),
        templateHtml: templateHtml.trim() || undefined,
        ttlSeconds,
        provider,
        model: model.trim() || undefined,
        cwd: cwd.trim() || undefined,
        enabled,
        proactive
      };
      await actions.saveMetricDefinition(payload);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!name.trim() || !slug.trim() || !instructions.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const saved = await actions.saveMetricDefinition({
        id: definition?.id,
        name: name.trim(),
        slug: slug.trim(),
        instructions: instructions.trim(),
        templateHtml: templateHtml.trim() || undefined,
        ttlSeconds,
        provider,
        model: model.trim() || undefined,
        cwd: cwd.trim() || undefined,
        enabled: true,
        proactive: false
      });
      await actions.refreshMetric(saved.id);
      setTestResult("Refresh triggered. Check dashboard for results.");
    } catch (err) {
      setTestResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="metric-editor card">
      <h3>{definition ? "Edit Metric" : "New Metric"}</h3>

      <label>
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!definition) handleSlugify(e.target.value);
          }}
          placeholder="e.g. Monthly Revenue"
        />
      </label>

      <label>
        Slug
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="e.g. monthly-revenue"
        />
      </label>

      <label>
        Instructions (LLM prompt)
        <textarea
          rows={6}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Retrieve the current MRR from the billing system..."
        />
      </label>

      <label>
        HTML Template (optional)
        <textarea
          rows={4}
          value={templateHtml}
          onChange={(e) => setTemplateHtml(e.target.value)}
          placeholder="<div class='metric'>{{value}}</div>"
        />
      </label>

      <div className="metric-editor-row">
        <label>
          TTL (seconds)
          <input
            type="number"
            min={0}
            value={ttlSeconds}
            onChange={(e) => setTtlSeconds(Number(e.target.value))}
          />
        </label>
        <label>
          Provider
          <select value={provider} onChange={(e) => setProvider(e.target.value as "codex" | "claude")}>
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
        </label>
      </div>

      <label>
        Model (optional)
        <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. sonnet" />
      </label>

      <label>
        Working Directory (optional)
        <input type="text" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="Use workspace default" />
      </label>

      <div className="metric-editor-checks">
        <label className="checkbox-row">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={proactive} onChange={(e) => setProactive(e.target.checked)} />
          Proactive refresh (background)
        </label>
      </div>

      {testResult && <div className="banner info">{testResult}</div>}

      <div className="actions">
        <button type="button" className="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={handleTest} disabled={testing}>
          {testing ? "Testing..." : "Test"}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
