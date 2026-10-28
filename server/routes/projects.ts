import type { FastifyInstance } from "fastify";
import type { Layout, LayoutLine, Project, Room, RoomState, RoomStyle, Zone } from "../../shared/types.ts";
import { db, newId, now } from "../db.ts";
import { emptyLayout, getCollection, getItems, getProject, getRoom, listConfigurations, listItems, listProjects, saveProject, saveRoom } from "../repo.ts";
import { arrangeRoom, checkRoomFit, explainClaudeError, layoutFromImage, type LayoutDraft } from "../claude.ts";
import { getImage } from "../storage.ts";

const ZONE_COLORS = ["#d9c7a7", "#b9c9b1", "#c7b6c9", "#a9bfcf", "#e0b9a3"];

/** Converts Claude's draft (pixels or cm) into a plan in cm, with the source image as a tracing background. */
function draftToLayout(draft: LayoutDraft, imageId: string, base: Layout): Layout {
  const inPixels = draft.coordinateSpace === "image-pixels";
  const s = inPixels ? Math.max(0.05, draft.cmPerPixel || 1) : 1;
  const p = (x: number, y: number) => ({ x: Math.round(x * s * 10) / 10, y: Math.round(y * s * 10) / 10 });
  const lines: LayoutLine[] = draft.elements
    .filter((e) => Math.hypot(e.x2 - e.x1, e.y2 - e.y1) * s >= 5)
    .map((e) => {
      const line: LayoutLine = { id: newId(), type: e.type, a: p(e.x1, e.y1), b: p(e.x2, e.y2) };
      if (e.type === "door" && e.swing !== "none") line.swing = e.swing;
      if (e.type === "dimension") {
        const v = parseFloat(e.label);
        if (Number.isFinite(v) && v > 0) line.realLength = v;
      } else if (e.label) line.label = e.label;
      return line;
    });
  const zones: Zone[] = draft.zones
    .filter((z) => z.points.length >= 3)
    .map((z, i) => ({ id: newId(), label: z.label, color: ZONE_COLORS[i % ZONE_COLORS.length], points: z.points.map((pt) => p(pt.x, pt.y)) }));
  const img = getImage(imageId);
  return {
    ...base,
    lines,
    zones,
    points: [],
    ceilingHeight: draft.ceilingHeight > 180 && draft.ceilingHeight < 600 ? draft.ceilingHeight : base.ceilingHeight,
    background:
      inPixels && img
        ? {
            imageId,
            x: 0,
            y: 0,
            // Claude saw a resized copy; convert its scale to the stored image's pixels
            cmPerPx: s * (draft.imageWidth / img.width),
            opacity: 0.45,
            width: img.width,
            height: img.height,
          }
        : null,
  };
}

export async function projectRoutes(app: FastifyInstance) {
  app.get("/api/projects", async () => listProjects());

  app.post<{ Body: { name: string; description?: string } }>("/api/projects", async (req) => {
    const p: Project = {
      id: newId(),
      name: req.body.name?.trim() || "Untitled project",
      description: req.body.description ?? "",
      createdAt: now(),
      updatedAt: now(),
    };
    saveProject(p);
    return getProject(p.id);
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    return getProject(req.params.id) ?? reply.code(404).send({ error: "Not found" });
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string } }>("/api/projects/:id", async (req, reply) => {
    const p = getProject(req.params.id);
    if (!p) return reply.code(404).send({ error: "Not found" });
    saveProject({ ...p, name: req.body.name ?? p.name, description: req.body.description ?? p.description });
    return getProject(p.id);
  });

  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (req) => {
    db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
    return { ok: true };
  });

  // ----- Rooms -----
  app.post<{ Params: { id: string }; Body: { name?: string; layout?: Layout; sourceImageId?: string } }>(
    "/api/projects/:id/rooms",
    async (req, reply) => {
      if (!getProject(req.params.id)) return reply.code(404).send({ error: "Project not found" });
      const room: Room = {
        id: newId(),
        projectId: req.params.id,
        name: req.body.name?.trim() || "New room",
        layout: { ...emptyLayout(), ...(req.body.layout ?? {}) },
        state: { placements: [], staging: [] },
        style: { collectionId: null, fit: null },
        sourceImageId: req.body.sourceImageId ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      return saveRoom(room);
    },
  );

  app.get<{ Params: { id: string } }>("/api/rooms/:id", async (req, reply) => {
    return getRoom(req.params.id) ?? reply.code(404).send({ error: "Not found" });
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; layout?: Layout; state?: RoomState; style?: RoomStyle; sourceImageId?: string | null } }>(
    "/api/rooms/:id",
    async (req, reply) => {
      const room = getRoom(req.params.id);
      if (!room) return reply.code(404).send({ error: "Not found" });
      const b = req.body;
      return saveRoom({
        ...room,
        name: b.name ?? room.name,
        layout: b.layout ?? room.layout,
        state: b.state ?? room.state,
        style: b.style ?? room.style,
        sourceImageId: b.sourceImageId !== undefined ? b.sourceImageId : room.sourceImageId,
      });
    },
  );

  app.delete<{ Params: { id: string } }>("/api/rooms/:id", async (req) => {
    db.prepare("DELETE FROM rooms WHERE id = ?").run(req.params.id);
    return { ok: true };
  });

  /** Asks Claude to draft a layout from a plan or photo. The draft is returned for review, not saved. */
  app.post<{ Params: { id: string }; Body: { imageId: string; hint?: string } }>("/api/rooms/:id/draft-layout", async (req, reply) => {
    const room = getRoom(req.params.id);
    if (!room) return reply.code(404).send({ error: "Not found" });
    try {
      const draft = await layoutFromImage(req.body.imageId, req.body.hint ?? "");
      return {
        layout: draftToLayout(draft, req.body.imageId, room.layout),
        notes: draft.notes,
        scaleReasoning: draft.scaleReasoning,
        imageKind: draft.imageKind,
      };
    } catch (err) {
      const e = explainClaudeError(err);
      return reply.code(e.status).send({ error: e.message });
    }
  });

  /** Asks Claude whether each piece in the room (placed or staged) suits the linked board's style. */
  app.post<{ Params: { id: string } }>("/api/rooms/:id/style-check", async (req, reply) => {
    const room = getRoom(req.params.id);
    if (!room) return reply.code(404).send({ error: "Not found" });
    const c = room.style.collectionId ? getCollection(room.style.collectionId) : null;
    if (!c?.summary) return reply.code(400).send({ error: "Link this room to a summarized board first." });
    const itemIds = [...new Set([...room.state.placements.map((p) => p.itemId), ...room.state.staging])];
    try {
      const fit = await checkRoomFit(c.summary, getItems(itemIds));
      return saveRoom({ ...room, style: { ...room.style, fit: { checkedAt: new Date().toISOString(), itemIds, ...fit } } });
    } catch (err) {
      const e = explainClaudeError(err);
      return reply.code(e.status).send({ error: e.message });
    }
  });

  /** Asks Claude to move or place pieces. Returns a proposal for the user to apply; nothing is saved. */
  app.post<{ Params: { id: string }; Body: { instruction: string; includeStaging?: boolean } }>("/api/rooms/:id/arrange", async (req, reply) => {
    const room = getRoom(req.params.id);
    if (!room) return reply.code(404).send({ error: "Not found" });
    const instruction = req.body.instruction?.trim();
    if (!instruction) return reply.code(400).send({ error: "Describe what you'd like arranged." });
    const items = new Map(listItems().map((i) => [i.id, i]));
    const staging = req.body.includeStaging === false ? [] : room.state.staging.filter((id) => items.get(id)?.model);
    const c = room.style.collectionId ? getCollection(room.style.collectionId) : null;
    try {
      return await arrangeRoom(room, items, instruction, staging, c?.summary ?? null);
    } catch (err) {
      const e = explainClaudeError(err);
      return reply.code(e.status).send({ error: e.message });
    }
  });

  // ----- Saved configurations -----
  app.get<{ Params: { id: string } }>("/api/rooms/:id/configurations", async (req) => listConfigurations(req.params.id));

  app.post<{ Params: { id: string }; Body: { name: string } }>("/api/rooms/:id/configurations", async (req, reply) => {
    const room = getRoom(req.params.id);
    if (!room) return reply.code(404).send({ error: "Not found" });
    const id = newId();
    db.prepare("INSERT INTO configurations (id, room_id, name, state, created_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      room.id,
      req.body.name?.trim() || `Arrangement ${new Date().toLocaleString()}`,
      JSON.stringify(room.state),
      now(),
    );
    return listConfigurations(room.id);
  });

  app.post<{ Params: { id: string } }>("/api/configurations/:id/apply", async (req, reply) => {
    const row = db.prepare("SELECT room_id, state FROM configurations WHERE id = ?").get(req.params.id) as
      | { room_id: string; state: string }
      | undefined;
    const room = row && getRoom(row.room_id);
    if (!row || !room) return reply.code(404).send({ error: "Not found" });
    return saveRoom({ ...room, state: JSON.parse(row.state) });
  });

  app.delete<{ Params: { id: string } }>("/api/configurations/:id", async (req) => {
    db.prepare("DELETE FROM configurations WHERE id = ?").run(req.params.id);
    return { ok: true };
  });
}
