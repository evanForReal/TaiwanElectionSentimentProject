import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Collection, MatchResult, Pin, Project } from "../../shared/types.ts";
import { api, type CollectionWithPins } from "../lib/api.ts";
import { toast, toastError, useApp, useItemMap } from "../lib/store.ts";
import { Icon, ImageDrop, Modal, Spinner, categoryLabel } from "../components/ui.tsx";
import { ItemThumb, PhotoThumb } from "../components/ItemCard.tsx";
import { LibraryPicker } from "./RoomPage.tsx";

export function CollectionPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const hasKey = useApp((s) => s.settings?.hasAnthropicKey);
  const items = useItemMap();
  const [c, setC] = useState<CollectionWithPins | null>(null);
  const [all, setAll] = useState<Collection[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [urls, setUrls] = useState("");
  const [adding, setAdding] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [request, setRequest] = useState("");
  const [matching, setMatching] = useState(false);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [moveMode, setMoveMode] = useState<"move" | "copy" | null>(null);
  const [addingExisting, setAddingExisting] = useState(false);

  const reload = () => api.collection(id).then(setC).catch(toastError);
  useEffect(() => {
    reload();
    api.collections().then(setAll).catch(() => {});
    setSelected([]);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c)
    return (
      <div className="page">
        <Spinner />
      </div>
    );

  const toggle = (pid: string) => setSelected(selected.includes(pid) ? selected.filter((x) => x !== pid) : [...selected, pid]);
  const summaryPins = new Set(c.summary?.pinIds ?? []);

  async function addUrls() {
    const list = urls.split(/[\s,]+/).filter((u) => /^https?:\/\//.test(u));
    if (!list.length) return;
    setAdding(true);
    try {
      const r = await api.addPins(c!.id, { urls: list });
      if (r.failed.length) toast(`${r.failed.length} link${r.failed.length > 1 ? "s" : ""} failed: ${r.failed[0].error}`, "error");
      if (r.added.length) toast(`Added ${r.added.length} image${r.added.length > 1 ? "s" : ""}`);
      setUrls("");
      reload();
    } catch (err) {
      toastError(err);
    } finally {
      setAdding(false);
    }
  }

  async function summarize() {
    setSummarizing(true);
    try {
      await api.summarize(c!.id, selected.length ? selected : undefined);
      await reload();
      toast("Style summary updated");
    } catch (err) {
      toastError(err);
    } finally {
      setSummarizing(false);
    }
  }

  async function fetchMatches() {
    setMatching(true);
    try {
      setMatch(await api.match(c!.id, request));
    } catch (err) {
      toastError(err);
    } finally {
      setMatching(false);
    }
  }

  const s = c.summary;

  return (
    <div className="page" style={{ maxWidth: 1440 }}>
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <Link to="/boards" className="eyebrow" style={{ textDecoration: "none" }}>
            ← Boards
          </Link>
          <input
            className="input"
            style={{ fontFamily: "var(--font-serif)", fontSize: 30, border: 0, background: "transparent", padding: 0, boxShadow: "none" }}
            value={c.name}
            onChange={(e) => setC({ ...c, name: e.target.value })}
            onBlur={() => api.renameCollection(c.id, c.name).catch(toastError)}
          />
          <div className="muted small">
            {c.pins.length} images {c.source === "pinterest" && "· imported from Pinterest"}
          </div>
        </div>
        <div className="row">
          {c.source === "pinterest" && c.pinterestBoardId && (
            <button
              className="btn"
              onClick={async () => {
                try {
                  const r = await api.pinterestImport(c.pinterestBoardId!, c.name, c.id);
                  toast(r.added ? `Pulled ${r.added} new pins` : "Already up to date");
                  reload();
                } catch (err) {
                  toastError(err);
                }
              }}
            >
              <Icon name="refresh" size={14} /> Sync board
            </button>
          )}
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm(`Delete collection "${c.name}"? Library pieces are not affected.`)) return;
              await api.deleteCollection(c.id);
              navigate("/boards");
            }}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="collection-layout">
        <div className="stack">
          <div className="grid-2">
            <ImageDrop
              compact
              label="Drop images"
              onUploaded={async (imgs) => {
                await api.addPins(c.id, { imageIds: imgs.map((i) => i.id) });
                reload();
              }}
            />
            <div className="row">
              <button className="btn" onClick={() => setAddingExisting(true)} title="Add images already saved in other collections">
                From collections
              </button>
              <input className="input" value={urls} onChange={(e) => setUrls(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addUrls()} placeholder="Paste pin or image links" />
              <button className="btn" disabled={adding || !urls.trim()} onClick={addUrls}>
                {adding ? <Spinner /> : "Add"}
              </button>
            </div>
          </div>

          <div className="row wrap" style={{ minHeight: 34 }}>
            {selected.length > 0 ? (
              <>
                <strong>{selected.length} selected</strong>
                <button className="btn sm" onClick={() => setSelected([])}>
                  Clear
                </button>
                <button className="btn sm" onClick={() => setMoveMode("copy")} title="The images stay here too; one image can be in many collections">
                  Also add to…
                </button>
                <button className="btn sm" onClick={() => setMoveMode("move")}>
                  Move to…
                </button>
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    if (!confirm(`Remove ${selected.length} image(s) from this collection? Images that are in other collections stay there.`)) return;
                    await api.removePins(c.id, selected);
                    setSelected([]);
                    reload();
                  }}
                >
                  Remove
                </button>
              </>
            ) : (
              <span className="muted small">Click images to select them. Summarize a selection to read just part of a board.</span>
            )}
            <div className="spacer" />
            {c.pins.length > 0 && (
              <button className="btn sm ghost" onClick={() => setSelected(selected.length === c.pins.length ? [] : c.pins.map((p) => p.id))}>
                {selected.length === c.pins.length ? "Select none" : "Select all"}
              </button>
            )}
          </div>

          {c.pins.length === 0 ? (
            <div className="empty">
              <h3>No images yet</h3>
              <p>Drop images, paste Pinterest pin links, or import a board.</p>
            </div>
          ) : (
            <div className="masonry">
              {c.pins.map((p) => (
                <div
                  key={p.id}
                  className={`pin ${selected.includes(p.id) ? "selected" : ""} ${s && selected.length === 0 && !summaryPins.has(p.id) ? "dimmed" : ""}`}
                  onClick={() => toggle(p.id)}
                  title={p.title}
                >
                  {p.imageId ? <PhotoThumb id={p.imageId} alt={p.title} /> : <div style={{ height: 120 }} />}
                  {p.collectionIds.length > 1 && (
                    <span
                      className="chip pin-shared"
                      title={`Also in: ${p.collectionIds
                        .filter((x) => x !== c.id)
                        .map((x) => all.find((a) => a.id === x)?.name ?? "another collection")
                        .join(", ")}`}
                    >
                      in {p.collectionIds.length}
                    </span>
                  )}
                  <div className="pin-tools">
                    <span className="check">{selected.includes(p.id) ? "✓" : ""}</span>
                    {p.link && (
                      <a className="btn sm" href={p.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label="Open source">
                        <Icon name="link" size={13} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="stack" style={{ position: "sticky", top: 16 }}>
          <div className="panel summary">
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="eyebrow">Style summary</span>
              <div className="spacer" />
              <button className="btn sm accent" disabled={summarizing || !hasKey || c.pins.length === 0} onClick={summarize} title={hasKey ? "" : "Needs an Anthropic API key"}>
                {summarizing ? <Spinner /> : <Icon name="sparkle" size={14} />}
                {s ? "Refresh" : "Summarize"}
                {selected.length ? ` ${selected.length} selected` : ""}
              </button>
            </div>
            {summarizing && <div className="muted small">Claude is studying {selected.length || Math.min(c.pins.length, 24)} images…</div>}
            {!s && !summarizing && (
              <div className="muted small">
                Claude will identify the aesthetic these images share and list the essential pieces for the look.
                {c.pins.length > 24 && " Up to 24 images are read per summary; select a subset to focus it."}
              </div>
            )}
            {s && (
              <div className="stack" style={{ gap: 14 }}>
                <div>
                  <div className="style-name">{s.styleName}</div>
                  <div style={{ fontStyle: "italic", color: "var(--ink-2)" }}>{s.oneLiner}</div>
                </div>
                <p style={{ margin: 0 }}>{s.description}</p>
                <div className="palette">
                  {s.palette.map((p) => (
                    <div className="sw" key={p.hex + p.name}>
                      <span style={{ background: p.hex }} />
                      {p.name}
                    </div>
                  ))}
                </div>
                <div className="row wrap">
                  {s.materials.map((m) => (
                    <span key={m} className="chip">
                      {m}
                    </span>
                  ))}
                </div>
                <div>
                  <div className="label" style={{ marginBottom: 4 }}>
                    Essential pieces
                  </div>
                  {s.essentials.map((e) => (
                    <div className="essential" key={e.name}>
                      <span className={`chip ${e.priority === "must" ? "accent" : ""}`} style={{ alignSelf: "flex-start" }}>
                        {e.priority === "must" ? "Must" : "Nice"}
                      </span>
                      <div>
                        <strong>{e.name}</strong> <span className="muted small">· {categoryLabel(e.category)}</span>
                        <div className="muted small">{e.why}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {s.layoutPrinciples.length > 0 && (
                  <div>
                    <div className="label">Layout principles</div>
                    <ul className="clean small">
                      {s.layoutPrinciples.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {s.avoid.length > 0 && (
                  <div>
                    <div className="label">Avoid</div>
                    <ul className="clean small">
                      {s.avoid.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="muted small">
                  From {s.pinIds.length} images · {new Date(s.createdAt).toLocaleString()}
                </div>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="eyebrow">Pieces for this look</span>
              <div className="spacer" />
              <button className="btn sm ghost" onClick={() => setPicking(true)}>
                <Icon name="plus" size={14} /> Add
              </button>
            </div>
            {c.itemIds.length === 0 && <div className="muted small">No pieces linked yet.</div>}
            {c.itemIds.map((iid) => {
              const it = items.get(iid);
              if (!it) return null;
              return (
                <div key={iid} className="list-row">
                  <ItemThumb item={it} />
                  <Link to={`/library/${iid}`} className="grow" style={{ textDecoration: "none" }}>
                    {it.name}
                  </Link>
                  <button
                    className="btn sm ghost icon"
                    style={{ width: 26, height: 26 }}
                    aria-label="Unlink"
                    onClick={async () => {
                      await api.setCollectionItems(c.id, [iid], "remove");
                      reload();
                    }}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              );
            })}
            <div className="divider" />
            <div className="stack" style={{ gap: 8 }}>
              <input
                className="input"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && s && fetchMatches()}
                placeholder={s ? `e.g. "fetch all items for my ${s.styleName} living room"` : "Summarize the style first"}
                disabled={!s}
              />
              <div className="row">
                <button className="btn sm" disabled={c.itemIds.length === 0} onClick={() => setSending(true)}>
                  <Icon name="tray" size={14} /> Send to a room
                </button>
                <div className="spacer" />
                <button className="btn sm primary" disabled={!s || matching || !hasKey} onClick={fetchMatches}>
                  {matching ? <Spinner /> : <Icon name="sparkle" size={14} />} Fetch matching items
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {match && (
        <MatchModal
          result={match}
          onClose={() => setMatch(null)}
          already={new Set(c.itemIds)}
          onConfirm={async (ids) => {
            await api.setCollectionItems(c.id, ids, "add");
            setMatch(null);
            reload();
            toast(`Linked ${ids.length} piece${ids.length === 1 ? "" : "s"}`);
          }}
        />
      )}
      {picking && (
        <LibraryPicker
          title="Link pieces to this look"
          onClose={() => setPicking(false)}
          onPick={async (ids) => {
            await api.setCollectionItems(c.id, ids, "add");
            setPicking(false);
            reload();
          }}
        />
      )}
      {addingExisting && (
        <PinPicker
          collections={all}
          exclude={new Set(c.pins.map((p) => p.id))}
          onClose={() => setAddingExisting(false)}
          onPick={async (pinIds) => {
            await api.addPins(c.id, { pinIds });
            setAddingExisting(false);
            toast(`Added ${pinIds.length} image${pinIds.length === 1 ? "" : "s"}`);
            reload();
          }}
        />
      )}
      {sending && <SendToRoomModal itemIds={c.itemIds} onClose={() => setSending(false)} />}
      {moveMode && (
        <Modal title={moveMode === "move" ? "Move to collection" : "Also add to collection"} onClose={() => setMoveMode(null)}>
          <div className="stack" style={{ gap: 4 }}>
            {all
              .filter((x) => x.id !== c.id)
              .map((x) => (
                <div
                  key={x.id}
                  className="list-row"
                  onClick={async () => {
                    await api.linkPins(selected, x.id, moveMode === "move" ? c.id : undefined);
                    toast(`${moveMode === "copy" ? "Added" : "Moved"} ${selected.length} image(s) to ${x.name}`);
                    setMoveMode(null);
                    setSelected([]);
                    reload();
                  }}
                >
                  <span className="grow">{x.name}</span>
                  <span className="muted small">{x.pinCount} images</span>
                </div>
              ))}
            {all.length <= 1 && <span className="muted">Create another collection first.</span>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function MatchModal({
  result,
  onClose,
  onConfirm,
  already,
}: {
  result: MatchResult;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
  already: Set<string>;
}) {
  const items = useItemMap();
  const [chosen, setChosen] = useState<string[]>(() => result.matches.filter((m) => m.score >= 70 && !already.has(m.itemId)).map((m) => m.itemId));
  return (
    <Modal
      title="Suggested pieces"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={chosen.length === 0} onClick={() => onConfirm(chosen)}>
            Link {chosen.length} piece{chosen.length === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      {result.matches.length === 0 && <div className="muted">Nothing in your library fits this look yet.</div>}
      {result.matches.map((m) => {
        const it = items.get(m.itemId);
        if (!it) return null;
        const on = chosen.includes(m.itemId);
        return (
          <label key={m.itemId} className="match-row" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={on} onChange={() => setChosen(on ? chosen.filter((x) => x !== m.itemId) : [...chosen, m.itemId])} />
            <ItemThumb item={it} />
            <div>
              <strong>{it.name}</strong> {already.has(m.itemId) && <span className="chip">linked</span>}
              {m.fillsEssential && <span className="chip accent" style={{ marginLeft: 4 }}>{m.fillsEssential}</span>}
              <div className="muted small">{m.reason}</div>
            </div>
            <div className="score">{m.score}</div>
          </label>
        );
      })}
      {result.missingEssentials.length > 0 && (
        <>
          <div className="divider" />
          <div className="label" style={{ marginBottom: 6 }}>
            Not in your library yet
          </div>
          {result.missingEssentials.map((e) => (
            <div key={e.name} className="essential">
              <span className="chip">{categoryLabel(e.category)}</span>
              <div>
                <strong>{e.name}</strong>
                <div className="muted small">{e.suggestion}</div>
              </div>
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}

function SendToRoomModal({ itemIds, onClose }: { itemIds: string[]; onClose: () => void }) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[] | null>(null);
  useEffect(() => {
    api.projects().then(setProjects).catch(toastError);
  }, []);
  return (
    <Modal title="Send to a room's staging tray" onClose={onClose}>
      {projects === null ? (
        <Spinner />
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {projects.every((p) => !p.rooms?.length) && <div className="muted">Create a project with a room first.</div>}
          {projects
            .filter((p) => p.rooms?.length)
            .map((p) => (
              <div key={p.id}>
                <div className="label">{p.name}</div>
                {p.rooms!.map((r) => (
                  <div
                    key={r.id}
                    className="list-row"
                    onClick={async () => {
                      try {
                        const room = await api.room(r.id);
                        const staging = [...room.state.staging, ...itemIds.filter((i) => !room.state.staging.includes(i))];
                        await api.updateRoom(r.id, { state: { ...room.state, staging } });
                        toast(`Staged ${itemIds.length} pieces in ${r.name}`);
                        navigate(`/rooms/${r.id}`);
                      } catch (err) {
                        toastError(err);
                      }
                    }}
                  >
                    <span className="grow">{r.name}</span>
                    <Icon name="arrow" size={14} />
                  </div>
                ))}
              </div>
            ))}
        </div>
      )}
    </Modal>
  );
}

/** Picks pins that already exist in other collections. */
function PinPicker({
  collections,
  exclude,
  onClose,
  onPick,
}: {
  collections: Collection[];
  exclude: Set<string>;
  onClose: () => void;
  onPick: (pinIds: string[]) => void;
}) {
  const [pins, setPins] = useState<Pin[] | null>(null);
  const [from, setFrom] = useState("all");
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => {
    api.allPins().then(setPins).catch(toastError);
  }, []);
  const shown = (pins ?? []).filter((p) => !exclude.has(p.id) && (from === "all" || p.collectionIds.includes(from)));
  return (
    <Modal
      title="Add images from other collections"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={chosen.length === 0} onClick={() => onPick(chosen)}>
            Add {chosen.length || ""} image{chosen.length === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 12 }}>
        <select className="select" style={{ maxWidth: 260 }} value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="all">All collections</option>
          {collections.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <button className="btn sm ghost" onClick={() => setChosen(chosen.length === shown.length ? [] : shown.map((p) => p.id))}>
          {chosen.length === shown.length && shown.length ? "Select none" : "Select all"}
        </button>
        <span className="muted small">Images stay in their original collections too.</span>
      </div>
      {pins === null ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <div className="muted">No other images to add.</div>
      ) : (
        <div className="masonry" style={{ columns: "5 120px" }}>
          {shown.map((p) => (
            <div
              key={p.id}
              className={`pin ${chosen.includes(p.id) ? "selected" : ""}`}
              onClick={() => setChosen(chosen.includes(p.id) ? chosen.filter((x) => x !== p.id) : [...chosen, p.id])}
            >
              {p.imageId && <PhotoThumb id={p.imageId} alt={p.title} />}
              <div className="pin-tools">
                <span className="check">{chosen.includes(p.id) ? "✓" : ""}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
