import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Project } from "../../shared/types.ts";
import { api } from "../lib/api.ts";
import { toastError } from "../lib/store.ts";
import { Empty, Icon, Modal, Spinner } from "../components/ui.tsx";
import { PlanThumb } from "../layout/PlanThumb.tsx";

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    api.projects().then(setProjects).catch(toastError);
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Projects</div>
          <h1>Spaces you're designing</h1>
          <p>Each project holds rooms. Sketch a layout or start from a floor plan or photo, then arrange pieces from your library in 3D.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" /> New project
        </button>
      </div>
      {projects === null ? (
        <Spinner />
      ) : projects.length === 0 ? (
        <Empty title="No projects yet">
          <p>Start with the space you're working on: an apartment, a house, a single room.</p>
          <button className="btn primary" onClick={() => setCreating(true)}>
            Create a project
          </button>
        </Empty>
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="card project-card">
              {p.rooms?.[0] ? <PlanThumb layout={p.rooms[0].layout} /> : <div className="plan-thumb" />}
              <div>
                <h3>{p.name}</h3>
                {p.description && <div className="muted small">{p.description}</div>}
              </div>
              <div className="room-chips">
                {(p.rooms ?? []).map((r) => (
                  <span key={r.id} className="chip">
                    {r.name}
                  </span>
                ))}
                {(p.rooms ?? []).length === 0 && <span className="muted small">No rooms yet</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const submit = async () => {
    try {
      const p = await api.createProject(name, description);
      navigate(`/projects/${p.id}`);
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <Modal
      title="New project"
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
      <div className="stack">
        <div className="field">
          <label>Name</label>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="e.g. Taipei apartment" />
        </div>
        <div className="field">
          <label>Description</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </div>
      </div>
    </Modal>
  );
}
