import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Collection } from "../../shared/types.ts";
import { api, type PinterestBoard } from "../lib/api.ts";
import { toast, toastError, useApp } from "../lib/store.ts";
import { Empty, Icon, Modal, Spinner } from "../components/ui.tsx";
import { PhotoThumb } from "../components/ItemCard.tsx";

export function BoardsPage() {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [params] = useSearchParams();
  const loadSettings = useApp((s) => s.loadSettings);

  const reload = () => api.collections().then(setCollections).catch(toastError);
  useEffect(() => {
    reload();
    if (params.get("pinterest") === "connected") {
      loadSettings();
      toast("Pinterest connected");
      setImporting(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Boards</div>
          <h1>Inspiration</h1>
          <p>
            Import Pinterest boards or build collections here. Claude reads each collection's images, names the style and lists the pieces that make the
            look, then finds matches in your library.
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setImporting(true)}>
            Import from Pinterest
          </button>
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> New collection
          </button>
        </div>
      </div>

      {collections === null ? (
        <Spinner />
      ) : collections.length === 0 ? (
        <Empty title="No collections yet">
          <p>Import a Pinterest board, or create a collection and drop in images or pin links.</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn" onClick={() => setImporting(true)}>
              Import from Pinterest
            </button>
            <button className="btn primary" onClick={() => setCreating(true)}>
              New collection
            </button>
          </div>
        </Empty>
      ) : (
        <div className="collection-grid">
          {collections.map((c) => (
            <Link key={c.id} to={`/boards/${c.id}`} className="card collection-card">
              <div className="mosaic">
                {(c.coverImageIds ?? []).slice(0, 3).map((id) => (
                  <PhotoThumb key={id} id={id} />
                ))}
              </div>
              <div className="meta">
                <div className="row">
                  <h3 style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</h3>
                  {c.source === "pinterest" && <span className="chip">Pinterest</span>}
                </div>
                <div className="muted small">
                  {c.pinCount ?? 0} images
                  {c.itemIds.length > 0 && ` · ${c.itemIds.length} pieces`}
                </div>
                {c.summary && (
                  <div style={{ marginTop: 6 }}>
                    <span className="chip accent">{c.summary.styleName}</span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {creating && <NewCollectionModal onClose={() => setCreating(false)} />}
      {importing && <PinterestImportModal onClose={() => setImporting(false)} onImported={reload} />}
    </div>
  );
}

function NewCollectionModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const submit = async () => {
    try {
      const c = await api.createCollection(name);
      navigate(`/boards/${c.id}`);
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <Modal
      title="New collection"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit}>
            Create
          </button>
        </>
      }
    >
      <div className="field">
        <label>Name</label>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="e.g. Nice Home" />
      </div>
    </Modal>
  );
}

export function PinterestImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const settings = useApp((s) => s.settings);
  const navigate = useNavigate();
  const [boards, setBoards] = useState<PinterestBoard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!settings?.pinterestConnected) return;
    api.pinterestBoards().then(setBoards).catch((e) => setError(e.message));
  }, [settings?.pinterestConnected]);

  const importBoard = async (b: PinterestBoard) => {
    setBusy(b.id);
    try {
      const r = await api.pinterestImport(b.id, b.name);
      toast(`Imported ${r.added} new pin${r.added === 1 ? "" : "s"}${r.skipped ? ` (${r.skipped} already here)` : ""}`);
      onImported();
      navigate(`/boards/${r.collectionId}`);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title="Import from Pinterest" onClose={onClose} wide>
      {!settings?.pinterestConfigured ? (
        <div className="stack">
          <p>
            Importing boards uses Pinterest's official API, which needs your own Pinterest developer app (free, but Pinterest reviews it, which can take a
            few days).
          </p>
          <ol className="clean small">
            <li>
              Create an app at <a href="https://developers.pinterest.com/apps/" target="_blank" rel="noreferrer">developers.pinterest.com/apps</a>.
            </li>
            <li>
              Add the redirect URI <code>{settings?.pinterestRedirectUri}</code>.
            </li>
            <li>Paste the app ID and secret on the Settings page, then connect.</li>
          </ol>
          <div className="note-box">
            Until then, open any collection and paste pin links or drop saved images. Pin links use the pin's public preview image.
          </div>
          <div className="row">
            <div className="spacer" />
            <Link className="btn primary" to="/settings">
              Go to Settings
            </Link>
          </div>
        </div>
      ) : !settings.pinterestConnected ? (
        <div className="stack">
          <p>Connect your Pinterest account to list your boards. Only read access is requested.</p>
          <div className="row">
            <div className="spacer" />
            <a className="btn primary" href="/api/pinterest/connect">
              Connect Pinterest
            </a>
          </div>
        </div>
      ) : error ? (
        <div className="error-box">{error}</div>
      ) : boards === null ? (
        <Spinner />
      ) : (
        <div className="stack" style={{ gap: 4 }}>
          <p className="muted small" style={{ marginTop: 0 }}>
            Importing a board again pulls only pins added since the last import.
          </p>
          {boards.map((b) => (
            <div key={b.id} className="list-row" style={{ cursor: "default" }}>
              {b.coverUrl ? <img src={b.coverUrl} alt="" /> : <span style={{ width: 32 }} />}
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{b.name}</div>
                <div className="muted small">{b.pinCount} pins</div>
              </div>
              <button className="btn sm primary" disabled={busy !== null} onClick={() => importBoard(b)}>
                {busy === b.id ? <Spinner /> : "Import"}
              </button>
            </div>
          ))}
          {boards.length === 0 && <div className="muted">No boards found on this account.</div>}
        </div>
      )}
    </Modal>
  );
}
