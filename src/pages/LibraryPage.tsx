import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ITEM_CATEGORIES, type Dimensions, type ImageRecord } from "../../shared/types.ts";
import { DEFAULT_DIMS } from "../../shared/templates.ts";
import { api } from "../lib/api.ts";
import { toastError, useApp } from "../lib/store.ts";
import { Empty, Icon, ImageDrop, LengthInput, Modal, Spinner, categoryLabel, useInterval } from "../components/ui.tsx";
import { ItemCard } from "../components/ItemCard.tsx";

export function LibraryPage() {
  const items = useApp((s) => s.items);
  const loaded = useApp((s) => s.itemsLoaded);
  const loadItems = useApp((s) => s.loadItems);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [adding, setAdding] = useState(false);

  const generating = items.some((i) => i.status === "generating");
  useInterval(() => loadItems().catch(() => {}), generating ? 2500 : null);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))].sort(), [items]);
  const shown = items.filter(
    (i) =>
      (category === "all" || i.category === category) &&
      (!query || `${i.name} ${i.category} ${i.tags.join(" ")} ${i.notes}`.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Library</div>
          <h1>Your pieces</h1>
          <p>
            Every piece becomes a rough 3D model built from your photos. The more you give (several angles, real
            dimensions, notes on materials), the closer the model.
          </p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Add a piece
        </button>
      </div>

      {items.length > 0 && (
        <div className="toolbar">
          <input className="input" style={{ maxWidth: 280 }} placeholder="Search pieces" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="select" style={{ maxWidth: 200 }} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
          <span className="muted small">
            {shown.length} of {items.length}
          </span>
        </div>
      )}

      {!loaded ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty title="Your library is empty">
          <p>Upload a photo of a sofa, lamp or table you own or are considering, and it will be modeled for you.</p>
          <button className="btn primary" onClick={() => setAdding(true)}>
            Add your first piece
          </button>
        </Empty>
      ) : (
        <div className="item-grid">
          {shown.map((item) => (
            <ItemCard key={item.id} item={item} onClick={() => navigate(`/library/${item.id}`)} />
          ))}
        </div>
      )}

      {adding && <NewItemModal onClose={() => setAdding(false)} onCreated={(id) => navigate(`/library/${id}`)} />}
    </div>
  );
}

export function NewItemModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const settings = useApp((s) => s.settings);
  const upsert = useApp((s) => s.upsertItem);
  const [photos, setPhotos] = useState<ImageRecord[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("other");
  const [dims, setDims] = useState<Partial<Dimensions>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const canUseClaude = Boolean(settings?.hasAnthropicKey);
  const placeholder = DEFAULT_DIMS[category] ?? DEFAULT_DIMS.other;

  async function create(mode: "claude" | "template") {
    setBusy(true);
    try {
      const item = await api.createItem({
        name,
        category,
        photoIds: photos.map((p) => p.id),
        knownDims: dims,
        notes,
        generate: mode,
      });
      upsert(item);
      onCreated(item.id);
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add a piece"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={busy} onClick={() => create("template")} title="Use a parametric template for the category, no AI">
            Quick template
          </button>
          <button
            className="btn primary"
            disabled={busy || !canUseClaude || (photos.length === 0 && !notes && !name)}
            onClick={() => create("claude")}
            title={canUseClaude ? "" : "Add an Anthropic API key in Settings"}
          >
            {busy ? <Spinner /> : <Icon name="sparkle" />} Model it with Claude
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="field">
          <label>Photos</label>
          <ImageDrop onUploaded={(imgs) => setPhotos((p) => [...p, ...imgs])} label="Drop photos (several angles help) or click to choose" />
          {photos.length > 0 && (
            <div className="thumbs">
              {photos.map((p) => (
                <div className="thumb-wrap" key={p.id}>
                  <img className="thumb" src={p.thumbUrl} alt="" />
                  <button className="x" onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))} aria-label="Remove">
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grey linen sofa" />
          </div>
          <div className="field">
            <label>Category</label>
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {ITEM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c === "other" ? "Let Claude decide / other" : categoryLabel(c)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Dimensions, if you know them</label>
          <div className="grid-3">
            <LengthInput value={dims.w} onChange={(w) => setDims({ ...dims, w })} placeholder={`W ~${placeholder.w}`} />
            <LengthInput value={dims.d} onChange={(d) => setDims({ ...dims, d })} placeholder={`D ~${placeholder.d}`} />
            <LengthInput value={dims.h} onChange={(h) => setDims({ ...dims, h })} placeholder={`H ~${placeholder.h}`} />
          </div>
          <span className="hint">Width × depth × height. Entered dimensions are matched exactly; blanks are estimated.</span>
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea
            className="textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Materials, colors, details the photo doesn't show, e.g. 'walnut legs, boucle upholstery, the back cushions are loose'"
          />
        </div>
        {!canUseClaude && (
          <div className="note-box">
            Claude modeling needs an Anthropic API key (Settings). Until then, "Quick template" builds a parametric model from the category and dimensions.
          </div>
        )}
      </div>
    </Modal>
  );
}
