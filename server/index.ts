import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import type { AppSettings } from "../shared/types.ts";
import { UPLOAD_DIR, db, getSetting, setSetting } from "./db.ts";
import { MODEL, anthropicKey } from "./claude.ts";
import { pinterestConfig, pinterestConnected } from "./pinterest.ts";
import { itemRoutes } from "./routes/items.ts";
import { projectRoutes } from "./routes/projects.ts";
import { collectionRoutes } from "./routes/collections.ts";

// Load .env without a dependency
if (fs.existsSync(".env")) {
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// A restart interrupts background generation; don't leave items spinning forever
db.prepare(
  "UPDATE items SET status = CASE WHEN model IS NULL THEN 'error' ELSE 'ready' END, error = 'Generation was interrupted by a server restart.' WHERE status = 'generating'",
).run();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 10 * 1024 * 1024 });
await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 30 } });
await app.register(fastifyStatic, { root: UPLOAD_DIR, prefix: "/uploads/", decorateReply: false, maxAge: "30d" });

function settings(): AppSettings {
  const key = anthropicKey();
  return {
    units: (getSetting("units") as AppSettings["units"]) ?? "metric",
    hasAnthropicKey: key !== null,
    anthropicKeySource: key?.source ?? null,
    pinterestConfigured: pinterestConfig().configured,
    pinterestConnected: pinterestConnected(),
    model: MODEL,
  };
}

app.get("/api/settings", async () => ({ ...settings(), pinterestRedirectUri: pinterestConfig().redirectUri }));

app.patch<{
  Body: {
    units?: AppSettings["units"];
    anthropicKey?: string | null;
    pinterestClientId?: string;
    pinterestClientSecret?: string;
    pinterestRedirectUri?: string;
  };
}>("/api/settings", async (req) => {
  const b = req.body;
  if (b.units === "metric" || b.units === "imperial") setSetting("units", b.units);
  if (b.anthropicKey !== undefined) setSetting("anthropic_api_key", b.anthropicKey?.trim() || null);
  if (b.pinterestClientId !== undefined) setSetting("pinterest_client_id", b.pinterestClientId.trim() || null);
  if (b.pinterestClientSecret !== undefined) setSetting("pinterest_client_secret", b.pinterestClientSecret.trim() || null);
  if (b.pinterestRedirectUri !== undefined) setSetting("pinterest_redirect_uri", b.pinterestRedirectUri.trim() || null);
  return { ...settings(), pinterestRedirectUri: pinterestConfig().redirectUri };
});

await app.register(itemRoutes);
await app.register(projectRoutes);
await app.register(collectionRoutes);

app.setErrorHandler((err, _req, reply) => {
  app.log.error(err);
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  reply.code(status).send({ error: err instanceof Error ? err.message : String(err) });
});

// In production, serve the built web app too
const dist = path.resolve("dist");
if (process.env.NODE_ENV === "production" && fs.existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist, prefix: "/", decorateReply: true, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
    return reply.sendFile("index.html");
  });
}

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
