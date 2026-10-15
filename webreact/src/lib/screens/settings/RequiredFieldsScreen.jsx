// ═══════════════════════════════════════════════════════════════════════════════════════════════
// C1.9 — RequiredFieldsScreen. Allows practice admins to configure which fields are required on create forms.
// Ported from webui/src/lib/screens/settings/RequiredFieldsScreen.svelte
// Props: {}
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { Alert, AlertTitle, AlertDescription } from "@/lib/components/ui/alert.jsx";

export default function RequiredFieldsScreen() {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({
    rules: {},
    retro: null,
    lastChanged: null,
  });
  const [modifications, setModifications] = useState({});

  // ★ Load the configuration on mount
  const loadConfig = async () => {
    try {
      setPhase("loading");
      setError(null);
      const data = await api.requiredFields();
      setConfig({
        rules: data?.rules || {},
        retro: data?.retro || null,
        lastChanged: data?.lastChanged || null,
      });
      setModifications({});
      setPhase("ready");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      setPhase("error");
    }
  };

  // ★ Initialize on component mount
  useEffect(() => {
    loadConfig();
  }, []);

  // ★ Toggle a field's required status
  const toggleField = (type, field) => {
    const required = config.rules[type]?.required || [];
    const idx = required.indexOf(field);
    if (idx >= 0) {
      required.splice(idx, 1);
    } else {
      required.push(field);
    }
    setConfig({
      ...config,
      rules: {
        ...config.rules,
        [type]: {
          ...config.rules[type],
          required: [...required],
        },
      },
    });
    setModifications({
      ...modifications,
      [type]: required,
    });
  };

  // ★ Save the configuration
  const save = async () => {
    if (saving || Object.keys(modifications).length === 0) return;
    setSaving(true);
    setError(null);

    try {
      const payload = {};
      for (const type of Object.keys(modifications)) {
        payload[type] = config.rules[type]?.required || [];
      }

      await api.post("/api/settings/fields-required", payload);

      // Reload the configuration
      await loadConfig();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setSaving(false);
    }
  };

  // ★ Determine the plural form for record type
  const pluralize = (type) => {
    const plurals = {
      person: "clients",
      account: "accounts",
      booking: "sessions",
      service: "services",
      invoice: "invoices",
      document: "documents",
    };
    return plurals[type] || type + "s";
  };

  return (
    <ScreenState phase={phase} error={error} subject="Required fields">
      {config.rules && (
        <div className="px-[30px] pb-[70px] pt-[26px]">
          <div className="mb-[26px]">
            <div>
              <h1 className="m-0 mb-2 text-page-title font-medium text-ink" style={{ letterSpacing: "-0.01em" }}>What you have to fill in</h1>
              <p className="m-0 text-control text-mute">Make a field required and nobody can save without it — including you.</p>
            </div>
          </div>

          {["person", "booking", "service"].map((recordType) => {
            const typeConfig = config.rules[recordType];
            const typeFields = typeConfig?.fields || [];
            if (typeFields.length === 0) return null;

            return (
              <div key={recordType} className="bg-surface border border-line rounded-card mb-[18px]">
                <div className="flex items-center gap-[11px] px-[18px] py-[15px] border-b border-hair">
                  <h2 className="m-0 text-heading font-medium text-ink flex-1">
                    {recordType === "person" ? "On a client" : recordType === "booking" ? "On a session" : "On a service"}
                  </h2>
                  {config.lastChanged && recordType === "person" && (
                    <div className="text-caption text-mute">
                      Changed by the maintainer, 9 September
                    </div>
                  )}
                </div>
                <div className="px-[18px] py-[4px] pb-[10px]">
                  {typeFields.map((fieldData) => (
                    <div key={fieldData.field} className="flex items-start gap-[18px] py-[15px] border-b border-hair last:border-b-0">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-field text-ink block">{fieldData.label}</div>
                        <div className="text-meta text-mute block mt-1 leading-[1.55]">{fieldData.reason}</div>
                      </div>
                      <div className="flex items-center gap-[12px] flex-none">
                        {fieldData.always ? (
                          <StatusBadge label="Always" tone="neutral" />
                        ) : (
                          <Switch
                            checked={fieldData.required}
                            onCheckedChange={() => toggleField(recordType, fieldData.field)}
                            disabled={saving}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {config.retro && config.retro.missing > 0 && (
            <div className="mb-[26px]">
              <Alert className="bg-warn-soft rounded-card border-0 px-[16px] py-[14px]">
                <AlertTitle className="font-medium text-control text-warn m-0 mb-1">Worth knowing.</AlertTitle>
                <AlertDescription className="text-control text-warn leading-[1.6] m-0">
                  Turning something on doesn't break what's already saved. {config.retro.missing} existing {pluralize(config.retro.type)} have no {config.retro.field.replace(/_/g, " ")}; they stay as they are until someone edits them, and then it's asked for.
                </AlertDescription>
              </Alert>
            </div>
          )}

          <div className="flex justify-end gap-[10px] pt-[26px] border-t border-hair">
            <button
              className="px-[17px] h-[38px] rounded-lg border border-line bg-surface text-ink-2 text-ui font-medium cursor-pointer transition-all hover:not-disabled:border-brand hover:not-disabled:bg-brand-soft hover:not-disabled:text-brand disabled:opacity-50 disabled:cursor-not-allowed data-[primary]:bg-brand data-[primary]:text-white data-[primary]:border-brand data-[primary]:hover:not-disabled:bg-brand data-[primary]:hover:not-disabled:border-brand bg-brand text-white border-brand hover:not-disabled:bg-brand hover:not-disabled:border-brand"
              onClick={save}
              disabled={saving || Object.keys(modifications).length === 0}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </ScreenState>
  );
}
