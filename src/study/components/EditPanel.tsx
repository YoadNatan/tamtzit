import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { tidy } from "../../../shared/study/blocks";
import { blockSources, checkEdit, citedSlides, compose, editableParts, tableCells, tableText, wordDiff, type Block } from "../../../shared/study/edits";
import type { Section } from "../lib/api";
import {
  approveEdit,
  clock,
  fixCheck,
  openDispute,
  parseMinute,
  proposeEdit,
  quoteLines,
  slideSpec,
  sourceLine,
  undoable,
  undoEdit,
  withdrawEdit,
  type Edit,
  type Proposal,
  type ProposalInput,
  type SourceKind,
} from "../lib/collab";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { useCorrections } from "../lib/correctionsStore";
import type { LectureCtx, Spot } from "../features/types";
import { Icon } from "./Icon";
import { Avatar } from "./Shell";
import SummaryView, { isolateLatin } from "./SummaryView";
import { timeAgo } from "./Together";

/* ── The "תיקון" tab (§12.3.K, decision 5; corrections.html s1) ──
 *
 * A correction is a proposal with a source: "הצעת תיקון" (the editor, with a
 * live preview and the warning when a slide tag is deleted), "מקור (חובה)"
 * (a slide of the lecture, a minute of the recording, or an outside source
 * with a note), "להציע לקבוצה". It waits, "ממתין לאישור", until another
 * member taps "לאשר" (never one's own) or the reader of the day's live
 * reading approves it aloud (section M; on the reader's bar, AloudCard
 * below). Applied, it shows in the paragraph's history with its author,
 * approver and source; "ביטול" is offered on the paragraph's latest
 * correction only and puts its text back at once (review SEC-1); older
 * versions come back as a new proposal ("החזרה לנוסח הזה", the old source
 * filled in). The editor opens at once, focused, on a paragraph with no
 * corrections and no proposal: two taps from the page (review UX-7). */

const NETWORK = "לא נשמר. כדאי לבדוק את החיבור ולנסות שוב.";
const CHANGED = "הפסקה השתנתה מאז ההצעה, ולכן התיקון לא נשמר. אפשר להציע אותו שוב על הנוסח החדש.";
const TAG = /\[ש['׳]\s?[\d\s,–-]+\]/g;
const KIND_LABEL: Record<string, string> = { heading: "תיקון הכותרת", table: "תיקון הטבלה", figure: "תיקון הכיתוב" };
const SOURCES: Array<{ kind: SourceKind; label: string }> = [
  { kind: "slide", label: "שקף" },
  { kind: "recording", label: "מההקלטה" },
  { kind: "external", label: "חיצוני" },
];

const codeOf = (e: unknown) => (e instanceof Error ? e.message : "");
/** A failure's words in the corrections' area (a dropped connection: "לא נשמר…"). */
function failWords(e: unknown): string {
  const code = codeOf(e);
  if (!code || code === "Failed to fetch" || code === "network" || code === "TypeError") return NETWORK;
  return failText(code, "corrections");
}

/** "חסר עוד אישור אחד מהקבוצה" (with the meeting, "או אישור בקול בפגישה"). */
const WAITING = flags.meeting ? "חסר עוד אישור אחד מהקבוצה, או אישור בקול בפגישה." : "חסר עוד אישור אחד מהקבוצה.";

/** A word diff: what went struck and muted, what came bold in the ok colour (corrections.html). */
function Diff({ before, after, kind }: { before: string; after: string; kind: string }) {
  if (kind === "table") return <TableDiff before={before} after={after} />;
  const parts = wordDiff(before, after);
  if (!parts)
    return (
      <div className="a-stack k-diff whole">
        <p className="a-small a-muted">לפני:</p>
        <s className="a-muted">
          <SummaryView markdown={before} compact />
        </s>
        <p className="a-small a-muted">אחרי:</p>
        <SummaryView markdown={after} compact />
      </div>
    );
  return (
    <p className="a-para k-diff" dir="rtl">
      {parts.map((p, i) =>
        p.op === "del" ? (
          <s key={i} className="a-muted">
            {isolateLatin(p.text, `d${i}`)}
          </s>
        ) : p.op === "ins" ? (
          <b key={i} className="k-ins">
            {isolateLatin(p.text, `i${i}`)}
          </b>
        ) : (
          <span key={i}>{isolateLatin(p.text, `s${i}`)}</span>
        ),
      )}
    </p>
  );
}

/** A table's correction, cell by cell: the old cell struck, the new one bold (corrections.html s1). */
function TableDiff({ before, after }: { before: string; after: string }) {
  const a = tableCells(before);
  const b = tableCells(after);
  if (!a || !b) return <SummaryView markdown={after} compact />;
  const strip = (t: string) => t.replace(/\*\*/g, "").trim();
  // Each cell in its own direction (an English cell reads left to right, as the summary's tables do).
  const cell = (r: number, k: number): ReactNode => {
    const was = strip(a.cells[r]?.[k] ?? "");
    const now = strip(b.cells[r]?.[k] ?? "");
    if (was === now) return <bdi>{now}</bdi>;
    return (
      <>
        {was ? (
          <>
            <s className="a-muted">
              <bdi>{was}</bdi>
            </s>{" "}
          </>
        ) : null}
        <b className="k-ins">
          <bdi>{now}</bdi>
        </b>
      </>
    );
  };
  const [head, ...rows] = b.cells;
  return (
    <div className="table-wrap">
      <table className="a-table">
        <thead>
          <tr>
            {head.map((_, k) => (
              <th key={k}>{cell(0, k)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((_, k) => (
                <td key={k}>{cell(r + 1, k)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The cited slide's text, quoted under the source ("ש׳ 33: …"). Each line
 *  in its own direction (<bdi> is dir=auto): an English line left to right,
 *  as corrections.html s1 draws it, and a Hebrew line of the slide right to
 *  left, never forced into the other's order. */
function SlideQuote({ lc, n }: { lc: LectureCtx; n: number }) {
  const s = lc.lecture.slides.find((x) => x.n === n);
  if (!s) return null;
  return (
    <div className="a-callout k-quote">
      <span className="a-small">
        <b>ש׳ {n}:</b>{" "}
        {quoteLines(s).map((l, i) => (
          <Fragment key={i}>
            {i ? " · " : ""}
            <bdi>{l}</bdi>
          </Fragment>
        ))}
      </span>
    </div>
  );
}

/** The source a correction or a proposal cites: the three chips, the chosen one marked, and its quote. */
function SourceView({ lc, x }: { lc: LectureCtx; x: Pick<Proposal, "source_kind" | "source_slides" | "source_at" | "source_note"> }) {
  return (
    <>
      <div className="a-row k-source">
        <b className="a-small">מקור</b>
        {SOURCES.map((s) => (
          <span key={s.kind} className={`a-chip${x.source_kind === s.kind ? " busy" : ""}`}>
            {x.source_kind === s.kind ? `${s.label} ✓` : s.label}
          </span>
        ))}
      </div>
      {x.source_kind === "slide" ? (
        x.source_slides.slice(0, 2).map((n) => <SlideQuote key={n} lc={lc} n={n} />)
      ) : x.source_kind === "recording" ? (
        <div className="a-callout rec">
          <span className="a-small">
            <b>מההקלטה,</b> <bdi dir="ltr">{clock(x.source_at ?? 0)}</bdi>
          </span>
        </div>
      ) : (
        <div className="a-callout quiet">
          <span className="a-small">{isolateLatin(x.source_note, "src")}</span>
        </div>
      )}
    </>
  );
}

/** The paragraph as the proposal leaves it: the part's title, its tags, the change marked. */
function ParagraphCard({ section, block, before, after, kind }: { section: Section; block: Block; before: string; after: string; kind: string }) {
  const slides = citedSlides(block.text);
  return (
    <div className="a-card flat k-para">
      <div className="a-row between">
        <span className="a-small a-muted">{isolateLatin(section.title, "pt")}</span>
        {slides.length ? <span className="a-tag src-tag">ש׳ {slideSpec(slides)}</span> : null}
      </div>
      <Diff before={before} after={after} kind={kind} />
    </div>
  );
}

export default function EditPanel({ lc, spot }: { lc: LectureCtx; spot: Spot }) {
  const c = useCorrections(lc.lecture.id);
  const section = lc.sections.find((s) => s.idx === spot.part);
  const md = useMemo(() => tidy(section?.markdown ?? ""), [section?.markdown]);
  const blocks = useMemo(() => (md ? blockSources(md) : []), [md]);
  const block = blocks[spot.anchor];
  const gen = section?.gen ?? 0;
  const history = c.edits.filter((e) => e.part_idx === spot.part && e.anchor === spot.anchor && e.gen === gen).sort((a, b) => b.rev - a.rev);
  const proposal = c.proposals.find((p) => p.part_idx === spot.part && p.anchor === spot.anchor && p.gen === gen);
  const latestIds = useMemo(() => undoable(c.edits, (part) => lc.sections.find((s) => s.idx === part)?.gen ?? 0), [c.edits, lc.sections]);
  const [editing, setEditing] = useState<null | { text?: string; source?: ProposalInput["source"]; note?: string }>(null);
  const [disputing, setDisputing] = useState(false);
  const opened = useRef(false);
  // Two taps (review UX-7): with nothing to show first, the editor opens at once.
  useEffect(() => {
    if (opened.current || !c.loaded || !block) return;
    opened.current = true;
    if (!history.length && !proposal && block.kind) setEditing({});
  }, [c.loaded, block, history.length, proposal]);

  if (!section || section.status !== "ready" || !block) return <p className="a-small a-muted">הפסקה הזו לא נמצאה. כדאי לרענן.</p>;
  if (!c.loaded) return <p className="a-small a-muted loading">טוען…</p>;
  if (!block.kind) return <p className="a-small a-muted">אי אפשר לתקן את הקטע הזה כאן.</p>;

  if (editing)
    return (
      <Editor
        lc={lc}
        section={section}
        spot={spot}
        block={block}
        md={md}
        initial={editing}
        latest={history[0]}
        onDone={() => {
          setEditing(null);
          void c.reload();
        }}
      />
    );

  const original = history.length ? history[history.length - 1].before_text : block.text;
  const open = proposal && (proposal.state === "pending" || proposal.state === "disputed");
  return (
    <div className="a-stack k-edit">
      {proposal ? (
        <ProposalView lc={lc} spot={spot} section={section} block={block} proposal={proposal} onEdit={(e) => setEditing(e)} onChanged={() => void c.reload()} />
      ) : null}
      {history.length ? (
        <>
          <div className="a-sec k-history-head">
            <h3>היסטוריית התיקונים</h3>
            <span className="a-small a-muted">ביטול רק לתיקון האחרון</span>
          </div>
          <ol className="a-stack k-history" aria-label="היסטוריית התיקונים">
            {history.map((e, i) => (
              <HistoryRow
                key={e.id}
                lc={lc}
                edit={e}
                edits={c.edits}
                latest={latestIds.has(e.id)}
                canRestore={!open && i > 0 && e.after_text !== block.text}
                onRestore={() => setEditing({ text: e.after_text, source: sourceOf(e), note: "" })}
                onUndone={() => void c.reload()}
              />
            ))}
            <li className="a-card flat dashed k-row original">
              <b className="a-small">
                הנוסח המקורי (<bdi dir="ltr">Claude</bdi>)
              </b>
              <SummaryView markdown={original} compact />
              {!open && original !== block.text ? (
                <button className="a-link" onClick={() => setEditing({ text: original, note: "" })}>
                  החזרה לנוסח הזה
                </button>
              ) : null}
            </li>
          </ol>
        </>
      ) : !proposal ? (
        <p className="a-small a-muted">אין עדיין תיקונים. אם משהו כאן לא תואם את ההרצאה, אפשר להציע תיקון לכל הקבוצה, עם מקור.</p>
      ) : null}
      {!open ? (
        <div className="a-row sheet-actions">
          {flags.var && !disputing ? (
            <button className="a-btn" onClick={() => setDisputing(true)}>
              לא מסכימים
            </button>
          ) : null}
          <button className="a-btn primary wide" onClick={() => setEditing({})}>
            <Icon name="pen" size={14} />
            {KIND_LABEL[block.kind] ?? "הצעת תיקון"}
          </button>
        </div>
      ) : null}
      {!open && disputing ? <DisputeForm lc={lc} spot={spot} text={block.text} onClose={() => setDisputing(false)} /> : null}
    </div>
  );
}

/** A history entry's (or a proposal's) source, for a new proposal back to its text. */
function sourceOf(e: { source_kind: string | null; source_slides: number[] | null; source_at: number | null; source_note: string }): ProposalInput["source"] | undefined {
  const slides = e.source_slides ?? [];
  if (e.source_kind === "slide" && slides.length) return { kind: "slide", slides };
  if (e.source_kind === "recording" && e.source_at != null) return { kind: "recording", at: e.source_at };
  if (e.source_kind === "external" && e.source_note) return { kind: "external", note: e.source_note };
  return undefined;
}

function HistoryRow({
  lc,
  edit: e,
  edits,
  latest,
  canRestore,
  onRestore,
  onUndone,
}: {
  lc: LectureCtx;
  edit: Edit;
  edits: Edit[];
  latest: boolean;
  canRestore: boolean;
  onRestore: () => void;
  onUndone: () => void;
}) {
  const name = (id: string | null) => (id ? lc.ctx.nameOf(id) : "") || "ללא שם";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isUndo = e.source_kind === "undo" || Boolean(e.undo_of);
  const undone = isUndo ? edits.find((x) => x.id === e.undo_of) : undefined;
  const source = isUndo ? "" : sourceLine(e);
  const undo = async () => {
    setBusy(true);
    setError("");
    try {
      await undoEdit(e.id);
      onUndone();
      await lc.refresh();
      lc.ctx.say("התיקון בוטל.");
    } catch (err) {
      setError(failWords(err));
    } finally {
      setBusy(false);
    }
  };
  const line = isUndo
    ? `ביטול: ${name(e.author_id)} · של התיקון של ${name(undone?.author_id ?? null)}`
    : [`תיקון: ${name(e.author_id)}`, e.aloud ? "אישור: בקול בפגישה" : `אישור: ${name(e.approved_by)}`, source].filter(Boolean).join(" · ");
  return (
    <li className={`a-card flat k-row${isUndo ? " undo" : ""}`}>
      <div className="a-row between">
        <span className="a-row">
          {e.author_id ? <Avatar id={e.author_id} name={name(e.author_id)} /> : null}
          <span className="a-small a-muted">{line}</span>
        </span>
        <span className="a-small a-muted">{timeAgo(e.created_at)}</span>
      </div>
      {e.note ? <p className="a-small">{isolateLatin(e.note, "note")}</p> : null}
      <Diff before={e.before_text} after={e.after_text} kind={e.kind} />
      {latest || canRestore ? (
        <div className="a-row">
          {latest ? (
            <button className="a-btn small" disabled={busy} onClick={() => void undo()}>
              {busy ? "מבטלים…" : "ביטול"}
            </button>
          ) : null}
          {canRestore ? (
            <button className="a-link" onClick={onRestore}>
              החזרה לנוסח הזה
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="a-error a-small" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** "הצעת תיקון · מאיה": waiting for a second member (or the reader, aloud). corrections.html s1. */
function ProposalView({
  lc,
  spot,
  section,
  block,
  proposal: p,
  onEdit,
  onChanged,
}: {
  lc: LectureCtx;
  spot: Spot;
  section: Section;
  block: Block;
  proposal: Proposal;
  onEdit: (e: { text: string; source?: ProposalInput["source"]; note: string }) => void;
  onChanged: () => void;
}) {
  const mine = p.proposed_by === lc.ctx.userId;
  const who = (p.proposed_by ? lc.ctx.nameOf(p.proposed_by) : "") || "ללא שם";
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [check, setCheck] = useState<{ ok: boolean; note: string } | null>(p.check_ok === null ? null : { ok: p.check_ok, note: p.check_note ?? "" });
  const [disputing, setDisputing] = useState(false);
  useEffect(() => setCheck(p.check_ok === null ? null : { ok: p.check_ok, note: p.check_note ?? "" }), [p.check_ok, p.check_note]);
  const run = (what: string, fn: () => Promise<void>) => async () => {
    setBusy(what);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(failWords(e));
    } finally {
      setBusy("");
    }
  };
  const approve = run("approve", async () => {
    const r = await approveEdit(p.id);
    onChanged();
    if (r.conflict) return setError(CHANGED);
    await lc.refresh();
    const id = r.edit_id;
    lc.ctx.say(
      "התיקון אושר ונשמר לכל הקבוצה.",
      id
        ? {
            label: "ביטול",
            run: () =>
              void undoEdit(id)
                .then(() => lc.refresh())
                .then(() => lc.ctx.say("התיקון בוטל."))
                .catch((e) => lc.ctx.say(failWords(e))),
          }
        : undefined,
    );
  });
  const withdraw = run("withdraw", async () => {
    await withdrawEdit(p.id);
    onChanged();
    lc.ctx.say("ההצעה בוטלה.");
  });
  const checkIt = run("check", async () => setCheck(await fixCheck(p.id)));
  const slides = p.source_kind === "slide" ? p.source_slides : [];
  return (
    <>
      <ParagraphCard section={section} block={block} before={p.before_text} after={p.after_text} kind={p.kind} />
      <section className={`a-card k-proposal${p.state === "conflict" ? " conflict" : ""}`} aria-label="הצעת תיקון">
        <div className="a-row between">
          <span className="a-row">
            {p.proposed_by ? <Avatar id={p.proposed_by} name={who} /> : null}
            <b>הצעת תיקון · {who}</b>
          </span>
          {p.state === "pending" ? (
            <span className="a-chip warn">ממתין לאישור</span>
          ) : p.state === "disputed" ? (
            <span className="a-chip warn">מחלוקת</span>
          ) : p.state === "conflict" ? (
            <span className="a-chip bad">לא נשמר</span>
          ) : null}
        </div>
        {p.note ? <p className="a-small">{isolateLatin(p.note, "pn")}</p> : null}
        <SourceView lc={lc} x={p} />
        {check ? (
          <p className={`a-small k-check${check.ok ? " ok" : " bad"}`} role="status">
            {check.ok ? (
              `✓ נבדק מול שקף ${slides.join(", ")}: תואם`
            ) : (
              <>
                {`✗ נבדק מול שקף ${slides.join(", ")}: `}
                {isolateLatin(check.note, "chk")}
              </>
            )}
          </p>
        ) : null}
      </section>
      {p.state === "conflict" ? (
        <p className="a-callout warn a-small" role="status">
          {CHANGED}
        </p>
      ) : p.state === "pending" ? (
        <p className="a-small a-muted">{WAITING}</p>
      ) : null}
      {p.state === "pending" ? (
        <div className="a-card flat k-after">
          <b className="a-small">אחרי האישור, אצל כולם:</b>
          <div className="a-row a-small">
            <span className="k-ok">
              <Icon name="check" size={14} />
            </span>
            <span>{KIND_LABEL[p.kind] === "תיקון הטבלה" ? "הטבלה מתעדכנת, עם היסטוריה וביטול" : "הפסקה מתעדכנת, עם היסטוריה וביטול"}</span>
          </div>
          {flags.var ? (
            <div className="a-row a-small">
              <span className="k-ok">
                <Icon name="check" size={14} />
              </span>
              <span>גם השאלות והכרטיסיות שעל הפסקה</span>
            </div>
          ) : null}
          {flags.var && flags.today ? (
            <div className="a-row a-small">
              <span className="k-ok">
                <Icon name="check" size={14} />
              </span>
              <span>׳עדכון׳ ב׳היום׳, אם הישן כבר נלמד</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="a-error a-small" role="alert">
          {error}
        </p>
      ) : null}
      <div className="a-row sheet-actions k-foot">
        {flags.var && p.state === "pending" && !mine && !disputing ? (
          <button className="a-btn" onClick={() => setDisputing(true)}>
            לא מסכימים
          </button>
        ) : null}
        {p.state === "pending" && !mine ? (
          <button className="a-btn primary wide" disabled={Boolean(busy)} onClick={() => void approve()}>
            <Icon name="check" size={14} />
            {busy === "approve" ? "שומר…" : "לאשר"}
          </button>
        ) : null}
        {mine && (p.state === "pending" || p.state === "conflict") ? (
          <button className="a-btn" disabled={Boolean(busy)} onClick={() => void withdraw()}>
            לבטל את ההצעה
          </button>
        ) : null}
        {p.state === "conflict" && mine ? (
          <button className="a-btn primary" onClick={() => onEdit({ text: p.after_text, source: sourceOf(p), note: p.note })}>
            להציע שוב
          </button>
        ) : null}
        {p.state === "pending" && slides.length && !check ? (
          <button className="a-btn ghost" disabled={Boolean(busy)} onClick={() => void checkIt()}>
            {busy === "check" ? "בודקים מול השקף…" : "לבדוק מול השקף · כ-$0.01"}
          </button>
        ) : null}
      </div>
      {disputing ? <DisputeForm lc={lc} spot={spot} proposal={p} onClose={() => setDisputing(false)} /> : null}
    </>
  );
}

/** "לא מסכימים": a claim in one line with 1-4 slides opens V's
 *  yellow card on the paragraph, holding the proposal when there is one
 *  (section V, with VAR); without one, the card is about the paragraph as
 *  it reads ("מחלוקת על הפסקה"). */
function DisputeForm({ lc, spot, proposal: p, text, onClose }: { lc: LectureCtx; spot: Spot; proposal?: Proposal; text?: string; onClose: () => void }) {
  const offered = [...new Set([...(p?.source_kind === "slide" ? p.source_slides : []), ...citedSlides(p ? p.before_text : (text ?? ""))])].slice(0, 8);
  const [claim, setClaim] = useState("");
  const [slides, setSlides] = useState<number[]>(offered.slice(0, 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = async () => {
    setBusy(true);
    setError("");
    try {
      const id = await openDispute({ lectureId: lc.lecture.id, part: spot.part, anchor: spot.anchor, quote: spot.quote, claim: claim.trim(), slides, proposalId: p?.id ?? null });
      lc.ctx.go({ v: "dispute", d: id });
    } catch (e) {
      setError(failText(codeOf(e), "dispute"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="a-card flat a-stack k-dispute">
      <label className="a-field">
        <span>הטענה, בשורה אחת</span>
        <input className="a-input" dir="auto" maxLength={240} value={claim} onChange={(e) => setClaim(e.target.value)} />
      </label>
      <div className="a-wrap" role="group" aria-label="שקפים">
        {offered.map((n) => (
          <button
            key={n}
            type="button"
            className={`a-chip${slides.includes(n) ? " busy" : ""}`}
            aria-pressed={slides.includes(n)}
            onClick={() => setSlides((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n].slice(-4)))}
          >
            {slides.includes(n) ? `✓ ש׳ ${n}` : `ש׳ ${n}`}
          </button>
        ))}
      </div>
      {error ? (
        <p className="a-error a-small" role="alert">
          {error}
        </p>
      ) : null}
      <div className="a-row sheet-actions">
        <button className="a-btn" disabled={busy || claim.trim().length < 5 || !slides.length} onClick={() => void open()}>
          לפתוח מחלוקת
        </button>
        <button className="a-btn ghost" onClick={onClose}>
          ביטול
        </button>
      </div>
    </div>
  );
}

/** "הצעת תיקון": the editor, the preview, the source, "להציע לקבוצה". */
function Editor({
  lc,
  section,
  spot,
  block,
  md,
  initial,
  latest,
  onDone,
}: {
  lc: LectureCtx;
  section: Section;
  spot: Spot;
  block: Block;
  md: string;
  initial: { text?: string; source?: ProposalInput["source"]; note?: string };
  latest: Edit | undefined;
  onDone: () => void;
}) {
  // What the editor started from: a conflict compares the page's text with it.
  const start = useRef({ text: block.text, rev: section.rev ?? 0, gen: section.gen ?? 0, md });
  const parts = editableParts(block);
  const startText = initial.text ?? block.text;
  const initialBody = parts ? (editableParts({ kind: block.kind, text: startText })?.body ?? parts.body) : "";
  const table = block.kind === "table" ? tableCells(startText) : null;
  const [body, setBody] = useState(initialBody);
  const [cells, setCells] = useState(table?.cells ?? []);
  const [note, setNote] = useState(initial.note ?? "");
  const cited = useMemo(() => citedSlides(block.text), [block.text]);
  const range = useMemo(
    () => Array.from({ length: Math.max(0, section.slide_to - section.slide_from + 1) }, (_, i) => section.slide_from + i),
    [section.slide_from, section.slide_to],
  );
  const have = useMemo(() => new Set(lc.lecture.slides.map((s) => s.n)), [lc.lecture.slides]);
  const offered = useMemo(
    () => [...new Set([...cited, ...(initial.source?.kind === "slide" ? initial.source.slides : []), ...range])].filter((n) => have.has(n)).slice(0, 12),
    [cited, range, initial.source, have],
  );
  const [kind, setKind] = useState<SourceKind | null>(initial.source?.kind ?? (cited.length ? "slide" : null));
  const [slides, setSlides] = useState<number[]>(initial.source?.kind === "slide" ? initial.source.slides : cited.filter((n) => have.has(n)).slice(0, 1));
  const [minute, setMinute] = useState(initial.source?.kind === "recording" ? clock(initial.source.at) : "");
  const [external, setExternal] = useState(initial.source?.kind === "external" ? initial.source.note : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const firstCell = useRef<HTMLInputElement>(null);

  // Focused at once, the caret at the end (two taps from the page, review UX-7).
  useEffect(() => {
    const f = field.current;
    if (f) {
      f.focus({ preventScroll: true });
      f.setSelectionRange(f.value.length, f.value.length);
    } else firstCell.current?.focus({ preventScroll: true });
  }, []);

  const after = block.kind === "table" && table ? tableText({ cells, delimiter: table.delimiter }) : parts ? compose(parts, body) : block.text;
  const changed = tidy(after) !== tidy(block.text);
  // The slide tags the block had and the field no longer has (review UX-7).
  const lostTags = useMemo(() => {
    const was = (block.text.match(TAG) ?? []).map((t) => t.replace(/\s+/g, " "));
    const now = after.replace(/\s+/g, " ");
    return [...new Set(was)].filter((t) => !now.includes(t));
  }, [block.text, after]);
  const minuteSecs = parseMinute(minute);
  const source: ProposalInput["source"] | null =
    kind === "slide" && slides.length
      ? { kind: "slide", slides: slides.slice(0, 6) }
      : kind === "recording" && minuteSecs !== null
        ? { kind: "recording", at: minuteSecs }
        : kind === "external" && external.trim().length >= 3
          ? { kind: "external", note: external.trim() }
          : null;

  // The same paragraph changed for someone else while editing (Realtime).
  const nowText = blockSources(tidy(section.markdown))[spot.anchor]?.text;
  const movedUnder = nowText !== undefined && nowText !== start.current.text && conflict === null;

  const submit = async (onCurrent = false) => {
    setBusy(true);
    setError("");
    try {
      const base = onCurrent ? { md: tidy(section.markdown), rev: section.rev ?? 0, gen: section.gen ?? 0 } : start.current;
      const chk = checkEdit(base.md, spot.anchor, after);
      if (!chk.ok) {
        setError(failText(chk.why, "corrections"));
        return;
      }
      if (!source) {
        setError(failText("bad source", "corrections"));
        return;
      }
      await proposeEdit({
        lectureId: lc.lecture.id,
        part: spot.part,
        anchor: spot.anchor,
        before: chk.before,
        after: chk.after,
        baseRev: base.rev,
        baseGen: base.gen,
        occurrence: chk.occurrence,
        note: note.trim(),
        source,
      });
      lc.ctx.say("ההצעה נשמרה. התיקון יתעדכן לכולם אחרי אישור נוסף.");
      onDone();
    } catch (e) {
      if (codeOf(e) === "edit conflict") setConflict(nowText ?? "");
      else setError(failWords(e));
    } finally {
      setBusy(false);
    }
  };

  const who = latest?.author_id ? lc.ctx.nameOf(latest.author_id) || "ללא שם" : "ללא שם";
  if (conflict !== null)
    return (
      <div className="a-stack k-edit k-conflict-view" role="group" aria-label="הפסקה תוקנה בינתיים">
        <p className="a-callout warn">{`הפסקה תוקנה בינתיים ע״י ${who}.`}</p>
        <p className="a-small a-muted">הנוסח הנוכחי:</p>
        <Diff before={start.current.text} after={nowText ?? ""} kind={block.kind ?? "paragraph"} />
        <p className="a-small a-muted">הנוסח שלך:</p>
        <SummaryView markdown={after} compact />
        <div className="a-row sheet-actions">
          <button className="a-btn primary" disabled={busy} onClick={() => void submit(true)}>
            להציע את הנוסח שלי במקום
          </button>
          <button
            className="a-btn"
            onClick={() => {
              start.current = { text: nowText ?? block.text, rev: section.rev ?? 0, gen: section.gen ?? 0, md: tidy(section.markdown) };
              setConflict(null);
            }}
          >
            להמשיך לערוך
          </button>
          <button className="a-btn ghost" onClick={onDone}>
            לוותר על השינוי שלי
          </button>
        </div>
      </div>
    );

  const boxLabel = block.kind === "box" ? /\*\*([^*\n]{1,60}):\*\*/.exec(parts?.prefix ?? "")?.[1] : undefined;
  return (
    <div className="a-stack k-edit k-editor">
      <div className="a-row between">
        <b>הצעת תיקון</b>
        <span className="a-small a-muted">לכל הקבוצה, אחרי אישור</span>
      </div>
      {movedUnder ? (
        <div className="a-callout warn a-row between" role="status">
          <span className="a-small">{`הפסקה השתנתה עכשיו ע״י ${who}.`}</span>
          <button className="a-link" onClick={() => setConflict(nowText ?? "")}>
            לראות את הנוסח החדש
          </button>
        </div>
      ) : null}
      {block.kind === "table" && table ? (
        <div className="a-stack k-table-edit">
          <p className="a-small a-muted">אפשר לתקן תאים. הוספה או מחיקה של שורות ועמודות אינה אפשרית כאן.</p>
          {cells.map((row, r) => (
            <fieldset key={r} className="a-card flat a-stack k-cells">
              <legend className="a-small">{r === 0 ? "כותרות" : `שורה ${r}`}</legend>
              {row.map((cell, k) => (
                <label key={k} className="a-field">
                  <span>
                    {/* the column's own header, in its own direction ("t½", never "½t") */}
                    <bdi>{r === 0 ? `עמודה ${k + 1}` : cells[0][k] || `עמודה ${k + 1}`}</bdi>
                  </span>
                  <input
                    className="a-input"
                    dir="auto"
                    value={cell}
                    ref={r === 1 && k === 0 ? firstCell : undefined}
                    onChange={(e) => setCells((all) => all.map((x, i) => (i === r ? x.map((y, j) => (j === k ? e.target.value : y)) : x)))}
                  />
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      ) : (
        <label className="a-field">
          <span>{boxLabel ? `הנוסח המתוקן · ${boxLabel}` : "הנוסח המתוקן"}</span>
          <textarea ref={field} className="a-input" dir="rtl" lang="he" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
      )}
      <p className="a-small a-muted">הטקסט בין ** ** מודגש. את תגית השקף, למשל [ש׳ 12], כדאי להשאיר בסוף.</p>
      {lostTags.map((t) => (
        <div key={t} className="a-callout warn a-row between" role="status">
          <span className="a-small">{`תגית השקף ${t.replace(/^\[ש['׳]\s?/, "ש׳ ").replace(/\]$/, "")} נמחקה.`}</span>
          <button className="a-link" onClick={() => setBody((b) => `${b.trimEnd()} ${t}`)}>
            להחזיר
          </button>
        </div>
      ))}
      {changed ? (
        <div className="a-card flat k-preview" aria-label="תצוגה מקדימה">
          <span className="a-small a-muted">כך זה ייראה</span>
          <Diff before={block.text} after={after} kind={block.kind ?? "paragraph"} />
        </div>
      ) : null}
      <label className="a-field">
        <span>מה תוקן (לא חובה)</span>
        <input className="a-input" dir="auto" maxLength={300} value={note} placeholder="למשל: בשקף 12 כתוב 7-31" onChange={(e) => setNote(e.target.value)} />
      </label>
      <fieldset className="a-stack k-source-set">
        <legend className="a-small">
          <b>מקור (חובה)</b>
        </legend>
        <div className="a-row" role="radiogroup" aria-label="מקור (חובה)">
          {SOURCES.map((s) => (
            <button
              key={s.kind}
              type="button"
              role="radio"
              aria-checked={kind === s.kind}
              className={`a-chip${kind === s.kind ? " busy" : ""}`}
              onClick={() => setKind(s.kind)}
            >
              {kind === s.kind ? `${s.label} ✓` : s.label}
            </button>
          ))}
        </div>
        {kind === "slide" ? (
          <>
            <div className="a-wrap" role="group" aria-label="שקף">
              {offered.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`a-chip${slides.includes(n) ? " busy" : ""}`}
                  aria-pressed={slides.includes(n)}
                  onClick={() => setSlides((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n].slice(-6)))}
                >
                  {slides.includes(n) ? `✓ ש׳ ${n}` : `ש׳ ${n}`}
                </button>
              ))}
            </div>
            {slides.slice(0, 2).map((n) => (
              <SlideQuote key={n} lc={lc} n={n} />
            ))}
          </>
        ) : kind === "recording" ? (
          <label className="a-field">
            <span>דקה בהקלטה</span>
            <input className="a-input" dir="ltr" inputMode="numeric" placeholder="41:10" value={minute} onChange={(e) => setMinute(e.target.value)} />
          </label>
        ) : kind === "external" ? (
          <label className="a-field">
            <span>מאיפה?</span>
            <input className="a-input" dir="auto" maxLength={300} value={external} placeholder="למשל: הספר, פרק 12" onChange={(e) => setExternal(e.target.value)} />
          </label>
        ) : null}
      </fieldset>
      {error ? (
        <p className="a-error a-small" role="alert">
          {error}
        </p>
      ) : null}
      <div className="a-row sheet-actions">
        <button className="a-btn primary wide" disabled={busy || !changed || !source} onClick={() => void submit()}>
          {busy ? "שומר…" : "להציע לקבוצה"}
        </button>
        <button className="a-btn ghost" onClick={onDone}>
          ביטול
        </button>
      </div>
    </div>
  );
}

/** "אישור בקול" on the reader's bar: the reader of the day's live reading
 *  approves the proposal on the paragraph being read, for the group (never
 *  the reader's own; the database checks the live reading and two members
 *  following, section M). */
export function AloudCard({ lc, proposal: p, onDone }: { lc: LectureCtx; proposal: Proposal; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const who = (p.proposed_by ? lc.ctx.nameOf(p.proposed_by) : "") || "ללא שם";
  const approve = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await approveEdit(p.id, true);
      onDone();
      if (r.conflict) return setError(CHANGED);
      await lc.refresh();
      const id = r.edit_id;
      lc.ctx.say("התיקון אושר בקול ונשמר לכל הקבוצה.", id ? { label: "ביטול", run: () => void undoEdit(id).then(() => lc.refresh()).catch(() => undefined) } : undefined);
    } catch (e) {
      setError(failWords(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="a-row between k-aloud" role="group" aria-label="הצעת תיקון בפסקה שבהקראה">
      <span className="a-row">
        <b className="a-small">הצעת תיקון · {who}</b>
        <span className="a-chip warn">ממתין לאישור</span>
      </span>
      <button className="a-btn small" disabled={busy} onClick={() => void approve()}>
        <Icon name="check" size={14} />
        אישור בקול
      </button>
      {error ? (
        <span className="a-error a-small" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
