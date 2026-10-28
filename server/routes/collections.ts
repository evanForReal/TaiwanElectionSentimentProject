import type { FastifyInstance } from "fastify";
import type { Collection } from "../../shared/types.ts";
import { db, newId, now } from "../db.ts";
import {
  deleteOrphanPins,
  deletePin,
  findPinByPinterestId,
  getCollection,
  getItems,
  getPin,
  insertPin,
  linkPin,
  listAllPins,
  listCollections,
  listItems,
  listPins,
  saveCollection,
  unlinkPin,
} from "../repo.ts";
import { explainClaudeError, matchItems, summarizeCollection } from "../claude.ts";
import { downloadImage } from "../storage.ts";
import {
  authorizeUrl,
  disconnectPinterest,
  handleCallback,
  listBoardPins,
  listBoards,
  pinterestConfig,
  resolvePastedUrl,
} from "../pinterest.ts";

function newCollection(name: string, extra: Partial<Collection> = {}): Collection {
  return saveCollection({
    id: newId(),
    name: name.trim() || "Untitled collection",
    source: "manual",
    pinterestBoardId: null,
    summary: null,
    itemIds: [],
    createdAt: now(),
    updatedAt: now(),
    ...extra,
  });
}

export async function collectionRoutes(app: FastifyInstance) {
  app.get("/api/collections", async () => listCollections());

  app.post<{ Body: { name: string } }>("/api/collections", async (req) => newCollection(req.body.name ?? ""));

  app.get<{ Params: { id: string } }>("/api/collections/:id", async (req, reply) => {
    const c = getCollection(req.params.id);
    if (!c) return reply.code(404).send({ error: "Not found" });
    return { ...c, pins: listPins(c.id) };
  });

  app.patch<{ Params: { id: string }; Body: { name?: string } }>("/api/collections/:id", async (req, reply) => {
    const c = getCollection(req.params.id);
    if (!c) return reply.code(404).send({ error: "Not found" });
    return saveCollection({ ...c, name: req.body.name ?? c.name });
  });

  app.delete<{ Params: { id: string } }>("/api/collections/:id", async (req) => {
    db.prepare("DELETE FROM collections WHERE id = ?").run(req.params.id);
    deleteOrphanPins();
    return { ok: true };
  });

  /**
   * Adds pins to a collection: existing pins by id (a pin can live in many collections),
   * new uploads by image id, and pasted URLs. Per-URL failures are reported, not fatal.
   */
  app.post<{ Params: { id: string }; Body: { pinIds?: string[]; imageIds?: string[]; urls?: string[] } }>(
    "/api/collections/:id/pins",
    async (req, reply) => {
      const c = getCollection(req.params.id);
      if (!c) return reply.code(404).send({ error: "Not found" });
      const added = [];
      const failed: { url: string; error: string }[] = [];
      for (const pinId of req.body.pinIds ?? []) {
        if (getPin(pinId) && linkPin(pinId, c.id)) added.push(getPin(pinId)!);
      }
      for (const imageId of req.body.imageIds ?? []) {
        added.push(insertPin({ imageId, imageUrl: null, title: "", link: null, pinterestPinId: null }, c.id));
      }
      for (const raw of req.body.urls ?? []) {
        const url = raw.trim();
        if (!url) continue;
        try {
          const r = await resolvePastedUrl(url);
          const existing = r.pinId ? findPinByPinterestId(r.pinId) : null;
          if (existing) {
            if (linkPin(existing.id, c.id)) added.push(getPin(existing.id)!);
            continue;
          }
          const img = await downloadImage(r.imageUrl);
          added.push(insertPin({ imageId: img.id, imageUrl: r.imageUrl, title: r.title, link: r.link, pinterestPinId: r.pinId }, c.id));
        } catch (err) {
          failed.push({ url, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return { added, failed };
    },
  );

  /** Removes pins from this collection only. Pins left in no collection are deleted. */
  app.post<{ Params: { id: string }; Body: { pinIds: string[] } }>("/api/collections/:id/pins/remove", async (req) => {
    for (const pinId of req.body.pinIds ?? []) unlinkPin(pinId, req.params.id);
    return { ok: true };
  });

  /** Every pin across all collections, for adding existing pins to another collection. */
  app.get("/api/pins", async () => listAllPins());

  app.delete<{ Params: { id: string } }>("/api/pins/:id", async (req) => {
    deletePin(req.params.id);
    return { ok: true };
  });

  /** Adds pins to another collection; with `from`, also takes them out of that one (a move). */
  app.post<{ Body: { pinIds: string[]; to: string; from?: string } }>("/api/pins/link", async (req, reply) => {
    if (!getCollection(req.body.to)) return reply.code(404).send({ error: "Collection not found" });
    for (const pinId of req.body.pinIds) {
      if (!getPin(pinId)) continue;
      linkPin(pinId, req.body.to);
      if (req.body.from && req.body.from !== req.body.to) unlinkPin(pinId, req.body.from);
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { pinIds?: string[] } }>("/api/collections/:id/summarize", async (req, reply) => {
    const c = getCollection(req.params.id);
    if (!c) return reply.code(404).send({ error: "Not found" });
    let pins = listPins(c.id);
    if (req.body?.pinIds?.length) pins = pins.filter((p) => req.body.pinIds!.includes(p.id));
    try {
      const summary = await summarizeCollection(c.name, pins);
      return saveCollection({ ...c, summary: { ...summary, pinIds: pins.map((p) => p.id), createdAt: now() } });
    } catch (err) {
      const e = explainClaudeError(err);
      return reply.code(e.status).send({ error: e.message });
    }
  });

  app.post<{ Params: { id: string }; Body: { request?: string } }>("/api/collections/:id/match", async (req, reply) => {
    const c = getCollection(req.params.id);
    if (!c) return reply.code(404).send({ error: "Not found" });
    if (!c.summary) return reply.code(400).send({ error: "Summarize this collection first." });
    const items = listItems().filter((i) => i.model);
    if (items.length === 0) return { matches: [], missingEssentials: c.summary.essentials.map((e) => ({ name: e.name, category: e.category, suggestion: e.why })) };
    try {
      return await matchItems(c.summary, items, req.body?.request ?? "");
    } catch (err) {
      const e = explainClaudeError(err);
      return reply.code(e.status).send({ error: e.message });
    }
  });

  app.post<{ Params: { id: string }; Body: { itemIds: string[]; mode: "add" | "remove" | "set" } }>(
    "/api/collections/:id/items",
    async (req, reply) => {
      const c = getCollection(req.params.id);
      if (!c) return reply.code(404).send({ error: "Not found" });
      const ids = new Set(getItems(req.body.itemIds).map((i) => i.id));
      let itemIds = c.itemIds;
      if (req.body.mode === "set") itemIds = [...ids];
      else if (req.body.mode === "remove") itemIds = itemIds.filter((i) => !ids.has(i));
      else itemIds = [...new Set([...itemIds, ...ids])];
      return saveCollection({ ...c, itemIds });
    },
  );

  // ----- Pinterest -----
  app.get("/api/pinterest/connect", async (_req, reply) => {
    if (!pinterestConfig().configured) return reply.code(412).send({ error: "Add your Pinterest app credentials in Settings first." });
    return reply.redirect(authorizeUrl());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/pinterest/callback", async (req, reply) => {
    const back = process.env.NODE_ENV === "production" ? "/" : "http://localhost:5173/";
    if (req.query.error || !req.query.code) return reply.redirect(`${back}settings?pinterest=denied`);
    try {
      await handleCallback(req.query.code, req.query.state ?? "");
      return reply.redirect(`${back}boards?pinterest=connected`);
    } catch (err) {
      return reply.redirect(`${back}settings?pinterest=error&message=${encodeURIComponent(String((err as Error).message))}`);
    }
  });

  app.post("/api/pinterest/disconnect", async () => {
    disconnectPinterest();
    return { ok: true };
  });

  app.get("/api/pinterest/boards", async (_req, reply) => {
    try {
      return await listBoards();
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  /**
   * Imports (or re-syncs) a Pinterest board into a collection. Pins already imported are
   * skipped, so pressing it again only pulls new pins.
   */
  app.post<{ Body: { boardId: string; boardName: string; collectionId?: string } }>("/api/pinterest/import", async (req, reply) => {
    try {
      const existing =
        (req.body.collectionId && getCollection(req.body.collectionId)) ||
        listCollections().find((c) => c.pinterestBoardId === req.body.boardId) ||
        null;
      const c =
        existing ??
        newCollection(req.body.boardName, { source: "pinterest", pinterestBoardId: req.body.boardId });
      const have = new Set(listPins(c.id).map((p) => p.pinterestPinId).filter(Boolean));
      const remote = await listBoardPins(req.body.boardId);
      let added = 0;
      const failed: string[] = [];
      for (const p of remote) {
        if (have.has(p.id) || !p.imageUrl) continue;
        try {
          // A pin already saved in another collection is shared rather than downloaded again
          const existing = findPinByPinterestId(p.id);
          if (existing) linkPin(existing.id, c.id);
          else {
            const img = await downloadImage(p.imageUrl);
            insertPin({ imageId: img.id, imageUrl: p.imageUrl, title: p.title, link: p.link, pinterestPinId: p.id }, c.id);
          }
          added++;
        } catch {
          failed.push(p.id);
        }
      }
      if (!c.pinterestBoardId) saveCollection({ ...c, source: "pinterest", pinterestBoardId: req.body.boardId });
      return { collectionId: c.id, added, skipped: remote.length - added - failed.length, failed: failed.length };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}
