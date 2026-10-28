import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ImageRecord, LayoutLine, Project } from "../../shared/types.ts";
import { api } from "../lib/api.ts";
import { toast, toastError, useApp } from "../lib/store.ts";
import { Empty, Icon, ImageDrop, LengthInput, Modal, Spinner } from "../components/ui.tsx";
import { PlanThumb } from "../layout/PlanThumb.tsx";

export function ProjectPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    api.project(id).then(setProject).catch(toastError);
  }, [id]);
  if (!project)
    return (
      <div className="page">
        <Spinner />
      </div>
    );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/projects" className="eyebrow" style={{ textDecoration: "none" }}>
            ← Projects
          </Link>
          <h1>{project.name}</h1>
          {project.description && <p>{project.description}</p>}
        </div>
        <div className="row">
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm(`Delete project "${project.name}" and all its rooms?`)) return;
              await api.deleteProject(project.id);
              navigate("/projects");
            }}
          >
            Delete
          </button>
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> New room
          </button>
        </div>
      </div>
      {(project.rooms ?? []).length === 0 ? (
        <Empty title="No rooms yet">
          <p>Draw a layout, type in dimensions, or let Claude read a floor plan or a photo of the room.</p>
          <button className="btn primary" onClick={() => setAdding(true)}>
            Add a room
          </button>
        </Empty>
      ) : (
        <div className="project-grid">
          {project.rooms!.map((r) => (
            <Link key={r.id} to={`/rooms/${r.id}`} className="card project-card">
              <PlanThumb layout={r.layout} />
              <div className="row">
                <h3>{r.name}</h3>
                <div className="spacer" />
                <span className="muted small">
                  {r.state.placements.length} piece{r.state.placements.length === 1 ? "" : "s"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {adding && <NewRoomModal projectId={project.id} onClose={() => setAdding(false)} />}
    </div>
  );
}

type Start = "draw" | "rectangle" | "plan" | "photo";

function rectangleWalls(w: number, d: number): LayoutLine[] {
  const pts = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: 0, y: d },
  ];
  return pts.map((a, i) => ({ id: `w${i}`, type: "wall-exterior", a, b: pts[(i + 1) % 4] }));
}

function NewRoomModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const hasKey = useApp((s) => s.settings?.hasAnthropicKey);
  const [name, setName] = useState("");
  const [start, setStart] = useState<Start>("rectangle");
  const [w, setW] = useState<number | undefined>(450);
  const [d, setD] = useState<number | undefined>(380);
  const [image, setImage] = useState<ImageRecord | null>(null);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const fromImage = start === "plan" || start === "photo";

  async function create() {
    setBusy(true);
    try {
      const layout = start === "rectangle" && w && d ? { lines: rectangleWalls(w, d) } : undefined;
      const room = await api.createRoom(projectId, { name: name || defaultName(start), layout, sourceImageId: image?.id });
      if (fromImage && image) {
        if (hasKey) {
          try {
            const draft = await api.draftLayout(room.id, image.id, hint);
            await api.updateRoom(room.id, { layout: draft.layout });
            sessionStorage.setItem(`draft-notes:${room.id}`, JSON.stringify({ notes: draft.notes, scale: draft.scaleReasoning }));
          } catch (err) {
            toastError(err);
            toast("Opening the image for manual tracing instead");
            await api.updateRoom(room.id, { layout: { ...room.layout, background: traceBackground(image) } });
          }
        } else {
          await api.updateRoom(room.id, { layout: { ...room.layout, background: traceBackground(image) } });
        }
      }
      navigate(`/rooms/${room.id}`);
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New room"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || (fromImage && !image)} onClick={create}>
            {busy ? (
              <>
                <Spinner /> {fromImage && hasKey ? "Claude is reading the image…" : "Creating…"}
              </>
            ) : fromImage && hasKey ? (
              <>
                <Icon name="sparkle" size={14} /> Draft the layout
              </>
            ) : (
              "Create room"
            )}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="field">
          <label>Room name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName(start)} />
        </div>
        <div className="choice-grid">
          {(
            [
              ["rectangle", "Start from dimensions", "Four walls from a width and depth. Add doors and windows next."],
              ["draw", "Draw from scratch", "An empty canvas with wall, door, window and fixture tools."],
              ["plan", "From a floor plan or sketch", "Upload a drawing. Claude drafts the walls and openings for you to correct."],
              ["photo", "From a room photo", "Claude estimates a rough plan from a photo taken inside the room."],
            ] as [Start, string, string][]
          ).map(([key, title, desc]) => (
            <button key={key} className={`choice ${start === key ? "on" : ""}`} onClick={() => setStart(key)}>
              <strong>{title}</strong>
              <span className="muted small">{desc}</span>
            </button>
          ))}
        </div>
        {start === "rectangle" && (
          <div className="grid-2">
            <div className="field">
              <label>Width</label>
              <LengthInput value={w} onChange={setW} />
            </div>
            <div className="field">
              <label>Depth</label>
              <LengthInput value={d} onChange={setD} />
            </div>
          </div>
        )}
        {fromImage && (
          <>
            {image ? (
              <div className="row">
                <img src={image.thumbUrl} className="thumb" style={{ width: 120, height: 90 }} alt="" />
                <button className="btn sm" onClick={() => setImage(null)}>
                  Choose another
                </button>
              </div>
            ) : (
              <ImageDrop multiple={false} onUploaded={(imgs) => setImage(imgs[0])} label={start === "plan" ? "Drop a floor plan, blueprint or hand sketch" : "Drop a photo of the room"} />
            )}
            <div className="field">
              <label>Anything Claude should know?</label>
              <input
                className="input"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="e.g. 'the long wall is 5.2 m', 'ignore the balcony', 'ceilings are 2.7 m'"
              />
              <span className="hint">One real measurement makes the scale much more accurate. You can also calibrate it later with a dimension line.</span>
            </div>
            {!hasKey && <div className="note-box">No API key set, so the image opens as a tracing background and you draw the walls over it.</div>}
          </>
        )}
      </div>
    </Modal>
  );
}

function defaultName(start: Start) {
  return start === "photo" ? "Room from photo" : start === "plan" ? "Room from plan" : "Living room";
}

function traceBackground(img: ImageRecord) {
  // Assume roughly 1 cm per pixel until calibrated with a dimension line
  return { imageId: img.id, x: 0, y: 0, cmPerPx: 1, opacity: 0.5, width: img.width, height: img.height };
}
