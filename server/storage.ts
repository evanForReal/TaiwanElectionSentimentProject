import fs from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import type { ImageRecord } from "../shared/types.ts";
import { UPLOAD_DIR, db, newId, now } from "./db.ts";

interface ImageRow {
  id: string;
  file: string;
  thumb: string;
  mime: string;
  width: number;
  height: number;
}

export function toImageRecord(row: ImageRow): ImageRecord {
  return {
    id: row.id,
    url: `/uploads/${row.file}`,
    thumbUrl: `/uploads/${row.thumb}`,
    width: row.width,
    height: row.height,
    mime: row.mime,
  };
}

export function getImage(id: string): ImageRecord | null {
  const row = db.prepare("SELECT * FROM images WHERE id = ?").get(id) as ImageRow | undefined;
  return row ? toImageRecord(row) : null;
}

/** Stores an uploaded or downloaded image, normalized to at most 2048px plus a 480px thumbnail. */
export async function saveImage(buffer: Buffer, sourceUrl: string | null = null): Promise<ImageRecord> {
  const id = newId();
  const img = sharp(buffer, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const keepAlpha = meta.hasAlpha === true;
  const ext = keepAlpha ? "png" : "jpg";
  const mime = keepAlpha ? "image/png" : "image/jpeg";
  const file = `${id}.${ext}`;
  const thumb = `${id}_t.${ext}`;
  const resized = img.clone().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true });
  const encode = (s: Sharp) => (keepAlpha ? s.png({ compressionLevel: 8 }) : s.jpeg({ quality: 86, mozjpeg: true }));
  const info = await encode(resized).toFile(path.join(UPLOAD_DIR, file));
  await encode(img.clone().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })).toFile(
    path.join(UPLOAD_DIR, thumb),
  );
  db.prepare(
    "INSERT INTO images (id, file, thumb, mime, width, height, source_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, file, thumb, mime, info.width, info.height, sourceUrl, now());
  return { id, url: `/uploads/${file}`, thumbUrl: `/uploads/${thumb}`, width: info.width, height: info.height, mime };
}

export async function downloadImage(url: string): Promise<ImageRecord> {
  const res = await fetch(url, { headers: { "User-Agent": "InteriorStudio/0.1" } });
  if (!res.ok) throw new Error(`Image download failed (${res.status})`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error(`URL is not an image (${type || "unknown type"})`);
  return saveImage(Buffer.from(await res.arrayBuffer()), url);
}

/** Base64 JPEG for a Claude image block. 1568px on the long edge is Claude's native resolution. */
export async function imageForClaude(id: string, maxEdge = 1568): Promise<{ data: string; width: number; height: number }> {
  const row = db.prepare("SELECT * FROM images WHERE id = ?").get(id) as ImageRow | undefined;
  if (!row) throw new Error(`Image ${id} not found`);
  const buf = await fs.readFile(path.join(UPLOAD_DIR, row.file));
  const { data, info } = await sharp(buf)
    .flatten({ background: "#ffffff" })
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return { data: data.toString("base64"), width: info.width, height: info.height };
}

export async function deleteImage(id: string) {
  const row = db.prepare("SELECT * FROM images WHERE id = ?").get(id) as ImageRow | undefined;
  if (!row) return;
  db.prepare("DELETE FROM images WHERE id = ?").run(id);
  await Promise.allSettled([fs.unlink(path.join(UPLOAD_DIR, row.file)), fs.unlink(path.join(UPLOAD_DIR, row.thumb))]);
}
