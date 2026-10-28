import type { FastifyInstance } from "fastify";
import type { Dimensions, LibraryItem, ParametricModel } from "../../shared/types.ts";
import { ITEM_CATEGORIES } from "../../shared/types.ts";
import { buildTemplateModel } from "../../shared/templates.ts";
import { normalizeModel, scaleModelTo } from "../../shared/modelOps.ts";
import { newId, now } from "../db.ts";
import { deleteItem, getItem, listItems, pushVersion, saveItem } from "../repo.ts";
import { editModel, explainClaudeError, generateModel } from "../claude.ts";
import { downloadImage, getImage, saveImage } from "../storage.ts";

const cleanDims = (d: unknown): Partial<Dimensions> => {
  const out: Partial<Dimensions> = {};
  if (d && typeof d === "object") {
    for (const k of ["w", "d", "h"] as const) {
      const v = Number((d as Record<string, unknown>)[k]);
      if (Number.isFinite(v) && v > 0) out[k] = Math.round(v * 10) / 10;
    }
  }
  return out;
};

const cleanCategory = (c: unknown) =>
  typeof c === "string" && (ITEM_CATEGORIES as readonly string[]).includes(c) ? c : "other";

// Generation runs in the background; the client polls the item while status is "generating".
const running = new Set<string>();

function runJob(id: string, job: (item: LibraryItem) => Promise<void>) {
  const item = getItem(id);
  if (!item || running.has(id)) return;
  running.add(id);
  saveItem({ ...item, status: "generating", error: null });
  job(getItem(id)!)
    .catch((err) => {
      const current = getItem(id);
      if (current) saveItem({ ...current, status: current.model ? "ready" : "error", error: explainClaudeError(err).message });
    })
    .finally(() => running.delete(id));
}

function startGeneration(id: string, hint?: string) {
  runJob(id, async (item) => {
    const result = await generateModel(item, hint);
    const fresh = getItem(id)!;
    pushVersion(fresh, result.model, "claude-generate", hint ?? "Generated from photos");
    if (!fresh.name || fresh.name === "Untitled piece") fresh.name = result.name;
    if (fresh.category === "other") fresh.category = result.model.category;
    saveItem({ ...fresh, status: "ready", error: null });
  });
}

export async function itemRoutes(app: FastifyInstance) {
  // ----- Images -----
  app.post("/api/images", async (req) => {
    const out = [];
    for await (const part of req.files()) {
      out.push(await saveImage(await part.toBuffer()));
    }
    return out;
  });

  app.post<{ Body: { url: string } }>("/api/images/from-url", async (req) => downloadImage(req.body.url));

  app.get<{ Params: { id: string } }>("/api/images/:id", async (req, reply) => {
    const img = getImage(req.params.id);
    return img ?? reply.code(404).send({ error: "Not found" });
  });

  // Stable image URLs by id (files may be .jpg or .png)
  app.get<{ Params: { id: string } }>("/api/thumb/:id", async (req, reply) => {
    const img = getImage(req.params.id);
    return img ? reply.header("Cache-Control", "public, max-age=86400").redirect(img.thumbUrl) : reply.code(404).send();
  });
  app.get<{ Params: { id: string } }>("/api/full/:id", async (req, reply) => {
    const img = getImage(req.params.id);
    return img ? reply.header("Cache-Control", "public, max-age=86400").redirect(img.url) : reply.code(404).send();
  });

  // ----- Items -----
  app.get("/api/items", async () => listItems());

  app.get<{ Params: { id: string } }>("/api/items/:id", async (req, reply) => {
    return getItem(req.params.id) ?? reply.code(404).send({ error: "Not found" });
  });

  app.post<{
    Body: {
      name?: string;
      category?: string;
      photoIds?: string[];
      knownDims?: Partial<Dimensions>;
      notes?: string;
      tags?: string[];
      generate?: "claude" | "template";
    };
  }>("/api/items", async (req) => {
    const b = req.body;
    const knownDims = cleanDims(b.knownDims);
    const category = cleanCategory(b.category);
    const item: LibraryItem = {
      id: newId(),
      name: b.name?.trim() || "Untitled piece",
      category,
      photoIds: b.photoIds ?? [],
      knownDims,
      notes: b.notes ?? "",
      tags: b.tags ?? [],
      model: null,
      history: [],
      status: "draft",
      error: null,
      createdAt: now(),
      updatedAt: now(),
    };
    if (b.generate === "template" || (b.generate !== "claude" && item.photoIds.length === 0)) {
      pushVersion(item, buildTemplateModel(category, knownDims), "template", "Category template");
      item.status = "ready";
    }
    saveItem(item);
    if (item.status !== "ready") startGeneration(item.id);
    return getItem(item.id);
  });

  app.patch<{ Params: { id: string }; Body: Partial<LibraryItem> & { model?: ParametricModel; versionNote?: string } }>(
    "/api/items/:id",
    async (req, reply) => {
      const item = getItem(req.params.id);
      if (!item) return reply.code(404).send({ error: "Not found" });
      const b = req.body;
      if (b.name !== undefined) item.name = b.name;
      if (b.category !== undefined) item.category = cleanCategory(b.category);
      if (b.notes !== undefined) item.notes = b.notes;
      if (b.tags !== undefined) item.tags = b.tags;
      if (b.photoIds !== undefined) item.photoIds = b.photoIds;
      if (b.knownDims !== undefined) {
        item.knownDims = cleanDims(b.knownDims);
        if (item.model && !b.model) {
          pushVersion(item, scaleModelTo(item.model, item.knownDims), "manual", "Matched entered dimensions");
        }
      }
      if (b.model) pushVersion(item, normalizeModel(b.model), "manual", b.versionNote ?? "Adjusted with dials");
      return saveItem(item);
    },
  );

  app.post<{ Params: { id: string }; Body: { mode?: "claude" | "template"; hint?: string } }>(
    "/api/items/:id/generate",
    async (req, reply) => {
      const item = getItem(req.params.id);
      if (!item) return reply.code(404).send({ error: "Not found" });
      if (req.body?.mode === "template") {
        pushVersion(item, buildTemplateModel(item.category, item.knownDims), "template", "Reset to category template");
        return saveItem({ ...item, status: "ready", error: null });
      }
      startGeneration(item.id, req.body?.hint ?? "");
      return getItem(item.id);
    },
  );

  app.post<{ Params: { id: string }; Body: { instruction: string } }>("/api/items/:id/edit", async (req, reply) => {
    const item = getItem(req.params.id);
    if (!item) return reply.code(404).send({ error: "Not found" });
    const instruction = req.body.instruction?.trim();
    if (!instruction) return reply.code(400).send({ error: "Describe the change you want." });
    runJob(item.id, async () => {
      const result = await editModel(getItem(item.id)!, instruction);
      const fresh = getItem(item.id)!;
      pushVersion(fresh, result.model, "claude-edit", instruction);
      saveItem({ ...fresh, status: "ready", error: null });
    });
    return getItem(item.id);
  });

  app.post<{ Params: { id: string }; Body: { versionId: string } }>("/api/items/:id/revert", async (req, reply) => {
    const item = getItem(req.params.id);
    const version = item?.history.find((v) => v.id === req.body.versionId);
    if (!item || !version) return reply.code(404).send({ error: "Not found" });
    pushVersion(item, version.model, "manual", `Restored version from ${new Date(version.createdAt).toLocaleString()}`);
    return saveItem(item);
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/duplicate", async (req, reply) => {
    const item = getItem(req.params.id);
    if (!item) return reply.code(404).send({ error: "Not found" });
    return saveItem({ ...item, id: newId(), name: `${item.name} (copy)`, history: item.history.slice(0, 1), createdAt: now() });
  });

  app.delete<{ Params: { id: string } }>("/api/items/:id", async (req) => {
    deleteItem(req.params.id);
    return { ok: true };
  });
}
