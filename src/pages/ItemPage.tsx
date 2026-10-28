import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ITEM_CATEGORIES, MATERIAL_KINDS, type Dimensions, type LibraryItem, type ParametricModel } from "../../shared/types.ts";
import { scaleModelTo, normalizeModel } from "../../shared/modelOps.ts";
import { toDisplay, unitLabel } from "../../shared/units.ts";
import { api } from "../lib/api.ts";
import { toast, toastError, useApp } from "../lib/store.ts";
import { Icon, ImageDrop, LengthInput, Spinner, categoryLabel, useInterval, useLen } from "../components/ui.tsx";
import { PhotoThumb } from "../components/ItemCard.tsx";
import { ItemViewer } from "../three/ItemViewer.tsx";

const EDIT_SUGGESTIONS = [
  "Make the legs thinner and tapered",
  "Change the upholstery to dark green velvet",
  "Make the arms lower and more rounded",
  "Use light oak instead of walnut",
  "Add a lumbar pillow",
];

export function ItemPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const upsert = useApp((s) => s.upsertItem);
  const removeFromStore = useApp((s) => s.removeItem);
  const settings = useApp((s) => s.settings);
  const units = useApp((s) => s.units);
  const len = useLen();
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [draft, setDraft] = useState<ParametricModel | null>(null);
  const [lock, setLock] = useState(false);
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [hint, setHint] = useState("");
  const [showDims, setShowDims] = useState(true);
  const [tab, setTab] = useState<"shape" | "materials" | "parts" | "history">("shape");

  const sync = (it: LibraryItem) => {
    setItem(it);
    upsert(it);
  };

  useEffect(() => {
    api
      .item(id)
      .then((it) => {
        sync(it);
        setDraft(null);
      })
      .catch(toastError);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll while Claude works; show the error when it finishes badly
  useInterval(
    () =>
      api.item(id).then((it) => {
        if (it.status !== "generating") {
          setDraft(null);
          if (it.error) toast(it.error, "error");
          else toast("Model updated");
        }
        sync(it);
      }),
    item?.status === "generating" ? 2000 : null,
  );

  const saved = item?.model ?? null;
  const model = draft ?? saved;
  const dirty = draft !== null;

  const scaleTo = (dims: Partial<Dimensions>) => {
    if (!saved || !model) return;
    let target = { ...model.dims, ...dims };
    if (lock) {
      const key = (Object.keys(dims) as (keyof Dimensions)[])[0];
      const f = (dims[key] ?? model.dims[key]) / model.dims[key];
      target = { w: model.dims.w * f, d: model.dims.d * f, h: model.dims.h * f };
    }
    // Scale from the saved model each time so repeated drags don't accumulate error
    setDraft({ ...scaleModelTo(saved, target), materials: model.materials });
  };

  const editMaterial = (mid: string, patch: Partial<ParametricModel["materials"][number]>) => {
    if (!model) return;
    setDraft({ ...model, materials: model.materials.map((m) => (m.id === mid ? { ...m, ...patch } : m)) });
  };

  const editPart = (pid: string, patch: Partial<ParametricModel["parts"][number]>) => {
    if (!model) return;
    setDraft(normalizeModel({ ...model, parts: model.parts.map((p) => (p.id === pid ? { ...p, ...patch } : p)) }));
  };

  async function save() {
    if (!item || !draft) return;
    try {
      sync(await api.updateItem(item.id, { model: draft }));
      setDraft(null);
      toast("Saved as a new version");
    } catch (err) {
      toastError(err);
    }
  }

  async function run(fn: () => Promise<LibraryItem>) {
    try {
      setDraft(null);
      sync(await fn());
    } catch (err) {
      toastError(err);
    }
  }

  const busy = item?.status === "generating";
  const photos = item?.photoIds ?? [];

  const ranges = useMemo(() => {
    const d = saved?.dims ?? { w: 100, d: 100, h: 100 };
    return { w: [Math.max(2, d.w * 0.3), d.w * 2.5], d: [Math.max(1, d.d * 0.3), d.d * 2.5], h: [Math.max(1, d.h * 0.3), d.h * 2.5] };
  }, [saved]);

  if (!item) {
    return (
      <div className="page">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="detail">
      <div className="viewer">
        {model ? (
          <ItemViewer model={model} showDims={showDims} highlightPartId={selectedPart} />
        ) : (
          <div className="gen-banner">{!busy && <span className="muted">No model yet</span>}</div>
        )}
        <div className="viewer-overlay">
          <Link to="/library" className="btn sm">
            <Icon name="back" size={14} /> Library
          </Link>
          <div className="spacer" />
          <label className="btn sm" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={showDims} onChange={(e) => setShowDims(e.target.checked)} /> Dimensions
          </label>
        </div>
        {busy && (
          <div className="gen-banner">
            <div className="card">
              <Spinner />
              <div>
                <strong>Claude is modeling this piece</strong>
                <div className="muted small">This usually takes 20 to 90 seconds.</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <aside className="side">
        <div className="stack">
          <div>
            <input
              className="input"
              style={{ fontFamily: "var(--font-serif)", fontSize: 22, border: 0, background: "transparent", padding: 0, boxShadow: "none" }}
              value={item.name}
              onChange={(e) => setItem({ ...item, name: e.target.value })}
              onBlur={() => api.updateItem(item.id, { name: item.name }).then(sync).catch(toastError)}
            />
            <div className="row" style={{ marginTop: 6 }}>
              <select
                className="select"
                style={{ width: "auto" }}
                value={item.category}
                onChange={(e) => api.updateItem(item.id, { category: e.target.value }).then(sync).catch(toastError)}
              >
                {ITEM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
              {model && (
                <span className="muted small">
                  {len(model.dims.w)} × {len(model.dims.d)} × {len(model.dims.h)}
                </span>
              )}
            </div>
            {item.error && !busy && <div className="error-box" style={{ marginTop: 10 }}>{item.error}</div>}
          </div>

          {dirty && (
            <div className="note-box row">
              <span className="grow">Unsaved adjustments</span>
              <div className="spacer" />
              <button className="btn sm ghost" onClick={() => setDraft(null)}>
                Discard
              </button>
              <button className="btn sm primary" onClick={save}>
                Save version
              </button>
            </div>
          )}

          {/* Text-driven changes */}
          <div className="panel">
            <h3>Change this about the rendering</h3>
            <textarea
              className="textarea"
              placeholder="e.g. make the seat deeper and the cushions puffier"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && instruction.trim()) {
                  run(() => api.editItem(item.id, instruction));
                  setInstruction("");
                }
              }}
            />
            <div className="row wrap" style={{ marginTop: 8 }}>
              {EDIT_SUGGESTIONS.slice(0, 3).map((s) => (
                <button key={s} className="chip" style={{ border: 0, cursor: "pointer" }} onClick={() => setInstruction(s)}>
                  {s}
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <span className="muted small">{settings?.hasAnthropicKey ? "Uses Claude" : "Needs an API key (Settings)"}</span>
              <div className="spacer" />
              <button
                className="btn primary sm"
                disabled={busy || !instruction.trim() || !settings?.hasAnthropicKey || !saved}
                onClick={() => {
                  run(() => api.editItem(item.id, instruction));
                  setInstruction("");
                }}
              >
                <Icon name="sparkle" size={14} /> Apply change
              </button>
            </div>
          </div>

          <div className="seg" style={{ alignSelf: "flex-start" }}>
            {(["shape", "materials", "parts", "history"] as const).map((t) => (
              <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {tab === "shape" && model && (
            <>
              <div className="panel">
                <div className="row" style={{ marginBottom: 10 }}>
                  <h3 style={{ margin: 0 }}>Scale</h3>
                  <div className="spacer" />
                  <label className="small row" style={{ gap: 4 }}>
                    <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Keep proportions
                  </label>
                </div>
                <div className="stack" style={{ gap: 8 }}>
                  {(["w", "d", "h"] as const).map((k) => (
                    <div className="slider-row" key={k}>
                      <span className="small">{{ w: "Width", d: "Depth", h: "Height" }[k]}</span>
                      <input
                        type="range"
                        min={ranges[k][0]}
                        max={ranges[k][1]}
                        step={0.5}
                        value={model.dims[k]}
                        onChange={(e) => scaleTo({ [k]: Number(e.target.value) })}
                      />
                      <LengthInput className="input sm" value={model.dims[k]} onChange={(v) => v && scaleTo({ [k]: v })} />
                    </div>
                  ))}
                </div>
                <p className="muted small" style={{ marginBottom: 0 }}>
                  Dials stretch the model. Save to keep the result as a version.
                </p>
              </div>

              <div className="panel">
                <h3>Real dimensions</h3>
                <p className="muted small" style={{ marginTop: -4 }}>
                  Enter measured dimensions and the model snaps to them, now and after every regeneration.
                </p>
                <div className="grid-3">
                  {(["w", "d", "h"] as const).map((k) => (
                    <LengthInput
                      key={k}
                      value={item.knownDims[k]}
                      placeholder={k.toUpperCase()}
                      onChange={(v) => api.updateItem(item.id, { knownDims: { ...item.knownDims, [k]: v } }).then(sync).catch(toastError)}
                    />
                  ))}
                </div>
              </div>

              <div className="panel">
                <h3>Regenerate</h3>
                <input
                  className="input"
                  placeholder="Optional guidance, e.g. 'it's a modular sectional'"
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                />
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn sm" disabled={busy} onClick={() => run(() => api.regenerate(item.id, { mode: "template" }))}>
                    Reset to template
                  </button>
                  <div className="spacer" />
                  <button
                    className="btn sm accent"
                    disabled={busy || !settings?.hasAnthropicKey}
                    onClick={() => run(() => api.regenerate(item.id, { mode: "claude", hint }))}
                  >
                    <Icon name="refresh" size={14} /> Regenerate
                  </button>
                </div>
              </div>
            </>
          )}

          {tab === "materials" && model && (
            <div className="panel stack">
              {model.materials.map((m) => (
                <div key={m.id} className="stack" style={{ gap: 6 }}>
                  <div className="row">
                    <span className="swatch" style={{ background: m.color }}>
                      <input type="color" value={m.color} onChange={(e) => editMaterial(m.id, { color: e.target.value })} aria-label={`${m.name} color`} />
                    </span>
                    <input className="input sm" value={m.name} onChange={(e) => editMaterial(m.id, { name: e.target.value })} />
                    <select className="select" style={{ width: 110, padding: "4px 6px" }} value={m.kind} onChange={(e) => editMaterial(m.id, { kind: e.target.value as typeof m.kind })}>
                      {MATERIAL_KINDS.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                  <div className="slider-row">
                    <span className="small muted">Sheen</span>
                    <input type="range" min={0} max={1} step={0.01} value={1 - m.roughness} onChange={(e) => editMaterial(m.id, { roughness: 1 - Number(e.target.value) })} />
                    <span className="small muted">{Math.round((1 - m.roughness) * 100)}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "parts" && model && (
            <div className="panel">
              <div className="parts-list">
                {model.parts.map((p) => (
                  <div key={p.id} className={`part ${selectedPart === p.id ? "on" : ""}`} onClick={() => setSelectedPart(selectedPart === p.id ? null : p.id)}>
                    <span className="grow">{p.name}</span>
                    <span className="muted">{p.shape}</span>
                  </div>
                ))}
              </div>
              {selectedPart &&
                (() => {
                  const p = model.parts.find((x) => x.id === selectedPart);
                  if (!p) return null;
                  const num = (v: number) => toDisplay(v, units);
                  const from = (v: number) => (units === "imperial" ? v * 2.54 : v);
                  return (
                    <div className="stack" style={{ marginTop: 12, gap: 8 }}>
                      <div className="divider" style={{ margin: 0 }} />
                      <span className="label">
                        {p.name} ({unitLabel(units)})
                      </span>
                      {(["size", "position"] as const).map((key) => (
                        <div key={key} className="grid-3">
                          {(["x", "y", "z"] as const).map((ax) => (
                            <label key={ax} className="small muted">
                              {key} {ax}
                              <input
                                className="input sm"
                                type="number"
                                value={num(p[key][ax])}
                                onChange={(e) => editPart(p.id, { [key]: { ...p[key], [ax]: from(Number(e.target.value)) } })}
                              />
                            </label>
                          ))}
                        </div>
                      ))}
                      <div className="row">
                        <select className="select" value={p.materialId} onChange={(e) => editPart(p.id, { materialId: e.target.value })}>
                          {model.materials.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn sm danger"
                          onClick={() => {
                            setDraft(normalizeModel({ ...model, parts: model.parts.filter((x) => x.id !== p.id) }));
                            setSelectedPart(null);
                          }}
                        >
                          Remove part
                        </button>
                      </div>
                    </div>
                  );
                })()}
            </div>
          )}

          {tab === "history" && (
            <div className="panel">
              {item.history.length === 0 && <span className="muted small">No versions yet.</span>}
              {item.history.map((v, i) => (
                <div key={v.id} className="version">
                  <span className={`chip ${v.source.startsWith("claude") ? "accent" : ""}`}>
                    {{ "claude-generate": "Generated", "claude-edit": "Edited", template: "Template", manual: "Manual" }[v.source]}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>{v.instruction || "—"}</div>
                    <div className="muted">{new Date(v.createdAt).toLocaleString()}</div>
                  </div>
                  {i === 0 ? (
                    <span className="muted">current</span>
                  ) : (
                    <button className="btn sm" onClick={() => run(() => api.revertItem(item.id, v.id))}>
                      Restore
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="panel">
            <h3>Photos</h3>
            <div className="thumbs" style={{ marginBottom: 10 }}>
              {photos.map((pid) => (
                <div className="thumb-wrap" key={pid}>
                  <a href={`/api/full/${pid}`} target="_blank" rel="noreferrer">
                    <PhotoThumb id={pid} className="thumb" />
                  </a>
                  <button
                    className="x"
                    aria-label="Remove photo"
                    onClick={() => api.updateItem(item.id, { photoIds: photos.filter((p) => p !== pid) }).then(sync).catch(toastError)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <ImageDrop
              compact
              label="Add photos"
              onUploaded={(imgs) => api.updateItem(item.id, { photoIds: [...photos, ...imgs.map((i) => i.id)] }).then(sync).catch(toastError)}
            />
            <div className="field" style={{ marginTop: 10 }}>
              <label>Notes for Claude</label>
              <textarea
                className="textarea"
                value={item.notes}
                onChange={(e) => setItem({ ...item, notes: e.target.value })}
                onBlur={() => api.updateItem(item.id, { notes: item.notes }).then(sync).catch(toastError)}
              />
            </div>
          </div>

          <div className="row">
            <button className="btn sm" onClick={() => api.duplicateItem(item.id).then((c) => { upsert(c); navigate(`/library/${c.id}`); }).catch(toastError)}>
              <Icon name="copy" size={14} /> Duplicate
            </button>
            <div className="spacer" />
            <button
              className="btn sm danger"
              onClick={async () => {
                if (!confirm(`Delete "${item.name}"? It will also be removed from rooms and collections.`)) return;
                await api.deleteItem(item.id);
                removeFromStore(item.id);
                navigate("/library");
              }}
            >
              <Icon name="trash" size={14} /> Delete
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
