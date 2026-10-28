import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api.ts";
import { toast, toastError, useApp } from "../lib/store.ts";
import { Seg } from "../components/ui.tsx";

export function SettingsPage() {
  const settings = useApp((s) => s.settings);
  const units = useApp((s) => s.units);
  const setUnits = useApp((s) => s.setUnits);
  const loadSettings = useApp((s) => s.loadSettings);
  const [key, setKey] = useState("");
  const [pid, setPid] = useState("");
  const [secret, setSecret] = useState("");
  const [params] = useSearchParams();

  useEffect(() => {
    const p = params.get("pinterest");
    if (p === "error") toast(`Pinterest: ${params.get("message") ?? "connection failed"}`, "error");
    if (p === "denied") toast("Pinterest access was not granted", "error");
  }, [params]);

  const save = async (body: Record<string, unknown>, msg: string) => {
    try {
      await api.updateSettings(body);
      await loadSettings();
      toast(msg);
    } catch (err) {
      toastError(err);
    }
  };

  if (!settings) return <div className="page" />;

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Settings</div>
          <h1>Preferences & connections</h1>
        </div>
      </div>

      <div className="panel">
        <h3>Units</h3>
        <p className="muted small" style={{ marginTop: -4 }}>
          Everything is stored in centimeters; this only changes how lengths are shown and typed. You can always type either unit (e.g. 8'6" or 2.6m).
        </p>
        <Seg
          value={units}
          onChange={setUnits}
          options={[
            { value: "metric", label: "Metric (cm, m)" },
            { value: "imperial", label: "Imperial (ft, in)" },
          ]}
        />
      </div>

      <div className="panel">
        <h3>Claude</h3>
        <p className="muted small" style={{ marginTop: -4 }}>
          Used to model pieces from photos, apply text edits, draft room layouts, summarize boards and match pieces. Model: <code>{settings.model}</code>.
        </p>
        <div className="row" style={{ marginBottom: 10 }}>
          {settings.hasAnthropicKey ? (
            <span className="chip ok">Key set {settings.anthropicKeySource === "env" ? "(from ANTHROPIC_API_KEY)" : "(saved in this app)"}</span>
          ) : (
            <span className="chip danger">No key</span>
          )}
        </div>
        <div className="row">
          <input className="input" type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
          <button
            className="btn primary"
            disabled={!key.trim()}
            onClick={() => {
              save({ anthropicKey: key }, "API key saved");
              setKey("");
            }}
          >
            Save
          </button>
          {settings.anthropicKeySource === "settings" && (
            <button className="btn" onClick={() => save({ anthropicKey: null }, "API key removed")}>
              Remove
            </button>
          )}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Saved keys are stored in plain text in the local database (data/studio.db). An environment variable is used when no key is saved here.
        </p>
      </div>

      <div className="panel">
        <h3>Pinterest</h3>
        <p className="muted small" style={{ marginTop: -4 }}>
          Board import uses Pinterest's API v5 and your own developer app. Create one at{" "}
          <a href="https://developers.pinterest.com/apps/" target="_blank" rel="noreferrer">
            developers.pinterest.com/apps
          </a>{" "}
          and register this redirect URI: <code>{settings.pinterestRedirectUri}</code>
        </p>
        <div className="grid-2">
          <div className="field">
            <label>App ID</label>
            <input className="input" value={pid} onChange={(e) => setPid(e.target.value)} placeholder={settings.pinterestConfigured ? "•••• saved" : ""} />
          </div>
          <div className="field">
            <label>App secret</label>
            <input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={settings.pinterestConfigured ? "•••• saved" : ""} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn"
            disabled={!pid.trim() || !secret.trim()}
            onClick={() => {
              save({ pinterestClientId: pid, pinterestClientSecret: secret }, "Pinterest app saved");
              setPid("");
              setSecret("");
            }}
          >
            Save app
          </button>
          <div className="spacer" />
          {settings.pinterestConnected ? (
            <>
              <span className="chip ok">Connected</span>
              <button className="btn" onClick={() => api.pinterestDisconnect().then(loadSettings).catch(toastError)}>
                Disconnect
              </button>
            </>
          ) : (
            <a className={`btn primary ${settings.pinterestConfigured ? "" : "disabled"}`} href={settings.pinterestConfigured ? "/api/pinterest/connect" : undefined} aria-disabled={!settings.pinterestConfigured}>
              Connect Pinterest
            </a>
          )}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Without an app you can still paste pin links or drop images into any collection.
        </p>
      </div>
    </div>
  );
}
