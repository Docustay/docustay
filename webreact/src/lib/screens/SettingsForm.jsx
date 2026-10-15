import { useState, useEffect } from "react";
import { api } from "@/lib/api.js";
import { saveSettings } from "@/lib/settings/saveSettings.js";
import * as AlertDialog from "@/lib/components/ui/alert-dialog";
import { Button } from "@/lib/components/ui/button.jsx";
import { Field, FieldDescription } from "@/lib/components/ui/field.jsx";
import SettingsFormConfirm1Confirm from "./SettingsFormConfirm1Confirm.jsx";
import SettingsSaveError from "./settings/SettingsSaveError.jsx";
import ReachConfirm from "@/lib/settings/ReachConfirm.jsx";
import LastChanged from "@/lib/shared/LastChanged.jsx";
import LogoUploader from "./LogoUploader.jsx";

const isUnset = (v) => v === null || v === undefined || v === "";

export default function SettingsForm({ data = null, onSaved = null, onValue = null, canSave = true }) {
  const fields = data?.fields ?? [];

  let draft = useState({})[1];
  const [draftState, setDraftState] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [reachConfirm, setReachConfirm] = useState(null);
  const [reachConfirmError, setReachConfirmError] = useState(null);

  const canWrite = data?.writable === true && typeof api.setSetting === "function" && canSave;

  const valueOf = (f) => (draftState[f.key] !== undefined ? draftState[f.key] : (f.value ?? ""));

  let slugCheck = useState(null)[1];
  const [slugCheckState, setSlugCheckState] = useState(null);
  let slugTimer;

  const checkSlugSoon = (value) => {
    clearTimeout(slugTimer);
    setSlugCheckState("checking");
    slugTimer = setTimeout(async () => {
      try {
        const result = await api.checkSlug(value);
        setSlugCheckState(result);
      } catch (err) {
        setSlugCheckState({
          available: false,
          reason: err?.message ?? "could not check",
        });
      }
    }, 350);
  };

  const submitSlug = async (f) => {
    setBusy(f.key);
    setError(null);
    setSaved(null);
    try {
      const res = await api.setSlug({
        slug: String(valueOf(f)).trim().toLowerCase(),
      });
      if (res?.changed && res.url) {
        window.location.assign(res.url);
        return;
      }
      setSaved({ key: f.key, value: res?.slug });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const submit = async (f) => {
    if (f.type === "slug") return submitSlug(f);
    setBusy(f.key);
    setError(null);
    setSaved(null);
    try {
      const raw = valueOf(f);
      const value = f.type === "number" ? Number(raw) : raw;
      const res = await saveSettings([{ key: f.key, value }]);
      if (!res.ok) {
        if (res.kind === "refused") {
          setError({ message: "", rows: res.rows, reference: res.reference, fields });
        } else if (res.kind === "reach" && res.reach?.length > 0) {
          setReachConfirm({
            reachData: res.reach[0],
            field: f,
            changes: [{ key: f.key, value }],
          });
        } else {
          throw new Error(`Unexpected response kind: ${res.kind}`);
        }
        return;
      }
      const stored = res.rows?.[0]?.value ?? value;
      setSaved({ key: f.key, value: stored });
      onValue?.(f.key, stored);
      onSaved?.(f.key, stored);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      className="space-y-6"
      data-testid="settings-form"
      data-path={data?.path}
      data-blocked={data?.blocked ? "true" : undefined}
    >
      <h1 className="text-2xl font-semibold">{data?.title}</h1>
      {data?.lastChanged && <LastChanged by={data.lastChanged.by} at={data.lastChanged.at} />}

      {data?.intro && <p className="text-sm text-muted-foreground">{data.intro}</p>}

      {data?.notice && (
        <p
          className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
          data-testid="settings-notice"
          data-blocked={data?.blocked ? "true" : "false"}
        >
          {data.notice}
        </p>
      )}

      {(data?.readOnly?.length ?? 0) > 0 && (
        <dl className="space-y-3" data-testid="settings-readonly">
          {data.readOnly.map((r) => (
            <div key={r.label} className="flex gap-4">
              <dt className="w-48 font-medium">{r.label}</dt>
              <dd className="flex-1">
                {isUnset(r.value) ? <em>Not set</em> : String(r.value)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="space-y-6">
        {fields.map((f) => (
          <div key={f.key} data-testid={`field-${f.key}`}>
            <div className="mb-3 flex flex-col gap-2">
              <label htmlFor={`f-${f.key}`} className="font-medium">
                {f.label}
              </label>
              {f.type === "select" ? (
                <select
                  id={`f-${f.key}`}
                  value={valueOf(f)}
                  onChange={(e) =>
                    setDraftState({ ...draftState, [f.key]: e.currentTarget.value })
                  }
                  className="rounded-lg border border-input bg-background px-3 py-2"
                >
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : f.type === "slug" ? (
                <div className="flex gap-0">
                  <input
                    id={`f-${f.key}`}
                    type="text"
                    autoComplete="off"
                    spellCheck="false"
                    value={valueOf(f)}
                    onChange={(e) => {
                      const v = e.currentTarget.value.toLowerCase();
                      setDraftState({ ...draftState, [f.key]: v });
                      checkSlugSoon(v);
                    }}
                    className="flex-1 rounded-l-lg border border-input bg-background px-3 py-2"
                  />
                  <span className="flex items-center rounded-r-lg border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">
                    .{f.domain}
                  </span>
                </div>
              ) : (
                <input
                  id={`f-${f.key}`}
                  type={f.type === "number" ? "number" : "text"}
                  value={valueOf(f)}
                  onChange={(e) =>
                    setDraftState({ ...draftState, [f.key]: e.currentTarget.value })
                  }
                  className="rounded-lg border border-input bg-background px-3 py-2"
                />
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{f.help}</p>

              {f.type === "slug" && draftState[f.key] !== undefined && (
                <p
                  className={`text-sm ${
                    slugCheckState &&
                    slugCheckState !== "checking" &&
                    slugCheckState.available &&
                    !slugCheckState.current
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                  data-testid="slug-status"
                  data-ok={
                    slugCheckState &&
                    slugCheckState !== "checking" &&
                    slugCheckState.available &&
                    !slugCheckState.current
                      ? "true"
                      : "false"
                  }
                >
                  {slugCheckState === "checking"
                    ? "Checking…"
                    : slugCheckState?.current
                      ? "That's your current acronym."
                      : slugCheckState?.available
                        ? `${draftState[f.key]}.${f.domain} is available.`
                        : slugCheckState?.reason}
                </p>
              )}

              <p className="text-sm text-muted-foreground" data-testid={`stored-${f.key}`}>
                {isUnset(f.value) ? (
                  <em>Not set — this practice has never set a value here.</em>
                ) : (
                  <>
                    Stored: <code>{String(f.value)}</code>
                  </>
                )}
              </p>

              {canWrite ? (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  data-testid={`save-${f.key}`}
                  disabled={
                    busy === f.key ||
                    (f.type === "slug" &&
                      draftState[f.key] !== undefined &&
                      !(
                        slugCheckState &&
                        slugCheckState !== "checking" &&
                        slugCheckState.available &&
                        !slugCheckState.current
                      ))
                  }
                  onClick={() =>
                    f.confirm ? setConfirming(f) : submit(f)
                  }
                >
                  {busy === f.key ? "Saving…" : "Save"}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid={`unwritable-${f.key}`}>
                  Not saveable from here yet: <code>POST /api/settings</code> exists on the server
                  and this screen has no method to reach it.
                </p>
              )}

              {saved?.key === f.key && (
                <p className="text-sm text-green-600" data-testid={`saved-${f.key}`}>
                  Saved. The server stored <code>{String(saved.value)}</code>.
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {(data?.logos ?? []).map((logo) => (
        <LogoUploader
          key={logo.kind}
          logo={logo}
          onSaved={(k, v) => onSaved?.(`logo.${k}`, v)}
        />
      ))}

      <SettingsFormConfirm1Confirm
        open={confirming !== null}
        onOpenChange={(o) => {
          if (!o) setConfirming(null);
        }}
        confirming={confirming}
        submit={() => {
          const f = confirming;
          setConfirming(null);
          if (f) submit(f);
        }}
      />

      {error && error.rows ? (
        <SettingsSaveError
          rows={error.rows}
          reference={error.reference}
          fields={error.fields}
          onRetry={() => {
            setError(null);
          }}
          onRevert={() => {
            error?.rows?.forEach((r) => {
              if (r.state !== "saved")
                setDraftState((d) => {
                  const next = { ...d };
                  delete next[r.key];
                  return next;
                });
            });
            setError(null);
          }}
        />
      ) : error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          data-testid="settings-error"
          role="alert"
        >
          {error.message ?? String(error)}
        </p>
      ) : null}

      {reachConfirm && (
        <ReachConfirm
          reach={reachConfirm.reachData}
          label={reachConfirm.field.label}
          onKeep={() => {
            setReachConfirm(null);
            setReachConfirmError(null);
          }}
          onConfirm={async (tell) => {
            const { changes } = reachConfirm;
            const confirm = { reach: true };
            if (tell?.message) confirm.tell = tell;
            setBusy(reachConfirm.field.key);
            setReachConfirmError(null);
            try {
              const res = await saveSettings(changes, { confirm });
              if (res.ok) {
                const stored = res.rows?.[0]?.value ?? changes[0]?.value;
                setSaved({ key: reachConfirm.field.key, value: stored });
                onValue?.(reachConfirm.field.key, stored);
                onSaved?.(reachConfirm.field.key, stored);
                setReachConfirm(null);
              } else if (res.kind === "refused") {
                setError({ message: "", rows: res.rows, reference: res.reference, fields });
                setReachConfirm(null);
              }
            } catch (err) {
              setReachConfirmError(err?.message ?? String(err));
            } finally {
              setBusy(null);
            }
          }}
          busy={busy === reachConfirm.field.key}
          error={reachConfirmError}
        />
      )}
    </section>
  );
}
