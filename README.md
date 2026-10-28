# Interior Studio

A local, single-user web app for planning interiors in 3D:

- **Library**: upload photos of a piece (plus dimensions and notes, if you have them). Claude builds an editable parametric 3D model from them. You can then refine it with scale dials, material and part editors, plain-text change requests ("make the legs thinner"), regeneration with guidance, and version history.
- **Projects and rooms**: start a room from dimensions, draw it from scratch, or let Claude draft the layout from a floor plan, sketch or room photo for you to correct. The drawing tool has typed wall lengths, snapping, doors, windows, openings, fixtures, outlets, zones and dimension-line calibration. The room is generated in 3D, and you arrange library pieces in it. Pieces snap to walls, overlaps are flagged and clearances are shown. A fold-out staging tray holds pieces waiting to be placed, draft placements appear translucent, and you can save and load named arrangements.
  - **Arrange with Claude**: ask for things like "move the sofa under the window" or "lay out the pieces in the tray". Claude proposes new positions, shown as translucent drafts with a reason for each move. You apply (undoable) or discard.
  - **Room style**: link a room to a summarized board. The room shows the board's palette and which essentials it has or is missing, and a fit check has Claude flag pieces that are off-style, with suggestions.
- **Boards**: import Pinterest boards (official API) or build collections from images and pin links. One image can belong to any number of collections: add images from other collections, or "also add" a selection elsewhere, without duplicating them. Claude summarizes a collection's style (name, palette, materials, essential pieces, layout principles), then suggests matching library pieces, which you confirm before they're linked. Linked pieces can be sent to any room's staging tray.

## Running it

Requires Node 22+.

```bash
npm install
cp .env.example .env      # optional: add ANTHROPIC_API_KEY and Pinterest app credentials
npm run dev               # API on :3001, web app on http://localhost:5173
```

You can also paste the Anthropic API key on the **Settings** page; it's stored in the local database. Without a key, everything except the Claude features works: pieces start from parametric category templates, and floor plans open as tracing backgrounds.

Production: `npm run build && npm start` serves the built app and API together on port 3001.

Data lives in `./data` (SQLite database plus uploaded images). Set `DATA_DIR` to move it.

### Pinterest

Board import uses Pinterest API v5 with your own developer app:

1. Create an app at https://developers.pinterest.com/apps/ (Pinterest reviews new apps, which can take a few days).
2. Register the redirect URI shown on the Settings page (default `http://localhost:3001/api/pinterest/callback`).
3. Paste the app ID and secret on Settings, then **Connect Pinterest**.

Importing a board again pulls only pins added since the last import. Without an app, paste pin links (their public preview image is used) or drop images into a collection.

## How it works

| Area | Where |
| --- | --- |
| Domain types (all lengths in cm) | `shared/types.ts` |
| Parametric model math: bounds, normalization, scaling | `shared/modelOps.ts` |
| Category templates (offline models, and the reference example given to Claude) | `shared/templates.ts` |
| Layout geometry: wall openings, floor outline, collisions, clearances, wall snapping | `shared/geometry.ts` |
| Claude calls (structured outputs, server-side refusal fallback) | `server/claude.ts` |
| Room description Claude reads when arranging | `server/roomBrief.ts` |
| Style panel and arrangement proposals | `src/room/RoomAssist.tsx` |
| API routes | `server/routes/*` |
| 3D model builder and procedural textures | `src/three/buildModel.ts` |
| 2D layout drawing tool | `src/layout/LayoutEditor.tsx` |
| 3D room, dragging, dollhouse walls | `src/room/RoomScene.tsx`, `src/pages/RoomPage.tsx` |

Models are parametric: lists of primitives (boxes, rounded boxes, cylinders, cones, spheres, tori) with materials. That keeps generation fast and cheap, and makes every model editable by dial, by hand or by text. Claude is `claude-opus-5-5`, with structured outputs validated by Zod; enum-like values are sanitized server-side so an unexpected value never discards a generation.

## Tests

```bash
npm test          # geometry, units and model math
npm run typecheck
```
