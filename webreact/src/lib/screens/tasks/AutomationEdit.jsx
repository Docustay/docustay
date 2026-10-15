// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.002 — AutomationEdit.jsx — React port of webui/src/lib/screens/tasks/AutomationEdit.svelte
// Props: { automationKey, onNavigate }
// Archetype: EditorPage
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from "react";
import { api, ApiError } from "@/lib/api.js";
import EditorPage from "@/lib/components/kit/archetypes/EditorPage.jsx";
import EditorSection from "@/lib/components/editor/EditorSection.jsx";
import EditorRail from "@/lib/components/editor/EditorRail.jsx";
import RailSection from "@/lib/components/editor/RailSection.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import AutomationEditRunsTable from "./AutomationEditRunsTable.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";

export default function AutomationEdit({ automationKey, onNavigate = null }) {
  // ── screen phase ─────────────────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState("loading");
  const [loadError, setLoadError] = useState(null);

  // ── loaded data ──────────────────────────────────────────────────────────────────────────────
  const [automation, setAutomation] = useState(null);

  // ── editable state ───────────────────────────────────────────────────────────────────────────
  const [enabled, setEnabled] = useState(false);
  const [config, setConfig] = useState({});
  const [baselineJSON, setBaselineJSON] = useState("");

  // ── save flow ────────────────────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // ── rail expand/collapse ─────────────────────────────────────────────────────────────────────
  const [railOpen, setRailOpen] = useState({ status: false, ran: false, reach: false, never: false });

  const dirty = useMemo(
    () => phase === "ready" && JSON.stringify({ enabled, config }) !== baselineJSON,
    [phase, enabled, config, baselineJSON]
  );

  // ── load automation data ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setPhase("loading");
      setLoadError(null);
      try {
        const data = await api.automation(automationKey);
        const enabledValue = data.enabled ?? false;
        const configValue = JSON.parse(JSON.stringify(data.config ?? {}));
        setAutomation(data);
        setEnabled(enabledValue);
        setConfig(configValue);
        setBaselineJSON(JSON.stringify({ enabled: enabledValue, config: configValue }));
        setPhase("ready");
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setPhase("denied");
        } else {
          setPhase("error");
          setLoadError(err);
        }
      }
    };
    load();
  }, [automationKey]);

  // ── compute metadata line ────────────────────────────────────────────────────────────────────
  const metaLine = useMemo(() => {
    if (!automation) return "";
    const count = automation.ran_count_since_first ?? 0;
    const month = automation.runs?.[0]?.ran_at
      ? new Date(automation.runs[0].ran_at).toLocaleDateString("en-US", { month: "long" })
      : "?";
    return `On since ${month} · ran ${count} time${count === 1 ? "" : "s"}`;
  }, [automation]);

  // ── save handler ─────────────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.saveAutomation(automationKey, { enabled, config });
      setBaselineJSON(JSON.stringify({ enabled, config }));
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  // ── build trigger type description for "Watch for" field ──────────────────────────────
  const watchForLabel = useMemo(() => {
    if (!automation?.schema) return "";
    const kind = automation.kind || "";
    if (kind === "package_low") {
      return "A package with sessions left";
    }
    return "When it runs";
  }, [automation]);

  // ── build trigger description from schema and data for empty state ───────────────────────────
  const triggerDescription = useMemo(() => {
    if (!automation?.schema) return "";
    const kind = automation.kind || "";
    const fields = automation.schema.fields || [];
    const triggerField = fields.find((f) => f.name === "trigger_value");
    if (triggerField && config.trigger_value) {
      if (kind === "package_low") {
        return `When it hits ${config.trigger_value} sessions left`;
      }
      return `When it hits ${config.trigger_value}`;
    }
    return "When it runs";
  }, [automation, config]);

  // ── rails summary lines ──────────────────────────────────────────────────────────────────────
  const ranSummary = useMemo(() => {
    const count = automation?.ran_count_since_first ?? 0;
    const bought = automation?.bought_count ?? 0;
    if (count === 0) return "";
    if (bought === 0) return `${count} time${count === 1 ? "" : "s"} so far.`;
    return `${count} time${count === 1 ? "" : "s"}. ${bought} of the ${count} bought something.`;
  }, [automation]);

  const reachSummary = useMemo(() => {
    return automation?.reach?.sentence || "";
  }, [automation]);

  function handleStatusToggle() {
    setEnabled(!enabled);
  }

  function handleToggle(key, isExpanded) {
    setRailOpen((prev) => ({ ...prev, [key]: isExpanded }));
  }

  // ── render loading/error/denied states ────────────────────────────────────────────────────────
  if (phase === "loading") {
    return <ScreenState phase="loading" />;
  }

  if (phase === "denied") {
    return <ScreenState phase="denied" />;
  }

  if (phase === "error") {
    return <ErrorPanel error={loadError} />;
  }

  if (!automation) {
    return null;
  }

  // ── render ready state ───────────────────────────────────────────────────────────────────────
  const header = {
    title: automation.name,
    meta: metaLine,
    verbs: [
      { label: "Preview", kind: "plain", onClick: () => {}, disabled: true },
      { label: "Save changes", kind: "primary", onClick: handleSave, disabled: !dirty || saving },
    ],
    onClose: () => onNavigate?.(null),
    dirty,
    objectNoun: "automation",
    testId: "automation-editor-header",
  };

  const rail = (
    <EditorRail objectNoun="automation" testId="automation-editor-rail">
      {/* Status */}
      <RailSection
        label="Status"
        summary={enabled ? "On" : "Off"}
        expanded={railOpen.status}
        onToggle={(v) => handleToggle("status", v)}
        testId="automation-rail-status"
      >
        <div className="flex items-center pt-2">
          <Switch checked={enabled} onCheckedChange={handleStatusToggle} />
        </div>
      </RailSection>

      {/* Ran */}
      {ranSummary && (
        <RailSection
          label="Ran"
          summary={null}
          expanded={railOpen.ran}
          onToggle={(v) => handleToggle("ran", v)}
          testId="automation-rail-ran"
        >
          <p className="text-xs leading-[1.55] text-ink">{ranSummary}</p>
        </RailSection>
      )}

      {/* Who it can reach */}
      {reachSummary && (
        <RailSection
          label="Who it can reach"
          summary={null}
          expanded={railOpen.reach}
          onToggle={(v) => handleToggle("reach", v)}
          testId="automation-rail-reach"
        >
          <p className="text-xs leading-[1.55] text-ink">{reachSummary}</p>
        </RailSection>
      )}

      {/* Never sends twice */}
      <RailSection
        label="Never sends twice"
        summary={null}
        expanded={railOpen.never}
        onToggle={(v) => handleToggle("never", v)}
        testId="automation-rail-never"
      >
        <p className="text-xs leading-[1.55] text-ink">One message per package, ever.</p>
      </RailSection>
    </EditorRail>
  );

  return (
    <EditorPage header={header} rail={rail} testId="automation-editor">
      {/* ────────────────────────────────────────────────────────────────────────────── */}
      {/* WHEN IT RUNS SECTION */}
      {/* ────────────────────────────────────────────────────────────────────────────── */}
        <EditorSection title="When it runs">
          {/* Watch for (static/read-only) */}
          <Field>
            <FieldLabel className="after:content-['*'] after:text-required after:ml-1">Watch for</FieldLabel>
            <FieldContent>
              <div className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink">
                {watchForLabel}
              </div>
            </FieldContent>
          </Field>

          {automation.schema?.fields &&
            automation.schema.fields.map((field) => (
              <div key={`trigger-${field.name}`}>
                {field.name === "trigger_value" && (
                  <Field>
                    <FieldLabel className="after:content-['*'] after:text-required after:ml-1">When it hits</FieldLabel>
                    <FieldContent>
                      <Input
                        type="number"
                        value={config.trigger_value || ""}
                        onChange={(e) => setConfig({ ...config, trigger_value: e.target.value })}
                        placeholder={field.placeholder || "0"}
                      />
                      {field.helper && <p className="mt-1.5 text-xs leading-1.5 text-ink-muted">{field.helper}</p>}
                    </FieldContent>
                  </Field>
                )}
                {field.name === "min_package_minor" && (
                  <Field>
                    <FieldLabel>Only for</FieldLabel>
                    <FieldContent>
                      <Input
                        type="number"
                        value={config.min_package_minor || ""}
                        onChange={(e) => setConfig({ ...config, min_package_minor: e.target.value })}
                        placeholder={field.placeholder || "500"}
                      />
                      {field.helper && <p className="mt-1.5 text-xs leading-1.5 text-ink-muted">{field.helper}</p>}
                    </FieldContent>
                  </Field>
                )}
              </div>
            ))}
        </EditorSection>

        {/* ────────────────────────────────────────────────────────────────────────────── */}
        {/* WHAT IT DOES SECTION */}
        {/* ────────────────────────────────────────────────────────────────────────────── */}
        <EditorSection title="What it does">
          {automation.schema?.fields &&
            automation.schema.fields.map((field) => (
              <div key={`config-${field.name}`}>
                {field.name === "channel" && (
                  <Field>
                    <FieldLabel>Tell the client</FieldLabel>
                    <FieldContent>
                      <NativeSelect
                        value={config.channel || ""}
                        onChange={(e) => setConfig({ ...config, channel: e.target.value })}
                      >
                        {(field.options || [
                          { value: "email", label: "Email" },
                          { value: "text_or_email", label: "Text or email" },
                        ]).map((opt) => (
                          <NativeSelectOption key={opt.value} value={opt.value}>
                            {opt.label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </FieldContent>
                  </Field>
                )}
                {field.name === "message" && (
                  <Field>
                    <FieldLabel>What it says</FieldLabel>
                    <FieldContent>
                      <textarea
                        className="min-h-20 w-full rounded-lg border border-line bg-canvas px-3 py-2 font-inherit text-sm text-ink placeholder-muted"
                        value={config.message || ""}
                        onChange={(e) => setConfig({ ...config, message: e.target.value })}
                        placeholder="Enter the message text..."
                      />
                      <DisabledWithReason
                        disabled={true}
                        reason="Writing help arrives with AI drafts"
                        label="✦ Write with AI"
                      />
                    </FieldContent>
                  </Field>
                )}
                {field.name === "tell_owner" && (
                  <Field>
                    <FieldLabel>Tell you too</FieldLabel>
                    <FieldContent>
                      <div className="flex gap-3 items-start">
                        <Switch
                          checked={config.tell_owner || false}
                          onCheckedChange={(checked) => setConfig({ ...config, tell_owner: checked })}
                        />
                        <div className="flex-1">
                          <span className="block text-sm text-ink">A task, so you can offer the next block</span>
                          <p className="mt-0.5 text-xs text-ink-muted">Rather than an email you'll skim.</p>
                        </div>
                      </div>
                    </FieldContent>
                  </Field>
                )}
                {field.name === "once_per" && (
                  <Field>
                    <FieldLabel>Never more than</FieldLabel>
                    <FieldContent>
                      <NativeSelect
                        value={config.once_per || ""}
                        onChange={(e) => setConfig({ ...config, once_per: e.target.value })}
                      >
                        {(field.options || [
                          { value: "once_per_package", label: "Once per package" },
                          { value: "once_per_client", label: "Once per client" },
                        ]).map((opt) => (
                          <NativeSelectOption key={opt.value} value={opt.value}>
                            {opt.label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      {field.helper && <p className="mt-1.5 text-xs leading-1.5 text-ink-muted">{field.helper}</p>}
                    </FieldContent>
                  </Field>
                )}
              </div>
            ))}
        </EditorSection>

        {/* ────────────────────────────────────────────────────────────────────────────── */}
        {/* WHAT IT HAS DONE SECTION */}
        {/* ────────────────────────────────────────────────────────────────────────────── */}
        <EditorSection title="What it has done">
          {automation.runs && automation.runs.length > 0 ? (
            <AutomationEditRunsTable automation={automation} />
          ) : (
            <ScreenState
              phase="empty"
              empty={{
                kind: "first-run",
                headline: `Nothing yet — it runs when ${triggerDescription}`,
              }}
            />
          )}
        </EditorSection>
    </EditorPage>
  );
}
