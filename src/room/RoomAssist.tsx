import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ArrangeProposal, Collection, FitVerdict, LibraryItem, RoomState, RoomStyle } from "../../shared/types.ts";
import { api } from "../lib/api.ts";
import { toastError, useApp } from "../lib/store.ts";
import { Icon, Spinner, categoryLabel } from "../components/ui.tsx";

const EXAMPLES = ["Move the sofa under the window", "Lay out the pieces in the tray", "Make a conversation area around the rug", "Open up the path to the door"];

/** Text box that asks Claude to rearrange the room. */
export function ArrangeBox({
  roomId,
  state,
  flush,
  onProposal,
}: {
  roomId: string;
  state: RoomState;
  flush: () => Promise<unknown>;
  onProposal: (p: ArrangeProposal) => void;
}) {
  const hasKey = useApp((s) => s.settings?.hasAnthropicKey);
  const [text, setText] = useState("");
  const [useTray, setUseTray] = useState(true);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await flush(); // Claude reads the saved room, so save the latest moves first
      const p = await api.arrange(roomId, text, useTray);
      onProposal(p);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <h3 style={{ margin: 0 }}>Ask Claude to arrange</h3>
      <textarea
        className="textarea"
        style={{ minHeight: 60 }}
        placeholder="e.g. move the sofa under the window and face it toward the fireplace"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && run()}
      />
      <div className="row wrap" style={{ gap: 4 }}>
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip" style={{ border: 0, cursor: "pointer" }} onClick={() => setText(ex)}>
            {ex}
          </button>
        ))}
      </div>
      <div className="row">
        {state.staging.length > 0 && (
          <label className="small row" style={{ gap: 4 }}>
            <input type="checkbox" checked={useTray} onChange={(e) => setUseTray(e.target.checked)} /> Can place tray pieces ({state.staging.length})
          </label>
        )}
        <div className="spacer" />
        <button className="btn sm primary" disabled={busy || !text.trim() || !hasKey} onClick={run} title={hasKey ? "" : "Needs an Anthropic API key"}>
          {busy ? <Spinner /> : <Icon name="sparkle" size={14} />} {busy ? "Thinking…" : "Propose"}
        </button>
      </div>
      {busy && <div className="muted small">Working out the geometry; this can take a minute.</div>}
    </div>
  );
}

/** Review panel for a proposal shown as translucent drafts in the scene. */
export function ProposalReview({
  proposal,
  items,
  overlapping,
  onApply,
  onDiscard,
}: {
  proposal: ArrangeProposal;
  items: Map<string, LibraryItem>;
  overlapping: number;
  onApply: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="stack">
      <div className="row">
        <Icon name="sparkle" />
        <h3 style={{ margin: 0 }}>Claude's proposal</h3>
      </div>
      <p style={{ margin: 0 }}>{proposal.summary}</p>
      {proposal.moves.length === 0 ? (
        <div className="note-box">No pieces needed to move.</div>
      ) : (
        <div>
          <div className="label" style={{ marginBottom: 4 }}>
            Shown as translucent drafts
          </div>
          {proposal.moves.map((m, i) => (
            <div key={i} className="essential">
              <span className={`chip ${m.placementId ? "" : "accent"}`} style={{ alignSelf: "flex-start" }}>
                {m.placementId ? "Move" : "Place"}
              </span>
              <div>
                <strong>{items.get(m.itemId)?.name ?? "Piece"}</strong>
                <div className="muted small">{m.reason}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {overlapping > 0 && <div className="error-box">{overlapping} proposed piece{overlapping > 1 ? "s overlap" : " overlaps"} something; you can adjust after applying.</div>}
      {proposal.notes && <div className="note-box">{proposal.notes}</div>}
      <div className="row">
        <button className="btn ghost" onClick={onDiscard}>
          Discard
        </button>
        <div className="spacer" />
        <button className="btn primary" disabled={proposal.moves.length === 0} onClick={onApply}>
          <Icon name="check" size={14} /> Apply
        </button>
      </div>
      <div className="muted small">Applying is undoable with Ctrl+Z.</div>
    </div>
  );
}

export const VERDICT_LABEL: Record<FitVerdict["verdict"], string> = { fits: "fits", borderline: "borderline", off: "off-style" };
export const verdictClass = (v: FitVerdict["verdict"]) => (v === "fits" ? "ok" : v === "off" ? "danger" : "");

/** The board a room follows: palette, essentials it has or lacks, and Claude's fit check. */
export function StylePanel({
  roomId,
  style,
  state,
  items,
  onStyleChange,
  flush,
}: {
  roomId: string;
  style: RoomStyle;
  state: RoomState;
  items: Map<string, LibraryItem>;
  onStyleChange: (s: RoomStyle) => void;
  flush: () => Promise<unknown>;
}) {
  const hasKey = useApp((s) => s.settings?.hasAnthropicKey);
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    api.collections().then(setCollections).catch(() => setCollections([]));
  }, []);

  const board = collections?.find((c) => c.id === style.collectionId) ?? null;
  const summary = board?.summary ?? null;
  const roomItemIds = [...new Set([...state.placements.map((p) => p.itemId), ...state.staging])];
  const placedItems = [...new Set(state.placements.map((p) => p.itemId))].map((id) => items.get(id)).filter((i): i is LibraryItem => !!i);
  const fit = style.fit;
  const stale = fit && (fit.itemIds.length !== roomItemIds.length || roomItemIds.some((id) => !fit.itemIds.includes(id)));

  // An essential is covered when the fit check says a placed piece fills it, or failing that,
  // when a placed piece shares its category
  const coverage = (summary?.essentials ?? []).map((e) => {
    const byFit = fit?.verdicts.find((v) => v.fillsEssential === e.name && placedItems.some((i) => i.id === v.itemId));
    const piece = byFit ? items.get(byFit.itemId) : placedItems.find((i) => i.category === e.category);
    return { e, piece };
  });

  const check = async () => {
    setChecking(true);
    try {
      await flush();
      onStyleChange((await api.styleCheck(roomId)).style);
    } catch (err) {
      toastError(err);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <h3 style={{ margin: 0 }}>Style</h3>
      <select
        className="select"
        value={style.collectionId ?? ""}
        onChange={(e) => onStyleChange({ collectionId: e.target.value || null, fit: null })}
      >
        <option value="">No board linked</option>
        {(collections ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.summary ? ` · ${c.summary.styleName}` : " (not summarized)"}
          </option>
        ))}
      </select>
      {!style.collectionId && <div className="muted small">Link a board to see its palette, which essentials this room still lacks, and which pieces don't fit.</div>}
      {board && !summary && (
        <div className="note-box small">
          This board has no style summary yet. <Link to={`/boards/${board.id}`}>Summarize it</Link> first.
        </div>
      )}
      {summary && (
        <>
          <div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: 18 }}>{summary.styleName}</div>
            <div className="muted small">{summary.oneLiner}</div>
          </div>
          <div className="row" style={{ gap: 4 }}>
            {summary.palette.map((p) => (
              <span key={p.hex + p.name} title={p.name} style={{ width: 22, height: 22, borderRadius: 6, background: p.hex, border: "1px solid var(--line)" }} />
            ))}
          </div>
          <div>
            <div className="label" style={{ marginBottom: 2 }}>
              Essentials ({coverage.filter((c) => c.piece).length}/{coverage.length} in the room)
            </div>
            {coverage.map(({ e, piece }) => (
              <div key={e.name} className="row small" style={{ padding: "3px 0", alignItems: "flex-start" }}>
                <span style={{ color: piece ? "var(--ok)" : "var(--muted)", width: 14, flexShrink: 0 }}>{piece ? "✓" : "○"}</span>
                <span style={{ flex: 1 }}>
                  <span style={{ color: piece ? undefined : "var(--ink)" , fontWeight: piece ? 400 : 600 }}>{e.name}</span>
                  {piece ? <span className="muted"> · {piece.name}</span> : <span className="muted"> · missing ({categoryLabel(e.category)}{e.priority === "must" ? ", must-have" : ""})</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="row">
            <span className="muted small">
              {fit ? `Checked ${new Date(fit.checkedAt).toLocaleString()}${stale ? " · pieces changed since" : ""}` : "Not checked yet"}
            </span>
            <div className="spacer" />
            <button className="btn sm accent" disabled={checking || !hasKey || roomItemIds.length === 0} onClick={check} title={hasKey ? "" : "Needs an Anthropic API key"}>
              {checking ? <Spinner /> : <Icon name="sparkle" size={14} />} {fit ? "Recheck fit" : "Check fit"}
            </button>
          </div>
          {fit && fit.verdicts.some((v) => v.verdict !== "fits") && (
            <div>
              <div className="label" style={{ marginBottom: 2 }}>
                Flagged pieces
              </div>
              {fit.verdicts
                .filter((v) => v.verdict !== "fits" && items.get(v.itemId))
                .sort((a, b) => a.score - b.score)
                .map((v) => (
                  <div key={v.itemId} className="small" style={{ padding: "4px 0" }}>
                    <span className={`chip ${verdictClass(v.verdict)}`}>{VERDICT_LABEL[v.verdict]}</span> <strong>{items.get(v.itemId)!.name}</strong>
                    <div className="muted">{v.reason}</div>
                  </div>
                ))}
            </div>
          )}
          {fit && fit.suggestions.length > 0 && (
            <div>
              <div className="label">Suggestions</div>
              <ul className="clean small">
                {fit.suggestions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
