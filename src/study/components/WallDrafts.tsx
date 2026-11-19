import { useEffect, useRef, useState } from "react";
import type { Lecture, Section } from "../lib/api";
import { failText } from "../lib/failText";
import { richText } from "../lib/rich";
import { draftsLeft, draftsStream, drugChips, firstWords, getDrafts, paragraphHash, paragraphOf, setComposerSeed, type Draft } from "../lib/wall";
import type { ScreenProps } from "../features/types";
import { Icon } from "./Icon";
import { BackLink, Head, StickyActions } from "./Shell";

/* ── "תנו לי 3": three drafts to improve (package J; wall.html s2, W-10 … W-13) ──
 *
 * The paragraph, marked, with its slide tag. Drafts already saved for this
 * paragraph's text show at once, for everyone, with no call and no cost;
 * otherwise the estimate ("כ-$0.02 · נשמרות לכל הקבוצה · נשארו היום {n}") and
 * "תנו לי 3 מצחיקות" (op mnemonic), each draft arriving as it closes. A
 * draft: its number and technique, "טיוטה – תשפרו", the hook, "איך זה עובד"
 * (folded), "רמיקס" and "לפרסם כמו שהיא" (both open the composer: nothing
 * reaches the wall without a person, by name or without). The note W-12,
 * and the bottom bar "לכתוב משלי" · "צילום של שרבוט". */

type Saved = { id: string; fact: string; slides: number[]; drafts: Draft[] };

export default function WallDrafts({ route, ctx, lecture, sections }: ScreenProps<"wall"> & { lecture: Lecture; sections: Section[] }) {
  const at = route.at ?? { part: 0, anchor: 0 };
  const section = sections.find((s) => s.idx === at.part);
  const para = paragraphOf(sections, at.part, at.anchor);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [streaming, setStreaming] = useState<Draft[] | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const stop = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!para) return setLoading(false);
    let alive = true;
    void (async () => {
      try {
        const [row, hash] = await Promise.all([getDrafts(lecture.id, at.part, at.anchor), paragraphHash(para.text)]);
        // Drafts of this paragraph's text as written now (a corrected paragraph may get new ones).
        if (alive && row && (hash === null || row.src_hash === hash)) setSaved({ id: row.id, fact: row.fact, slides: row.slides, drafts: row.drafts });
      } catch {
        /* the button stays */
      }
      const n = await draftsLeft(ctx.group.id).catch(() => null);
      if (alive) {
        setLeft(n);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
      stop.current?.abort();
    };
  }, [lecture.id, at.part, at.anchor, para?.text, ctx.group.id]);

  const ask = async () => {
    if (!section || !para) return;
    setError("");
    setStreaming([]);
    const ctl = new AbortController();
    stop.current = ctl;
    const got: Draft[] = [];
    try {
      await draftsStream(
        { lectureId: lecture.id, part: at.part, anchor: at.anchor, gen: section.gen ?? 0 },
        (l) => {
          if (l.t === "d") {
            got.push(l.d);
            setStreaming([...got]);
          } else if (l.t === "saved" || l.t === "done") {
            // "saved": another member's tap already paid for this text; "done": this one.
            setSaved({ id: l.id, fact: l.fact, slides: l.slides, drafts: l.t === "saved" ? l.drafts : [...got] });
            if (l.left !== null) setLeft(l.left);
          }
        },
        ctl.signal,
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(failText(code, "mnemonic"));
      // Another phone's request holds this text (review SEC4-3): its drafts land here, free.
      if (code === "busy") void waitForDrafts(ctl.signal);
    } finally {
      setStreaming(null);
    }
  };
  const waitForDrafts = async (signal: AbortSignal) => {
    const hash = para ? await paragraphHash(para.text).catch(() => null) : null;
    for (let i = 0; i < 40 && !signal.aborted; i++) {
      await new Promise((ok) => setTimeout(ok, 3000));
      if (signal.aborted) return;
      const row = await getDrafts(lecture.id, at.part, at.anchor).catch(() => null);
      if (row && (hash === null || row.src_hash === hash)) {
        setSaved({ id: row.id, fact: row.fact, slides: row.slides, drafts: row.drafts });
        setError("");
        return;
      }
    }
  };

  const open = (mode: "line" | "sketch" | "remix" | "draft", d?: Draft, no?: number) => {
    setComposerSeed({
      lectureId: lecture.id,
      part: at.part,
      anchor: at.anchor,
      mode,
      body: d?.hook,
      fact: saved?.fact,
      draftId: d ? saved?.id : null,
      draftNo: d ? no : null,
    });
    ctx.go({ v: "wall", l: lecture.id, at, x: "post" });
  };

  const drafts = streaming ?? saved?.drafts ?? [];
  // The head names the paragraph's drug, as wall.html s2 does ("תנו לי 3 · Miltefosine"), else its first words.
  const topic = para ? (drugChips(para.text)[0] ?? firstWords(para.text, 28)) : "";
  return (
    <main className="wall-screen wall-drafts">
      <Head back={<BackLink go={ctx.go} fallback={{ v: "wall", l: lecture.id }} label="→ לקיר" />}>
        <h1 className="t">תנו לי 3 · {richText(topic, "tp")}</h1>
      </Head>
      <p className="ph-sub">
        <span>נכתבו פעם אחת, ונשמרות על הפסקה לכל הקבוצה</span>
      </p>
      {para ? (
        <p className="a-para marked" dir="rtl">
          {richText(para.text, "pp")}
        </p>
      ) : (
        <p className="a-card dashed">הפסקה הזו לא נמצאה. כדאי לרענן.</p>
      )}
      {saved?.fact ? (
        <p className="a-small wall-fact" dir="rtl">
          <b>העובדה:</b> {richText(saved.fact, "sf")}
        </p>
      ) : null}
      {loading ? <p className="a-muted loading">טוען…</p> : null}
      {!loading && para && !drafts.length && streaming === null ? (
        <section className="a-card flat wall-ask a-stack">
          <p className="a-small a-muted">כ-$0.02 · נשמרות לכל הקבוצה{left !== null ? ` · נשארו היום ${left}` : ""}</p>
          <button className="a-btn primary wide" disabled={left === 0} onClick={() => void ask()}>
            <Icon name="smile" size={14} /> תנו לי 3 מצחיקות
          </button>
        </section>
      ) : null}
      {streaming !== null && !streaming.length ? (
        <p className="a-muted loading" role="status">
          מחפשים משהו שאי אפשר לשכוח…
        </p>
      ) : null}
      <ol className="a-stack wall-draft-list" aria-live="polite">
        {drafts.map((d, i) => (
          <li key={`${i}-${d.technique}`} className={`a-card flat wall-draft${i === 0 ? " first" : ""}`}>
            <div className="a-row between">
              <span className="a-chip busy">{`${i + 1} · ${d.technique}`}</span>
              <span className="a-small a-muted">טיוטה – תשפרו</span>
            </div>
            <p className="a-para" dir="rtl">
              {richText(d.hook, `h${i}`)}
            </p>
            <details className="wall-decode">
              <summary className="a-small">איך זה עובד</summary>
              <p className="a-small a-muted" dir="rtl">
                {richText(d.decode, `d${i}`)}
              </p>
            </details>
            {streaming === null && saved ? (
              <div className="a-row">
                <button className="a-btn small" onClick={() => open("remix", d, i + 1)}>
                  <Icon name="pen" size={12} /> רמיקס
                </button>
                <button className={`a-btn small${i === 0 ? " primary" : ""}`} onClick={() => open("draft", d, i + 1)}>
                  לפרסם כמו שהיא
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="a-small a-muted">שום דבר לא עולה לקיר בלי בן אדם, בשם או בלי שם. לפני שהמנצחת נכנסת לכרטיסיות, היא נבדקת מול הפסקה.</p>
      <StickyActions>
        <button className="a-btn wide" onClick={() => open("line")}>
          <Icon name="pen" size={12} /> לכתוב משלי
        </button>
        <button className="a-btn wide" onClick={() => open("sketch")}>
          <Icon name="image" size={12} /> צילום של שרבוט
        </button>
      </StickyActions>
    </main>
  );
}
