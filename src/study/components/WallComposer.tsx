import "../styles/wall.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { citedSlides } from "../../../shared/study/edits";
import { members as listMembers, type Lecture, type Section } from "../lib/api";
import { failText } from "../lib/failText";
import { isolateLatin, richText } from "../lib/rich";
import { shrinkPhoto } from "../lib/photo";
import {
  composerError,
  draftKey,
  drugChips,
  editAid,
  firstWords,
  paragraphOf,
  postAid,
  readLocal,
  takeComposerSeed,
  uploadPhoto,
  writeLocal,
  type AidKind,
  type ComposerSeed,
} from "../lib/wall";
import type { Ctx, ScreenProps } from "../features/types";
import { Icon } from "./Icon";
import { Avatar, BackLink, Head, Sheet, StickyActions } from "./Shell";

/* ── The composer (package J; wall.html s3, fun design §5.5, W-14 … W-20) ──
 *
 * "משלי" · "רמיקס" · "צילום של שרבוט" · "לנעוץ רגע" (and "לפרסם כמו שהיא",
 * a draft posted as it is; and "עריכה" of one's own). The paragraph's chip;
 * the association (or the photo and its caption); "על מה זה? (חובה…)",
 * prefilled from the drafts' fact; "על איזו תרופה?" from the paragraph's
 * English names; "בשם שלי" · "בלי שם" and its line; a credit, only with the
 * credited member's yes (a moment, K6); "גם בשקף: … · לצרף" when a cited
 * slide has a picture; the house rule; "לפרסם" or "לנעוץ". A screen
 * (?v=wall&x=post) from the wall and its drafts, a sheet over the reader for
 * "לנעוץ רגע" (the paragraph being read aloud). */

type Mode = ComposerSeed["mode"];
const TITLE: Record<Mode, string> = {
  line: "משלי",
  remix: "רמיקס",
  sketch: "צילום של שרבוט",
  draft: "לפרסם כמו שהיא",
  moment: "לנעוץ רגע",
  edit: "עריכה",
};

type FormProps = {
  ctx: Ctx;
  lecture: Pick<Lecture, "id" | "slides">;
  sections: Section[];
  part: number;
  anchor: number;
  seed: ComposerSeed;
  /** "לפסקה שמוקראת עכשיו" in a moment. */
  live?: boolean;
  figureUrl?: (path: string) => string | undefined;
  /** Where the primary action goes: the screen's bottom bar, or the sheet's own row. */
  actions: (post: () => void, busy: boolean, label: string) => ReactNode;
  onDone: (posted: { id: string; credit: string | null } | null) => void;
};

/** The composer's fields, for the screen and for the moment's sheet. */
export function ComposerForm({ ctx, lecture, sections, part, anchor, seed, live, figureUrl, actions, onDone }: FormProps) {
  const mode = seed.mode;
  const para = paragraphOf(sections, part, anchor);
  const storeKey = draftKey(ctx.userId, lecture.id);
  const [body, setBody] = useState(() => seed.body ?? (mode === "line" ? readLocal(storeKey) : ""));
  const [fact, setFact] = useState(seed.fact ?? "");
  const [drug, setDrug] = useState("");
  const [named, setNamed] = useState(true);
  const [credit, setCredit] = useState<{ id: string; name: string } | null>(seed.credit ?? null);
  const [creditOn, setCreditOn] = useState(Boolean(seed.credit));
  const [others, setOthers] = useState<Array<{ user_id: string; name: string }>>([]);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [withFigure, setWithFigure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const isPhoto = mode === "sketch";
  const locked = mode === "draft";

  useEffect(() => {
    if (mode !== "moment" || seed.credit) return;
    let alive = true;
    listMembers(ctx.group.id)
      .then((m) => alive && setOthers(m.filter((x) => x.user_id !== ctx.userId)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [mode, seed.credit, ctx.group.id, ctx.userId]);
  useEffect(() => () => (photo ? URL.revokeObjectURL(photo.url) : undefined), [photo]);
  // An unsent "משלי" stays on this phone until it is posted.
  useEffect(() => {
    if (mode === "line") writeLocal(storeKey, body);
  }, [mode, storeKey, body]);

  // The English names of the paragraph and of what is being written.
  const drugs = useMemo(() => drugChips(`${para?.text ?? ""} ${body}`), [para?.text, body]);
  const have = useMemo(() => new Set(lecture.slides.map((s) => s.n)), [lecture.slides]);
  const paraSlides = para ? citedSlides(para.text).filter((n) => have.has(n)) : [];
  // The slide's picture for "גם בשקף": the first cited slide that has one.
  const figure = useMemo(() => {
    for (const n of citedSlides(`${fact} ${para?.text ?? ""}`)) {
      const s = lecture.slides.find((x) => x.n === n);
      const f = s?.figures?.find((x) => x.k > 0);
      if (s && f) return { key: `fig:${s.n}-${f.k}`, title: s.title || `שקף ${s.n}`, n: s.n, path: f.path };
    }
    return null;
  }, [fact, para?.text, lecture.slides]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      const blob = await shrinkPhoto(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setError(failText(e instanceof Error ? e.message : "bad photo", "wall"));
    }
  };

  const post = async () => {
    const kind: AidKind = mode === "edit" ? "line" : mode === "sketch" ? "sketch" : mode === "remix" ? "remix" : mode === "draft" ? "draft" : mode === "moment" ? "moment" : "line";
    const bad = composerError({ body, fact, photo: Boolean(photo), kind });
    if (bad) return setError(failText(bad, "wall"));
    if (!para && mode !== "edit") return setError(failText("part not found", "wall"));
    setBusy(true);
    setError("");
    try {
      const factSlides = citedSlides(`${fact} ${body}`).filter((n) => have.has(n));
      const slides = (factSlides.length ? factSlides : paraSlides).slice(0, 6);
      if (mode === "edit" && seed.editId) {
        await editAid(seed.editId, body, fact, slides);
        ctx.say("נשמר. הסימונים והבדיקה מתחילים מחדש.");
        onDone({ id: seed.editId, credit: null });
        return;
      }
      const path = photo ? await uploadPhoto(ctx.group.id, photo.blob) : null;
      const credited = creditOn && credit ? credit : null;
      const id = await postAid({
        lectureId: lecture.id,
        part,
        anchor,
        quote: para?.quote ?? "",
        kind,
        body,
        fact,
        slides,
        drug,
        named,
        remixOf: kind === "remix" ? (seed.remixOf ?? null) : null,
        draftId: kind === "remix" || kind === "draft" ? (seed.draftId ?? null) : null,
        draftNo: kind === "remix" || kind === "draft" ? (seed.draftNo ?? null) : null,
        photo: path,
        figure: withFigure && figure ? figure.key : null,
        credit: credited?.id ?? null,
      });
      if (mode === "line") writeLocal(storeKey, "");
      ctx.say(credited ? `נשלחה בקשת קרדיט ל${credited.name}.` : mode === "moment" ? "ננעץ לפסקה." : "עלה לקיר.");
      onDone({ id, credit: credited?.name ?? null });
    } catch (e) {
      setError(failText(e instanceof Error ? e.message : "", "wall"));
    } finally {
      setBusy(false);
    }
  };

  const label = mode === "moment" ? "לנעוץ" : mode === "edit" ? "לשמור" : "לפרסם";
  return (
    <>
      <div className="a-stack wall-composer">
        {para && !live ? (
          <div className="a-row between">
            <span className="a-chip busy wall-spot">{live ? "לפסקה שמוקראת עכשיו" : <>לפסקה: {isolateLatin(firstWords(para.text, 40), "sp")}</>}</span>
          </div>
        ) : null}
        {isPhoto ? (
          <div className="a-stack">
            <input ref={fileRef} className="wall-file" type="file" accept="image/*" aria-label="לצלם או לבחור תמונה" onChange={(e) => void pick(e.target.files?.[0])} />
            <button type="button" className="a-btn wide" onClick={() => fileRef.current?.click()}>
              <Icon name="image" size={14} /> {photo ? "תמונה אחרת" : "לצלם או לבחור תמונה"}
            </button>
            {photo ? <img className="wall-photo" src={photo.url} alt="התמונה שתעלה לקיר" /> : null}
          </div>
        ) : null}
        <label className="a-field">
          <span>{isPhoto ? "כיתוב" : "האסוציאציה"}</span>
          <textarea
            className="a-input"
            dir="rtl"
            rows={3}
            maxLength={500}
            readOnly={locked}
            placeholder={isPhoto ? "" : "משפט, חרוז או סצנה שנדבקת"}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <label className="a-field">
          <span>על מה זה? (חובה, שיהיה מובן גם בלי הפגישה)</span>
          <input className="a-input" dir="rtl" maxLength={300} value={fact} onChange={(e) => setFact(e.target.value)} />
        </label>
        {mode !== "edit" ? (
          <>
            {drugs.length ? (
              <div className="a-stack wall-drugs">
                <span className="a-small a-muted">על איזו תרופה?</span>
                <div className="a-wrap">
                  {drugs.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`a-chip${drug.toLowerCase() === d.toLowerCase() ? " busy" : ""}`}
                      aria-pressed={drug.toLowerCase() === d.toLowerCase()}
                      onClick={() => setDrug(drug.toLowerCase() === d.toLowerCase() ? "" : d)}
                    >
                      {drug.toLowerCase() === d.toLowerCase() ? "✓ " : ""}
                      <bdi dir="ltr">{d}</bdi>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="a-seg" role="radiogroup" aria-label="בשם או בלי שם">
              <button type="button" className="a-btn small" role="radio" aria-checked={named} onClick={() => setNamed(true)}>
                בשם שלי
              </button>
              <button type="button" className="a-btn small" role="radio" aria-checked={!named} onClick={() => setNamed(false)}>
                בלי שם
              </button>
            </div>
            {!named ? <p className="a-small a-muted">בלי שם: השם נשמר רק כדי שאפשר יהיה למחוק.</p> : null}
            {credit ? (
              <label className="a-choice wall-credit">
                <input type="checkbox" checked={creditOn} onChange={(e) => setCreditOn(e.target.checked)} />
                <Avatar id={credit.id} name={credit.name} />
                <span className="a-small">לתת קרדיט ל{credit.name}?</span>
                <span className="a-chip warn">רק באישור של {credit.name}</span>
              </label>
            ) : mode === "moment" && others.length ? (
              <div className="a-stack">
                <span className="a-small a-muted">לתת קרדיט למישהו? רק באישור שלהם</span>
                <div className="a-wrap">
                  {others.map((m) => (
                    <button key={m.user_id} type="button" className="a-chip" onClick={() => (setCredit({ id: m.user_id, name: m.name }), setCreditOn(true))}>
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {figure && !isPhoto ? (
              <div className="a-row between wall-figure">
                <span className="a-small a-muted">
                  גם בשקף: {richText(figure.title, "ft")} <span className="a-tag src-tag">ש׳ {figure.n}</span>
                </span>
                <button type="button" className="a-btn ghost small" aria-pressed={withFigure} onClick={() => setWithFigure((w) => !w)}>
                  <Icon name="image" size={12} /> {withFigure ? "מצורף ✓" : "לצרף"}
                </button>
              </div>
            ) : null}
            {withFigure && figure && figureUrl?.(figure.path) ? <img className="wall-photo" src={figureUrl(figure.path)} alt={`מהשקף ${figure.n}`} /> : null}
          </>
        ) : null}
        <p className="a-small a-muted wall-rule">
          <Icon name="smile" size={12} /> צולים את התרופה, אף פעם לא אנשים או מטופלים.
        </p>
        {error ? (
          <p className="a-error a-small" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {/* The screen's bottom bar is the main's own child (the kit's ph-foot); the sheet's row its own. */}
      {actions(() => void post(), busy, label)}
    </>
  );
}

/** ?v=wall&l=&at=&x=post (and x=moment off the reader): the composer as a screen. */
export default function ComposerScreen({ route, ctx, lecture, sections, figureUrl }: ScreenProps<"wall"> & { lecture: Lecture; sections: Section[]; figureUrl?: (p: string) => string | undefined }) {
  const at = route.at ?? { part: 0, anchor: 0 };
  const [seed] = useState<ComposerSeed>(
    () => takeComposerSeed(lecture.id, at.part, at.anchor) ?? { lectureId: lecture.id, part: at.part, anchor: at.anchor, mode: route.x === "moment" ? "moment" : "line" },
  );
  const back = { v: "wall" as const, l: lecture.id };
  return (
    <main className="wall-screen wall-compose">
      <Head back={<BackLink go={ctx.go} fallback={back} label="→ לקיר" />} title={TITLE[seed.mode]} />
      <ComposerForm
        ctx={ctx}
        lecture={lecture}
        sections={sections}
        part={at.part}
        anchor={at.anchor}
        seed={seed}
        live={seed.mode === "moment"}
        figureUrl={figureUrl}
        onDone={() => ctx.go({ v: "wall", l: lecture.id, t: "new" }, { replace: true })}
        actions={(post, busy, label) => (
          <StickyActions>
            <button className="a-btn primary wide" disabled={busy} onClick={post}>
              {busy ? "שומר…" : label}
            </button>
          </StickyActions>
        )}
      />
    </main>
  );
}

/** "לנעוץ רגע" over the reader (the follower's or the reader's bar): the paragraph being read aloud. */
export function MomentSheet({ ctx, lecture, sections, part, anchor, figureUrl, onClose }: { ctx: Ctx; lecture: Lecture; sections: Section[]; part: number; anchor: number; figureUrl?: (p: string) => string | undefined; onClose: () => void }) {
  const seed: ComposerSeed = { lectureId: lecture.id, part, anchor, mode: "moment" };
  return (
    <Sheet
      label="לנעוץ רגע"
      className="wall-sheet"
      onClose={onClose}
      head={
        <span className="a-row between wall-sheet-head">
          <h2 className="a-row">
            <Icon name="star" size={16} /> לנעוץ רגע
          </h2>
          <span className="a-chip busy">לפסקה שמוקראת עכשיו</span>
        </span>
      }
    >
      {(sheet) => (
        <ComposerForm
          ctx={ctx}
          lecture={lecture}
          sections={sections}
          part={part}
          anchor={anchor}
          seed={seed}
          live
          figureUrl={figureUrl}
          onDone={() => sheet.close()}
          actions={(post, busy, label) => (
            <div className="a-row sheet-actions">
              <button className="a-btn primary wide" disabled={busy} onClick={post}>
                {busy ? "שומר…" : label}
              </button>
            </div>
          )}
        />
      )}
    </Sheet>
  );
}
