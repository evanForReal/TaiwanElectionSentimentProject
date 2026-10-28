import type { LibraryItem } from "../../shared/types.ts";
import { useModelThumbnail } from "../three/thumbnails.ts";
import { Spinner, categoryLabel, useLen } from "./ui.tsx";

export function useItemThumb(item: LibraryItem | undefined | null) {
  return useModelThumbnail(item ? `${item.id}:${item.updatedAt}` : "", item?.model ?? null);
}

export function ItemThumb({ item, className }: { item: LibraryItem; className?: string }) {
  const thumb = useItemThumb(item);
  if (thumb) return <img src={thumb} alt={item.name} className={className} />;
  if (item.photoIds[0]) return <PhotoThumb id={item.photoIds[0]} className={className} alt={item.name} />;
  return <span className={className} />;
}

export function ItemCard({ item, onClick }: { item: LibraryItem; onClick: () => void }) {
  const len = useLen();
  const thumb = useItemThumb(item);
  return (
    <button className="card item-card" onClick={onClick}>
      <div className="art">
        {thumb ? <img src={thumb} alt="" /> : <span className="muted small">{item.status === "generating" ? "" : "No model yet"}</span>}
        {item.photoIds[0] && <PhotoThumb id={item.photoIds[0]} className="photo" />}
        <div className="status">
          {item.status === "generating" && (
            <span className="chip accent">
              <Spinner /> Modeling
            </span>
          )}
          {item.status === "error" && <span className="chip danger">Needs attention</span>}
        </div>
      </div>
      <div className="meta">
        <div className="name">{item.name}</div>
        <div className="muted small">
          {categoryLabel(item.category)}
          {item.model && ` · ${len(item.model.dims.w)} × ${len(item.model.dims.d)} × ${len(item.model.dims.h)}`}
        </div>
      </div>
    </button>
  );
}

/** Renders an uploaded image's thumbnail by id. */
export function PhotoThumb({ id, className, alt = "" }: { id: string; className?: string; alt?: string }) {
  return <img src={`/api/thumb/${id}`} className={className} alt={alt} loading="lazy" />;
}
