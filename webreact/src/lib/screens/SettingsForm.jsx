import { useState, useEffect } from "react";
import { api } from "@/lib/api.js";
import { saveSettings } from "@/lib/settings/saveSettings.js";
import { plainReason } from "@/lib/settings/plainReason.js";
import * as AlertDialog from "@/lib/components/ui/alert-dialog";
import { Button } from "@/lib/components/ui/button.jsx";
import { Field, FieldDescription } from "@/lib/components/ui/field.jsx";
import SettingsFormConfirm1Confirm from "./SettingsFormConfirm1Confirm.jsx";
import SettingsSaveError from "./settings/SettingsSaveError.jsx";
import ReachConfirm from "@/lib/settings/ReachConfirm.jsx";
import LastChanged from "@/lib/shared/LastChanged.jsx";
import LogoUploader from "./LogoUploader.jsx";

const isUnset = (v) => v === null || v === undefined || v === "";

const capitalised = (t) => (t ? String(t).charAt(0).toUpperCase() + String(t).slice(1) : t);

const digitCount = (v) => (String(v).match(/\d/g) ?? []).length;

// Said before anything is sent (and before the "are you sure?" dialog), so an empty or malformed value never reaches the confirm step.
// Returns plain words for the person, or null when the value is fine. The server checks the same rules again.
function checkValue(f, value) {
  const text = typeof value === "string" ? value.trim() : value;
  if (f.key === "practice.name") {
    if (text === "") return "Enter a practice name.";
    if (String(value).length > 120) return "Use 120 characters or fewer.";
  }
  if (f.kind === "phone") {
    if (text === "") return "Enter a phone number people can call.";
    if (!/^[\d\s()+-]+$/.test(String(value))) return "Use digits, spaces, brackets, - and + only.";
    if (digitCount(value) < 7 || digitCount(value) > 15) return "Enter a phone number with 7 to 15 digits.";
  }
  return null;
}

export default function SettingsForm({ data = null, onSaved = null, onValue = null, canSave = true }) {
  const fields = data?.fields ?? [];

  let draft = useState({})[1];
  const [draftState, setDraftState] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [reachConfirm, setReachConfirm] = useState(null);
  const [reachConfirmError, setReachConfirmError] = useState(null);

  const canWrite = data?.writable === true && typeof api.setSetting === "function" && canSave;

  const valueOf = (f) => (draftState[f.key] !== undefined ? draftState[f.key] : (f.value ?? ""));

  // What to say under a field: a check made here before sending, else the server's refusal for that key.
  const errorFor = (f) => {
    if (fieldErrors[f.key]) return fieldErrors[f.key];
    const refused = error?.rows?.find((r) => r.key === f.key && r.state === "refused");
    return refused ? plainReason(f, refused.reason) : null;
  };

  const edit = (f, value) => {
    setDraftState({ ...draftState, [f.key]: value });
    if (fieldErrors[f.key]) setFieldErrors(({ [f.key]: _gone, ...rest }) => rest);
    if (error?.rows?.some((r) => r.key === f.key)) setError(null);
  };

  // Check first; only a value that passes goes on to the confirm dialog or the save.
  const trySave = (f) => {
    const problem = checkValue(f, valueOf(f));
    if (problem) {
      setFieldErrors((e) => ({ ...e, [f.key]: problem }));
      return;
    }
    setFieldErrors(({ [f.key]: _gone, ...rest }) => rest);
    if (f.confirm) setConfirming(f);
    else submit(f);
  };

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
      const problem = f.type === "slug" ? null : checkValue(f, raw);
      if (problem) {
        setFieldErrors((e) => ({ ...e, [f.key]: problem }));
        return;
      }
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
                  onChange={(e) => edit(f, e.currentTarget.value)}
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
                      edit(f, v);
                      checkSlugSoon(v);
                    }}
                    className="min-w-0 flex-1 rounded-l-lg border border-input bg-background px-3 py-2"
                  />
                  {/* F170: at phone width the input shrinks (min-w-0) so the domain suffix stays on screen */}
                  <span className="flex shrink-0 items-center rounded-r-lg border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">
                    .{f.domain}
                  </span>
                </div>
              ) : (
                <input
                  id={`f-${f.key}`}
                  type={f.type === "number" ? "number" : f.kind === "phone" ? "tel" : "text"}
                  maxLength={f.maxLength}
                  value={valueOf(f)}
                  aria-invalid={errorFor(f) ? "true" : undefined}
                  aria-describedby={errorFor(f) ? `e-${f.key}` : undefined}
                  onChange={(e) => edit(f, e.currentTarget.value)}
                  className="rounded-lg border border-input bg-background px-3 py-2"
                />
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{f.help}</p>

              {errorFor(f) && (
                <p id={`e-${f.key}`} className="text-sm font-medium text-bad" data-testid={`field-error-${f.key}`} role="alert">
                  {errorFor(f)}
                </p>
              )}

              {f.type === "slug" && draftState[f.key] !== undefined && (
                <p
                  className={`text-sm ${
                    slugCheckState &&
                    slugCheckState !== "checking" &&
                    slugCheckState.available &&
                    !slugCheckState.current
                      ? "text-ok"
                      : "text-bad font-medium"
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
                      ? "That's your current web address."
                      : slugCheckState?.available
                        ? `${draftState[f.key]}.${f.domain} is available.`
                        : capitalised(slugCheckState?.reason)}
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
                  onClick={() => (f.type === "slug" ? (f.confirm ? setConfirming(f) : submit(f)) : trySave(f))}
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
          title={data?.title}
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
