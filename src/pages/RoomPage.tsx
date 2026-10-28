import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Layout, LibraryItem, Placement, Room, RoomConfiguration, RoomState } from "../../shared/types.ts";
import { floorPolygon, layoutBounds, layoutObstacles, obbCorners, obbOverlap, pointInPolygon, polygonCentroid, snapAngle } from "../../shared/geometry.ts";
import { api } from "../lib/api.ts";
import { newLocalId } from "../lib/ids.ts";
import { toast, toastError, useApp, useItemMap } from "../lib/store.ts";
import { Icon, Modal, Seg, Spinner, categoryLabel, useLen } from "../components/ui.tsx";
import { ItemThumb } from "../components/ItemCard.tsx";
import { LayoutEditor } from "../layout/LayoutEditor.tsx";
import { RoomScene, isFlat, placementOBB, type CameraPreset, type WallMode } from "../room/RoomScene.tsx";

type Tab = "layout" | "3d";

function useDebouncedSave<T>(value: T | null, save: (v: T) => Promise<unknown>, ms = 700) {
  const [status, setStatus] = useState<"saved" | "saving" | "dirty">("saved");
  const first = useRef(true);
  useEffect(() => {
    if (value === null) return;
    if (first.current) {
      first.current = false;
      return;
    }
    setStatus("dirty");
    const id = setTimeout(() => {
      setStatus("saving");
      save(value)
        .then(() => setStatus("saved"))
        .catch((err) => {
          toastError(err);
          setStatus("dirty");
        });
    }, ms);
    return () => clearTimeout(id);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return status;
}

export function RoomPage() {
  const { id = "" } = useParams();
  const items = useItemMap();
  const loadItems = useApp((s) => s.loadItems);
  const [room, setRoom] = useState<Room | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [tab, setTab] = useState<Tab>("layout");
  const [draftNotes, setDraftNotes] = useState<{ notes: string; scale: string } | null>(null);
  const [tracing, setTracing] = useState(false);

  useEffect(() => {
    api
      .room(id)
      .then((r) => {
        setRoom(r);
        setLayout(r.layout);
        setState(r.state);
        if (r.layout.lines.length > 0 && r.state.placements.length > 0) setTab("3d");
        const notes = sessionStorage.getItem(`draft-notes:${r.id}`);
        if (notes) {
          setDraftNotes(JSON.parse(notes));
          sessionStorage.removeItem(`draft-notes:${r.id}`);
        }
      })
      .catch(toastError);
    loadItems().catch(() => {});
  }, [id, loadItems]);

  const layoutStatus = useDebouncedSave(layout, (l) => api.updateRoom(id, { layout: l }));
  const stateStatus = useDebouncedSave(state, (s) => api.updateRoom(id, { state: s }), 500);
  const saving = layoutStatus !== "saved" || stateStatus !== "saved";

  async function traceWithClaude() {
    if (!layout?.background) return;
    if (layout.lines.length > 0 && !confirm("Replace the current walls with Claude's tracing of the image?")) return;
    setTracing(true);
    try {
      const draft = await api.draftLayout(id, layout.background.imageId, "");
      setLayout({ ...draft.layout, ceilingHeight: layout.ceilingHeight, wallColor: layout.wallColor, floorColor: layout.floorColor, floorKind: layout.floorKind });
      setDraftNotes({ notes: draft.notes, scale: draft.scaleReasoning });
    } catch (err) {
      toastError(err);
    } finally {
      setTracing(false);
    }
  }

  if (!room || !layout || !state) {
    return (
      <div className="page">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="room-page">
      <div className="room-head">
        <Link to={`/projects/${room.projectId}`} className="btn sm ghost">
          <Icon name="back" size={14} />
        </Link>
        <input
          className="input"
          style={{ fontFamily: "var(--font-serif)", fontSize: 19, border: 0, background: "transparent", padding: 0, width: 220, boxShadow: "none" }}
          value={room.name}
          onChange={(e) => setRoom({ ...room, name: e.target.value })}
          onBlur={() => api.updateRoom(room.id, { name: room.name }).catch(toastError)}
        />
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            { value: "layout", label: "Layout" },
            { value: "3d", label: "3D room" },
          ]}
        />
        <div className="spacer" />
        <span className="muted small row">{saving ? <><Spinner /> Saving…</> : "All changes saved"}</span>
      </div>

      {draftNotes && tab === "layout" && (
        <div className="note-box row" style={{ borderRadius: 0 }}>
          <Icon name="sparkle" size={16} />
          <span style={{ flex: 1 }}>
            <strong>Claude's draft. Check it against the image and correct anything off.</strong> {draftNotes.notes}{" "}
            <span className="muted">Scale: {draftNotes.scale}</span>
          </span>
          <button className="btn sm ghost" onClick={() => setDraftNotes(null)}>
            Got it
          </button>
        </div>
      )}

      {tab === "layout" ? (
        <LayoutEditor layout={layout} onChange={setLayout} placements={state.placements} items={items} onTraceWithClaude={traceWithClaude} tracing={tracing} />
      ) : (
        <Room3D layout={layout} state={state} setState={setState} items={items} roomId={room.id} onGoToLayout={() => setTab("layout")} />
      )}
    </div>
  );
}

// ---------- 3D tab ----------

function defaultElevation(item: LibraryItem, layout: Layout) {
  if (!item.model) return 0;
  if (item.category === "pendant") return Math.max(0, layout.ceilingHeight - item.model.dims.h);
  if ((item.category === "art" || item.category === "mirror") && item.model.dims.d < 8 && item.model.dims.h < 150)
    return Math.max(0, 150 - item.model.dims.h / 2);
  return 0;
}

function Room3D({
  layout,
  state,
  setState,
  items,
  roomId,
  onGoToLayout,
}: {
  layout: Layout;
  state: RoomState;
  setState: (s: RoomState) => void;
  items: Map<string, LibraryItem>;
  roomId: string;
  onGoToLayout: () => void;
}) {
  const len = useLen();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wallMode, setWallMode] = useState<WallMode>("auto");
  const [preset, setPreset] = useState<CameraPreset>("orbit");
  const [nonce, setNonce] = useState(0);
  const [showDrafts, setShowDrafts] = useState(true);
  const [snapping, setSnapping] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [trayOpen, setTrayOpen] = useState(state.staging.length > 0);
  const [picking, setPicking] = useState(false);
  const [configs, setConfigs] = useState<RoomConfiguration[]>([]);
  const [configName, setConfigName] = useState("");
  const past = useRef<RoomState[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const dragStart = useRef<RoomState | null>(null);

  useEffect(() => {
    api.configurations(roomId).then(setConfigs).catch(() => {});
  }, [roomId]);

  const commit = useCallback(
    (next: RoomState) => {
      past.current = [...past.current.slice(-60), stateRef.current];
      setState(next);
    },
    [setState],
  );

  const undo = () => {
    const prev = past.current.pop();
    if (prev) setState(prev);
  };

  const update = (pid: string, patch: Partial<Placement>) =>
    commit({ ...stateRef.current, placements: stateRef.current.placements.map((p) => (p.id === pid ? { ...p, ...patch } : p)) });

  const onMove = (pid: string, patch: Partial<Placement>, done: boolean) => {
    if (!done) {
      if (!dragStart.current) dragStart.current = stateRef.current;
      setState({ ...stateRef.current, placements: stateRef.current.placements.map((p) => (p.id === pid ? { ...p, ...patch } : p)) });
    } else if (dragStart.current) {
      past.current = [...past.current.slice(-60), dragStart.current];
      dragStart.current = null;
    }
  };

  const center = useMemo(() => {
    const poly = floorPolygon(layout);
    if (poly.length) return polygonCentroid(poly);
    const { min, max } = layoutBounds(layout);
    return { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };
  }, [layout]);

  const place = (itemId: string, draft: boolean) => {
    const item = items.get(itemId);
    if (!item?.model) return toast("This piece has no 3D model yet", "error");
    const spot = freeSpot(item);
    const p: Placement = {
      id: newLocalId(),
      itemId,
      x: spot.x,
      y: spot.y,
      rotation: 0,
      elevation: defaultElevation(item, layout),
      draft,
    };
    const idx = stateRef.current.staging.indexOf(itemId);
    const staging = [...stateRef.current.staging];
    if (idx >= 0) staging.splice(idx, 1);
    commit({ placements: [...stateRef.current.placements, p], staging });
    setSelectedId(p.id);
  };

  /** Spirals out from the room center to the first spot inside the floor that touches nothing. */
  const freeSpot = (item: LibraryItem) => {
    const poly = floorPolygon(layout);
    if (isFlat(item) || !item.model) return center;
    const obstacles = obstacleOBBs("");
    const hw = item.model.dims.w / 2;
    const hd = item.model.dims.d / 2;
    for (let r = 0; r <= 600; r += 20) {
      const steps = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 20);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const c = { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r };
        const obb = { center: c, hw, hd, angle: 0 };
        if (poly.length && !obbCorners(obb).every((q) => pointInPolygon(q, poly))) continue;
        if (obstacles.every((o) => obbOverlap(obb, o) <= 0)) return c;
      }
    }
    return center;
  };

  const removePlacement = (pid: string, toTray: boolean) => {
    const p = stateRef.current.placements.find((x) => x.id === pid);
    if (!p) return;
    commit({
      placements: stateRef.current.placements.filter((x) => x.id !== pid),
      staging: toTray ? [...stateRef.current.staging, p.itemId] : stateRef.current.staging,
    });
    setSelectedId(null);
  };

  // Collisions: walls (minus openings), fixtures and other pieces, with vertical overlap
  const statics = useMemo(() => layoutObstacles(layout), [layout]);
  const collisions = useMemo(() => {
    const out = new Set<string>();
    const ps = state.placements.filter((p) => showDrafts || !p.draft);
    const boxes = ps.map((p) => {
      const item = items.get(p.itemId);
      return { p, item, obb: isFlat(item) ? null : placementOBB(p, item), top: p.elevation + (item?.model?.dims.h ?? 0) };
    });
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      if (!a.obb) continue;
      for (const s of statics) {
        if (s.top > a.p.elevation && s.bottom < a.top && obbOverlap(a.obb, s.obb) > 0.5) out.add(a.p.id);
      }
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j];
        if (!b.obb) continue;
        if (b.top > a.p.elevation && b.p.elevation < a.top && obbOverlap(a.obb, b.obb) > 0.5) {
          out.add(a.p.id);
          out.add(b.p.id);
        }
      }
    }
    return out;
  }, [state.placements, items, statics, showDrafts]);

  const obstacleOBBs = (excludeId: string) => [
    ...statics.map((s) => s.obb),
    ...state.placements
      .filter((p) => p.id !== excludeId && (showDrafts || !p.draft))
      .map((p) => (isFlat(items.get(p.itemId)) ? null : placementOBB(p, items.get(p.itemId))))
      .filter((o): o is NonNullable<typeof o> => o !== null),
  ];

  const selected = state.placements.find((p) => p.id === selectedId) ?? null;
  const selectedItem = selected ? items.get(selected.itemId) : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (!selected) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key.toLowerCase() === "r") update(selected.id, { rotation: (snapAngle(selected.rotation) + (e.shiftKey ? -15 : 15) + 360) % 360 });
      else if (e.key === "Delete" || e.key === "Backspace") removePlacement(selected.id, false);
      else if (e.key.toLowerCase() === "t") removePlacement(selected.id, true);
      else if (e.key === "Escape") setSelectedId(null);
      else if (e.key === "ArrowLeft") update(selected.id, { x: selected.x - step });
      else if (e.key === "ArrowRight") update(selected.id, { x: selected.x + step });
      else if (e.key === "ArrowUp") update(selected.id, { y: selected.y - step });
      else if (e.key === "ArrowDown") update(selected.id, { y: selected.y + step });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const drafts = state.placements.filter((p) => p.draft);

  if (layout.lines.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <h3>Draw the room first</h3>
          <p>The 3D room is built from the walls, openings and fixtures in the layout.</p>
          <button className="btn primary" onClick={onGoToLayout}>
            Go to the layout
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="room-body">
      <div className="scene-wrap">
        <RoomScene
          layout={layout}
          placements={state.placements}
          items={items}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMove={onMove}
          collisions={collisions}
          obstacleOBBs={obstacleOBBs}
          wallMode={wallMode}
          preset={preset}
          presetNonce={nonce}
          showDrafts={showDrafts}
          snapping={snapping}
          dragging={dragging}
          setDragging={setDragging}
        />
        <div className="scene-toolbar">
          <Seg
            value={preset}
            onChange={(v) => {
              setPreset(v);
              setNonce((n) => n + 1);
            }}
            options={[
              { value: "orbit", label: "Orbit" },
              { value: "top", label: "Top" },
              { value: "eye", label: "Eye level" },
            ]}
          />
          <Seg
            value={wallMode}
            onChange={setWallMode}
            options={[
              { value: "auto", label: "Dollhouse" },
              { value: "full", label: "Walls" },
              { value: "cutaway", label: "Cutaway" },
              { value: "hidden", label: "No walls" },
            ]}
          />
          <label className="btn sm" style={{ background: "var(--surface)" }}>
            <input type="checkbox" checked={snapping} onChange={(e) => setSnapping(e.target.checked)} /> Snap
          </label>
          <label className="btn sm" style={{ background: "var(--surface)" }}>
            <input type="checkbox" checked={showDrafts} onChange={(e) => setShowDrafts(e.target.checked)} /> Drafts
          </label>
          <div className="spacer" />
          {collisions.size > 0 && (
            <span className="chip danger" style={{ boxShadow: "var(--shadow)" }}>
              {collisions.size} piece{collisions.size > 1 ? "s" : ""} overlapping
            </span>
          )}
        </div>

        <div className={`tray ${trayOpen ? "" : "closed"}`}>
          <div className="tray-handle" onClick={() => setTrayOpen(!trayOpen)}>
            <Icon name="tray" />
            <strong>Staging tray</strong>
            <span className="muted small">
              {state.staging.length} waiting{drafts.length ? ` · ${drafts.length} draft${drafts.length > 1 ? "s" : ""} in room` : ""}
            </span>
            <div className="spacer" />
            <button
              className="btn sm"
              onClick={(e) => {
                e.stopPropagation();
                setPicking(true);
                setTrayOpen(true);
              }}
            >
              <Icon name="plus" size={14} /> Add from library
            </button>
            <span className="muted">{trayOpen ? "▾" : "▴"}</span>
          </div>
          <div className="tray-body">
            {state.staging.length === 0 && (
              <div className="muted small" style={{ padding: "20px 4px" }}>
                Stage pieces here to try in the room. Place them for real, or as a translucent draft to see how they'd look.
              </div>
            )}
            {state.staging.map((itemId, i) => {
              const it = items.get(itemId);
              if (!it) return null;
              return (
                <div className="tray-card" key={`${itemId}-${i}`}>
                  <ItemThumb item={it} />
                  <div className="meta">
                    <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</div>
                    {it.model && (
                      <div className="muted">
                        {len(it.model.dims.w)} × {len(it.model.dims.d)}
                      </div>
                    )}
                    <div className="row" style={{ marginTop: 6, gap: 4 }}>
                      <button className="btn sm primary" onClick={() => place(itemId, false)}>
                        Place
                      </button>
                      <button className="btn sm" onClick={() => place(itemId, true)} title="Place as a translucent draft">
                        Draft
                      </button>
                      <button
                        className="btn sm ghost icon"
                        style={{ width: 26, height: 26 }}
                        aria-label="Remove from tray"
                        onClick={() => {
                          const staging = [...state.staging];
                          staging.splice(i, 1);
                          commit({ ...state, staging });
                        }}
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="props">
        {selected && selectedItem ? (
          <div className="stack">
            <div className="row">
              <ItemThumb item={selectedItem} className="thumb" />
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0 }}>{selectedItem.name}</h3>
                <div className="muted small">
                  {categoryLabel(selectedItem.category)}
                  {selectedItem.model && ` · ${len(selectedItem.model.dims.w)} × ${len(selectedItem.model.dims.d)} × ${len(selectedItem.model.dims.h)}`}
                </div>
                <Link to={`/library/${selectedItem.id}`} className="small">
                  Edit model
                </Link>
              </div>
            </div>
            {collisions.has(selected.id) && <div className="error-box">Overlaps a wall, fixture or another piece.</div>}
            {selected.draft && (
              <div className="note-box row">
                <span style={{ flex: 1 }}>Draft: shown translucent until you keep it.</span>
                <button className="btn sm primary" onClick={() => update(selected.id, { draft: false })}>
                  Keep
                </button>
              </div>
            )}
            <div className="field">
              <label>Rotation</label>
              <div className="slider-row" style={{ gridTemplateColumns: "1fr 58px" }}>
                <input type="range" min={0} max={359} step={1} value={((selected.rotation % 360) + 360) % 360} onChange={(e) => update(selected.id, { rotation: Number(e.target.value) })} />
                <span className="small">{Math.round(((selected.rotation % 360) + 360) % 360)}°</span>
              </div>
              <div className="row">
                <button className="btn sm" onClick={() => update(selected.id, { rotation: snapAngle(selected.rotation) - 15 })}>
                  −15°
                </button>
                <button className="btn sm" onClick={() => update(selected.id, { rotation: snapAngle(selected.rotation) + 15 })}>
                  +15°
                </button>
                <button className="btn sm" onClick={() => update(selected.id, { rotation: snapAngle(selected.rotation, 90) + 90 })}>
                  <Icon name="rotate" size={14} /> 90°
                </button>
              </div>
            </div>
            <div className="field">
              <label>Height off the floor</label>
              <div className="slider-row" style={{ gridTemplateColumns: "1fr 58px" }}>
                <input type="range" min={0} max={layout.ceilingHeight} step={1} value={selected.elevation} onChange={(e) => update(selected.id, { elevation: Number(e.target.value) })} />
                <span className="small">{len(selected.elevation)}</span>
              </div>
              <span className="hint">For wall art, shelves and pendants.</span>
            </div>
            <div className="row wrap">
              <button
                className="btn sm"
                onClick={() => {
                  const copy = { ...selected, id: newLocalId(), x: selected.x + 30, y: selected.y + 30 };
                  commit({ ...state, placements: [...state.placements, copy] });
                  setSelectedId(copy.id);
                }}
              >
                <Icon name="copy" size={14} /> Duplicate
              </button>
              {!selected.draft && (
                <button className="btn sm" onClick={() => update(selected.id, { draft: true })}>
                  Make draft
                </button>
              )}
              <button className="btn sm" onClick={() => removePlacement(selected.id, true)}>
                <Icon name="tray" size={14} /> To tray
              </button>
              <button className="btn sm danger" onClick={() => removePlacement(selected.id, false)}>
                <Icon name="trash" size={14} /> Remove
              </button>
            </div>
            <div className="divider" />
            <div className="muted small">
              Drag to move. It snaps flush to nearby walls; hold <span className="kbd">Alt</span> to move freely. <span className="kbd">R</span> rotates,{" "}
              <span className="kbd">←↑↓→</span> nudge, <span className="kbd">T</span> sends to the tray, <span className="kbd">Del</span> removes.
            </div>
          </div>
        ) : (
          <div className="stack">
            <div>
              <h3>In this room</h3>
              {state.placements.length === 0 && <div className="muted small">Nothing placed yet. Add pieces to the staging tray below.</div>}
              {state.placements.map((p) => {
                const it = items.get(p.itemId);
                if (!it) return null;
                return (
                  <div key={p.id} className={`list-row ${p.id === selectedId ? "on" : ""}`} onClick={() => setSelectedId(p.id)}>
                    <ItemThumb item={it} />
                    <span className="grow">{it.name}</span>
                    {p.draft && <span className="chip">draft</span>}
                    {collisions.has(p.id) && <span className="chip danger">overlap</span>}
                  </div>
                );
              })}
            </div>
            {drafts.length > 0 && (
              <div className="row">
                <button className="btn sm primary" onClick={() => commit({ ...state, placements: state.placements.map((p) => ({ ...p, draft: false })) })}>
                  Keep all drafts
                </button>
                <button
                  className="btn sm"
                  onClick={() =>
                    commit({ placements: state.placements.filter((p) => !p.draft), staging: [...state.staging, ...drafts.map((d) => d.itemId)] })
                  }
                >
                  Drafts to tray
                </button>
              </div>
            )}

            <div className="divider" />
            <h3>Saved arrangements</h3>
            <div className="row">
              <input className="input sm" placeholder="Name this arrangement" value={configName} onChange={(e) => setConfigName(e.target.value)} />
              <button
                className="btn sm primary"
                onClick={async () => {
                  try {
                    // Flush the latest state before snapshotting it
                    await api.updateRoom(roomId, { state: stateRef.current });
                    setConfigs(await api.saveConfiguration(roomId, configName));
                    setConfigName("");
                    toast("Arrangement saved");
                  } catch (err) {
                    toastError(err);
                  }
                }}
              >
                <Icon name="save" size={14} /> Save
              </button>
            </div>
            {configs.length === 0 && <div className="muted small">Save this arrangement to compare alternatives later.</div>}
            {configs.map((c) => (
              <div key={c.id} className="list-row" style={{ cursor: "default" }}>
                <div className="grow">
                  <div>{c.name}</div>
                  <div className="muted small">
                    {c.state.placements.length} pieces · {new Date(c.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  className="btn sm"
                  onClick={async () => {
                    if (!confirm(`Load "${c.name}"? The current arrangement will be replaced (save it first to keep it).`)) return;
                    try {
                      const r = await api.applyConfiguration(c.id);
                      commit(r.state);
                      setSelectedId(null);
                    } catch (err) {
                      toastError(err);
                    }
                  }}
                >
                  Load
                </button>
                <button
                  className="btn sm ghost icon"
                  style={{ width: 28, height: 28 }}
                  aria-label="Delete arrangement"
                  onClick={async () => {
                    await api.deleteConfiguration(c.id);
                    setConfigs(configs.filter((x) => x.id !== c.id));
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>

      {picking && (
        <LibraryPicker
          onClose={() => setPicking(false)}
          onPick={(ids) => {
            commit({ ...state, staging: [...state.staging, ...ids] });
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

export function LibraryPicker({ onClose, onPick, title = "Add to staging tray" }: { onClose: () => void; onPick: (ids: string[]) => void; title?: string }) {
  const items = useApp((s) => s.items);
  const [chosen, setChosen] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const shown = items.filter((i) => i.model && (!q || `${i.name} ${i.category}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={chosen.length === 0} onClick={() => onPick(chosen)}>
            Add {chosen.length || ""} piece{chosen.length === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      <input className="input" placeholder="Search the library" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} autoFocus />
      {shown.length === 0 && (
        <div className="muted">
          No modeled pieces yet. <Link to="/library">Add some to the library</Link>.
        </div>
      )}
      <div className="item-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        {shown.map((it) => {
          const on = chosen.includes(it.id);
          return (
            <button
              key={it.id}
              className="card item-card"
              style={{ outline: on ? "3px solid var(--accent)" : undefined }}
              onClick={() => setChosen(on ? chosen.filter((x) => x !== it.id) : [...chosen, it.id])}
            >
              <div className="art">
                <ItemThumb item={it} />
                {on && (
                  <span className="status chip accent">
                    <Icon name="check" size={12} /> Added
                  </span>
                )}
              </div>
              <div className="meta">
                <div className="name">{it.name}</div>
                <div className="muted small">{categoryLabel(it.category)}</div>
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
