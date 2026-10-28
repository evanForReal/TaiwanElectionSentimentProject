import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  ITEM_CATEGORIES,
  LINE_TYPES,
  MATERIAL_KINDS,
  PART_SHAPES,
  type Dimensions,
  type LibraryItem,
  type LineType,
  type ParametricModel,
  type Pin,
  type StyleSummary,
} from "../shared/types.ts";
import { buildTemplateModel } from "../shared/templates.ts";
import { describeModel, normalizeModel, scaleModelTo } from "../shared/modelOps.ts";
import { getSetting } from "./db.ts";
import { imageForClaude } from "./storage.ts";

export const MODEL = "claude-opus-5-5";

// Structured outputs don't enforce enums, so accept any string and sanitize after parsing:
// one unexpected value shouldn't throw away a whole generation.
const oneOf = (values: readonly string[], note = "") => z.string().describe(`One of: ${values.join(", ")}.${note ? ` ${note}` : ""}`);
const pick = <T extends string>(v: string, values: readonly T[], fallback: T): T => ((values as readonly string[]).includes(v) ? (v as T) : fallback);

export class ClaudeUnavailableError extends Error {
  constructor() {
    super("No Anthropic API key configured. Add one on the Settings page or set ANTHROPIC_API_KEY.");
  }
}

export function anthropicKey(): { key: string; source: "env" | "settings" } | null {
  const stored = getSetting("anthropic_api_key");
  if (stored) return { key: stored, source: "settings" };
  if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: "env" };
  return null;
}

let cached: { key: string; client: Anthropic } | null = null;
function client(): Anthropic {
  const k = anthropicKey();
  if (!k) throw new ClaudeUnavailableError();
  if (cached?.key !== k.key) cached = { key: k.key, client: new Anthropic({ apiKey: k.key }) };
  return cached.client;
}

type Content = Anthropic.Beta.Messages.BetaContentBlockParam;
type Effort = "low" | "medium" | "high";

/**
 * One structured-output request. Server-side fallbacks are on so that a request declined by
 * a safety classifier is re-run on Anthropic's recommended fallback model instead of failing.
 */
async function structured<S extends z.ZodType>(
  schema: S,
  opts: { system: string; content: Content[]; effort: Effort; maxTokens?: number },
): Promise<z.infer<S>> {
  const res = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: opts.system,
    messages: [{ role: "user", content: opts.content }],
    output_config: { effort: opts.effort, format: betaZodOutputFormat(schema) },
  });
  if (res.stop_reason === "refusal") {
    throw new Error(`Claude declined this request${res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : "."}`);
  }
  if (res.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off (max_tokens). Try again.");
  if (!res.parsed_output) throw new Error("Claude's answer could not be parsed.");
  return res.parsed_output as z.infer<S>;
}

async function imageBlocks(ids: string[], maxEdge = 1568): Promise<Content[]> {
  const blocks: Content[] = [];
  for (const id of ids) {
    const img = await imageForClaude(id, maxEdge);
    blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.data } });
  }
  return blocks;
}

// ---------- Furniture models ----------

const xyz = z.object({ x: z.number(), y: z.number(), z: z.number() });

const ModelOutput = z.object({
  name: z.string().describe("Short descriptive name, e.g. 'Oak slat-back dining chair'"),
  category: oneOf(ITEM_CATEGORIES),
  assumptions: z.string().describe("What you had to guess (hidden sides, dimensions, materials)"),
  materials: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: oneOf(MATERIAL_KINDS),
      color: z.string().describe("#rrggbb sampled from the photo"),
      roughness: z.number(),
      metalness: z.number(),
      opacity: z.number(),
    }),
  ),
  parts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      shape: oneOf(PART_SHAPES),
      position: xyz,
      size: xyz,
      rotation: xyz,
      cornerRadius: z.number(),
      materialId: z.string(),
    }),
  ),
});

const MODEL_SYSTEM = `You build rough but recognizable 3D models of furniture and decor from photos, for an interior-design planning app. A model is a list of primitive parts that a renderer assembles.

Conventions (follow exactly):
- Units are centimeters. Origin is the center of the piece's footprint on the floor.
- Axes: x = width (left to right as seen from the front), y = up, z = depth. +z is the FRONT of the piece (the side a person faces or sits on).
- Each part has: position = the part's CENTER; size = full extent on each axis before rotation; rotation in degrees (Euler XYZ).
- Shapes: box; roundedBox (cornerRadius in cm, good for cushions and upholstery); cylinder and cone (size.x = diameter, size.y = height, size.z = diameter; cones point up, wide end at the bottom); sphere (size = ellipsoid diameters); torus (size.x = outer diameter, size.y = tube thickness, lies in the XY plane).
- The lowest part should touch y = 0 (legs, plinth or base).
- Materials: kind is one of ${MATERIAL_KINDS.join(", ")}. Sample colors from the photo as #rrggbb. roughness 0-1 (fabric ~0.95, oiled wood ~0.6, lacquer ~0.3, polished metal ~0.25 with metalness ~0.9). opacity 1 except glass (~0.35) or sheer shades.

Modeling guidance:
- Capture the silhouette and proportions first: overall bounding box, seat or top height, leg style and thickness, arm and back shapes. Then add details that make it recognizable (cushion splits, drawer fronts, tufting rows, slats, a lampshade, piping), typically 6-40 parts.
- Use rotation for splayed legs, raked backs and angled arms.
- Never output parts with zero or negative size. Keep every part attached to the piece.
- If the user gave dimensions, the model's bounding box must match them. Otherwise infer realistic dimensions from the object type and visual cues.

Example of the conventions (a simple dining chair template):
EXAMPLE_JSON`;

function exampleJson() {
  const m = buildTemplateModel("chair");
  return JSON.stringify({ category: m.category, materials: m.materials, parts: m.parts.slice(0, 6) });
}

function dimsText(d: Partial<Dimensions>) {
  const parts = [d.w && `width ${d.w} cm`, d.d && `depth ${d.d} cm`, d.h && `height ${d.h} cm`].filter(Boolean);
  return parts.length ? `Known dimensions: ${parts.join(", ")}.` : "No dimensions given; estimate them.";
}

export interface GeneratedModel {
  name: string;
  model: ParametricModel;
  assumptions: string;
}

function finish(out: z.infer<typeof ModelOutput>, known: Partial<Dimensions>): GeneratedModel {
  const category = pick(out.category, ITEM_CATEGORIES, "other");
  let model = normalizeModel({
    category,
    dims: { w: 0, d: 0, h: 0 },
    parts: out.parts.map((p) => ({ ...p, shape: pick(p.shape, PART_SHAPES, "box") })),
    materials: out.materials.map((m) => ({ ...m, kind: pick(m.kind, MATERIAL_KINDS, "plain") })),
    notes: out.assumptions,
  });
  if (model.parts.length === 0) model = buildTemplateModel(category, known);
  if (known.w || known.d || known.h) model = scaleModelTo(model, known);
  return { name: out.name, model, assumptions: out.assumptions };
}

export async function generateModel(item: LibraryItem, variationHint?: string): Promise<GeneratedModel> {
  const images = await imageBlocks(item.photoIds.slice(0, 6));
  const text = [
    item.photoIds.length
      ? `Build a 3D parametric model of the piece shown in ${item.photoIds.length > 1 ? "these photos (all show the same piece)" : "this photo"}.`
      : "Build a 3D parametric model of this piece from the description.",
    item.name && `The user calls it "${item.name}".`,
    item.category !== "other" && `Category: ${item.category}.`,
    dimsText(item.knownDims),
    item.notes && `User notes: ${item.notes}`,
    variationHint !== undefined &&
      `This is a regeneration. Offer a fresh interpretation that differs from the previous one${
        item.model ? ` (previous: ${describeModel(item.model)}, ${item.model.parts.length} parts)` : ""
      }.${variationHint ? ` Guidance: ${variationHint}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
  const out = await structured(ModelOutput, {
    system: MODEL_SYSTEM.replace("EXAMPLE_JSON", exampleJson()),
    content: [...images, { type: "text", text }],
    effort: "high",
  });
  return finish(out, item.knownDims);
}

export async function editModel(item: LibraryItem, instruction: string): Promise<GeneratedModel> {
  if (!item.model) throw new Error("This item has no model to edit yet.");
  const images = await imageBlocks(item.photoIds.slice(0, 2), 1024);
  const text = `Here is the current model of "${item.name}" as JSON:
${JSON.stringify({ category: item.model.category, materials: item.model.materials, parts: item.model.parts })}

Apply this change requested by the user: "${instruction}"

Return the complete updated model. Keep part and material ids unchanged for parts you don't modify. Change only what the request implies, keeping overall dimensions unless the request is about size.${
    images.length ? " The original photo is attached for reference." : ""
  }`;
  const out = await structured(ModelOutput, {
    system: MODEL_SYSTEM.replace("EXAMPLE_JSON", exampleJson()),
    content: [...images, { type: "text", text }],
    effort: "high",
  });
  // Size-related instructions may legitimately change dims; otherwise hold the user's known dims
  const sizeChange = /\b(size|wider|narrower|taller|shorter|longer|deeper|bigger|smaller|width|height|depth|cm|inch|feet|ft|scale)\b/i.test(
    instruction,
  );
  return finish(out, sizeChange ? {} : item.knownDims);
}

// ---------- Room layouts from a plan or photo ----------

const LayoutOutput = z.object({
  imageKind: oneOf(["floor-plan", "sketch", "room-photo", "other"]),
  coordinateSpace: oneOf(["image-pixels", "centimeters"], "image-pixels for plans/sketches traced in image coordinates; centimeters for room photos"),
  cmPerPixel: z.number().describe("Scale estimate when coordinateSpace is image-pixels; 1 otherwise"),
  scaleReasoning: z.string(),
  ceilingHeight: z.number().describe("cm"),
  elements: z.array(
    z.object({
      type: oneOf(LINE_TYPES),
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
      label: z.string(),
      swing: oneOf(["left", "right", "none"]),
    }),
  ),
  zones: z.array(z.object({ label: z.string(), points: z.array(z.object({ x: z.number(), y: z.number() })) })),
  notes: z.string().describe("Anything the user should double-check"),
});
export type LayoutDraft = Omit<z.infer<typeof LayoutOutput>, "elements" | "coordinateSpace"> & {
  coordinateSpace: "image-pixels" | "centimeters";
  elements: (Omit<z.infer<typeof LayoutOutput>["elements"][number], "type" | "swing"> & {
    type: (typeof LINE_TYPES)[number];
    swing: "left" | "right" | "none";
  })[];
  imageWidth: number;
  imageHeight: number;
};

const LAYOUT_SYSTEM = `You convert floor plans, hand sketches and room photos into an editable 2D layout for an interior-design app. The user will correct your draft, so prefer clean, plausible geometry over guesses.

Element types:
- wall-exterior, wall-interior: wall centerlines. Make connected walls share exact endpoint coordinates so corners close.
- door, window, opening (open passage/archway): segments lying ON a wall, spanning the opening's width. For doors set swing to left or right (hinge side as seen from the room interior), else "none".
- cabinet, counter, fireplace, radiator, column: fixed fixtures, drawn along their back edge (the edge against the wall).
- dimension: only if the drawing shows a labeled measurement; put the measured length, in cm, in label (e.g. "350").
Zones: labeled areas such as "Living", "Kitchen", "Reading nook", as polygons.

Coordinates:
- For floor plans and sketches, use image pixel coordinates (origin top-left, y down) so your lines overlay the image, and estimate cmPerPixel from labeled dimensions, door widths (~80-90 cm) or typical furniture sizes. Explain in scaleReasoning.
- For a photo taken inside a room, infer an approximate rectangular (or L-shaped) plan in centimeters with origin at the top-left corner of the plan, and set cmPerPixel to 1.
- Keep walls axis-aligned when the drawing is clearly orthogonal.`;

export async function layoutFromImage(imageId: string, hint: string): Promise<LayoutDraft> {
  const img = await imageForClaude(imageId);
  const out = await structured(LayoutOutput, {
    system: LAYOUT_SYSTEM,
    content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.data } },
      {
        type: "text",
        text: `The image is ${img.width}×${img.height} pixels. Trace its room layout.${hint ? `\nUser notes: ${hint}` : ""}`,
      },
    ],
    effort: "high",
  });
  return {
    ...out,
    coordinateSpace: out.coordinateSpace === "centimeters" ? "centimeters" : "image-pixels",
    elements: out.elements
      .filter((e) => (LINE_TYPES as readonly string[]).includes(e.type))
      .map((e) => ({ ...e, type: e.type as LineType, swing: pick(e.swing, ["left", "right", "none"] as const, "none") })),
    imageWidth: img.width,
    imageHeight: img.height,
  };
}

// ---------- Style summaries ----------

const SummaryOutput = z.object({
  styleName: z.string().describe("Established style name, e.g. 'Japandi', 'Mid-century modern', or a blend"),
  oneLiner: z.string(),
  description: z.string().describe("2-4 sentences on what defines the look in these images"),
  palette: z.array(z.object({ hex: z.string(), name: z.string() })),
  materials: z.array(z.string()),
  keywords: z.array(z.string()),
  essentials: z.array(
    z.object({
      name: z.string().describe("A specific piece, e.g. 'Low platform bed in light oak'"),
      category: oneOf(ITEM_CATEGORIES),
      why: z.string(),
      priority: oneOf(["must", "nice"]),
    }),
  ),
  layoutPrinciples: z.array(z.string()),
  avoid: z.array(z.string()),
});

export async function summarizeCollection(name: string, pins: Pin[]): Promise<Omit<StyleSummary, "pinIds" | "createdAt">> {
  const withImages = pins.filter((p) => p.imageId).slice(0, 24);
  if (withImages.length === 0) throw new Error("This collection has no images to summarize.");
  const content: Content[] = [];
  withImages.forEach((p, i) => {
    content.push({ type: "text", text: `Image ${i + 1}${p.title ? `: ${p.title}` : ""}` });
  });
  const blocks = await imageBlocks(
    withImages.map((p) => p.imageId!),
    1024,
  );
  const interleaved: Content[] = [];
  withImages.forEach((_, i) => interleaved.push(content[i], blocks[i]));
  interleaved.push({
    type: "text",
    text: `These ${withImages.length} images are an inspiration collection the user named "${name}". Identify the shared aesthetic style, then list the pieces needed to recreate this look in a room: 6-12 essentials across categories (furniture, lighting, textiles, decor, plants), each specific in form, material and color. Ground every claim in what is visible across the images, and say so if the images mix styles.`,
  });
  const out = await structured(SummaryOutput, {
    system:
      "You are an interior designer who reads inspiration boards precisely. Be concrete about forms, materials, colors and proportions; avoid generic filler.",
    content: interleaved,
    effort: "medium",
  });
  return {
    ...out,
    essentials: out.essentials.map((e) => ({
      ...e,
      category: pick(e.category, ITEM_CATEGORIES, "decor"),
      priority: pick(e.priority, ["must", "nice"] as const, "nice"),
    })),
  };
}

// ---------- Matching library items to a style ----------

const MatchOutput = z.object({
  matches: z.array(
    z.object({
      itemId: z.string(),
      score: z.number().describe("0-100 fit with the style"),
      reason: z.string(),
      fillsEssential: z.string().describe("Name of the essential this item covers, or empty string"),
    }),
  ),
  missingEssentials: z.array(z.object({ name: z.string(), category: z.string(), suggestion: z.string() })),
});

export async function matchItems(summary: StyleSummary, items: LibraryItem[], request: string) {
  const catalog = items.map((it) => ({
    itemId: it.id,
    name: it.name,
    category: it.category,
    model: describeModel(it.model),
    notes: it.notes,
    tags: it.tags,
  }));
  const thumbs: Content[] = [];
  for (const it of items.slice(0, 40)) {
    if (!it.photoIds[0]) continue;
    thumbs.push({ type: "text", text: `Photo of itemId ${it.id} (${it.name}):` });
    thumbs.push(...(await imageBlocks([it.photoIds[0]], 512)));
  }
  const out = await structured(MatchOutput, {
    system:
      "You match a user's furniture library against a target interior style. Rate honestly: include only items that would plausibly work (score >= 40), and explain each in one sentence. Use only itemIds from the catalog.",
    content: [
      ...thumbs,
      {
        type: "text",
        text: `Target style: ${JSON.stringify({
          styleName: summary.styleName,
          description: summary.description,
          palette: summary.palette,
          materials: summary.materials,
          essentials: summary.essentials,
          avoid: summary.avoid,
        })}

Library catalog: ${JSON.stringify(catalog)}

${request ? `User request: "${request}"\n\n` : ""}Rank the library items that fit this style, best first, noting which essential each one fills. Then list essentials no library item covers, with a short shopping suggestion for each.`,
      },
    ],
    effort: "medium",
  });
  const valid = new Set(items.map((i) => i.id));
  return {
    matches: out.matches
      .filter((m) => valid.has(m.itemId))
      .map((m) => ({ ...m, score: Math.round(Math.max(0, Math.min(100, m.score))), fillsEssential: m.fillsEssential || null }))
      .sort((a, b) => b.score - a.score),
    missingEssentials: out.missingEssentials,
  };
}

/** Turns SDK errors into messages a person can act on. */
export function explainClaudeError(err: unknown): { status: number; message: string } {
  if (err instanceof ClaudeUnavailableError) return { status: 412, message: err.message };
  if (err instanceof Anthropic.AuthenticationError) return { status: 401, message: "The Anthropic API key was rejected." };
  if (err instanceof Anthropic.RateLimitError) return { status: 429, message: "Claude is rate limited right now. Try again shortly." };
  if (err instanceof Anthropic.BadRequestError) return { status: 400, message: `Claude rejected the request: ${err.message}` };
  if (err instanceof Anthropic.APIConnectionError) return { status: 502, message: "Could not reach the Claude API." };
  if (err instanceof Anthropic.APIError) return { status: 502, message: `Claude API error: ${err.message}` };
  return { status: 500, message: err instanceof Error ? err.message : String(err) };
}
