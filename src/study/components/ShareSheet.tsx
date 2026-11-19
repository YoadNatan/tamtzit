import { useEffect, useRef, useState, type ReactNode } from "react";
import { figureUrls, type Lecture, type Section } from "../lib/api";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { shareUrl } from "../lib/route";
import { addPrintCss, canShareFile, deliverFile, printHere, removePrintCss, requestPdf } from "../lib/pdf-export";
import type { Say } from "../features/types";
import PrintDoc from "./PrintDoc";
import { Icon } from "./Icon";
import { Sheet } from "./Shell";

/* ── "שיתוף": the link, the PDF, or the device's printing (design-platform §1.B) ──
 * "קישור לסיכום" shares the lecture's link (it opens only for the group's
 * members). "קובץ PDF" (with VITE_STUDY_PDF, once the server PDF ships)
 * sends the print layout to /api/study/pdf and offers the file to the share
 * sheet on a fresh tap ("שליחה") or saves it ("שמירה"). "הדפסה מהמכשיר"
 * prints the same layout here, without the server; an iPhone prints it
 * without our page numbers. Both wait until every part is written. The print
 * layout (PrintDoc) is on the page only while this sheet prints or builds. */

type Props = {
  lecture: Lecture;
  sections: Section[];
  groupName: string;
  say: Say;
  /** The lecture has "מההקלטה" notes: they can go into the layout. */
  hasNotes: boolean;
  extrasFor: (s: Section) => ((anchor: number) => ReactNode) | undefined;
  onClose: () => void;
};

type PdfState = { s: "idle" } | { s: "building" } | { s: "ready"; file: File; pages: number } | { s: "error"; text: string };

export default function ShareSheet({ lecture, sections, groupName, say, hasNotes, extrasFor, onClose }: Props) {
  const ready = sections.length > 0 && sections.every((s) => s.status === "ready");
  const [withNotes, setWithNotes] = useState(true);
  const [layout, setLayout] = useState<null | { local: boolean; urls: Record<string, string> }>(null);
  const [pdf, setPdf] = useState<PdfState>({ s: "idle" });
  const [printing, setPrinting] = useState(false);
  const doc = useRef<HTMLDivElement>(null);
  const job = useRef<"pdf" | "print" | null>(null);

  // The print stylesheet goes with the layout.
  useEffect(() => () => removePrintCss(), []);

  /** Fresh picture links (6 hours), then the layout on the page. */
  const lay = async (local: boolean) => {
    const paths = lecture.slides.flatMap((s) => s.figures.map((f) => f.path));
    const urls = await figureUrls(paths).catch(() => ({}) as Record<string, string>);
    setLayout({ local, urls });
  };

  // Once the layout is on the page, the job that asked for it runs.
  useEffect(() => {
    const el = doc.current;
    const what = job.current;
    if (!layout || !el || !what) return;
    job.current = null;
    if (what === "print") {
      void printHere(el).finally(() => setPrinting(false));
      return;
    }
    addPrintCss();
    requestPdf(lecture.id, el)
      .then(({ file, pages }) => setPdf({ s: "ready", file, pages }))
      .catch((e: unknown) => setPdf({ s: "error", text: failText(e instanceof Error ? e.message : "", "pdf") }));
  }, [layout, lecture.id]);

  const link = async (close: () => void) => {
    const text = `${lecture.title || "סיכום"}: ${shareUrl(`?l=${lecture.id}`)}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        say("הקישור הועתק.");
      }
      close();
    } catch {
      /* the share sheet was closed */
    }
  };
  const makePdf = () => {
    if (pdf.s === "building") return;
    setPdf({ s: "building" });
    job.current = "pdf";
    void lay(false);
  };
  const print = () => {
    if (printing) return;
    setPrinting(true);
    job.current = "print";
    if (layout?.local) {
      // Already laid out for this device: print it again.
      setLayout({ ...layout });
      return;
    }
    void lay(true);
  };
  const deliver = async (how: "share" | "save") => {
    if (pdf.s !== "ready") return;
    const done = await deliverFile(pdf.file, how);
    if (done === "saved") say("הקובץ נשמר.");
  };

  const figureUrl = (slide: number, k: number) => {
    const f = lecture.slides.find((s) => s.n === slide)?.figures.find((x) => x.k === k);
    return f ? layout?.urls[f.path] : undefined;
  };

  return (
    <>
      <Sheet label="שיתוף הסיכום" className="share-sheet" head={<h2>שיתוף הסיכום</h2>} onClose={onClose}>
        {(sheet) => (
          <div className="a-stack share-body">
            <ul className="a-list share-options">
              <li>
                <button type="button" className="a-li share-option" onClick={() => void link(sheet.close)}>
                  <div>
                    <b className="share-title">קישור לסיכום</b>
                    <span className="m share-sub">נפתח רק לחברי הקבוצה.</span>
                  </div>
                  <span className="share-icon" aria-hidden="true">
                    <Icon name="send" size={18} />
                  </span>
                </button>
              </li>

              {flags.pdf ? (
                <li>
                  {pdf.s === "ready" ? (
                    <div className="a-li share-ready" role="status">
                      <div>
                        <b className="share-title">
                          ה-PDF מוכן: <bdi>{pdf.pages}</bdi> עמודים
                        </b>
                        <div className="a-row share-acts">
                          {canShareFile(pdf.file) ? (
                            <button type="button" className="a-btn primary" onClick={() => void deliver("share")}>
                              שליחה
                            </button>
                          ) : null}
                          <button type="button" className="a-btn" onClick={() => void deliver("save")}>
                            שמירה
                          </button>
                        </div>
                      </div>
                      <span className="a-chip ok">✓ מוכן</span>
                    </div>
                  ) : (
                    <button type="button" className="a-li share-option" onClick={makePdf} disabled={!ready || pdf.s === "building"} aria-busy={pdf.s === "building"}>
                      <div>
                        <b className="share-title">{pdf.s === "building" ? "מכינים PDF… (עד חצי דקה)" : "קובץ PDF"}</b>
                        <span className="m share-sub">
                          {ready ? "עם מספרי עמודים, עמוד שער ותוכן עניינים, לשליחה בוואטסאפ." : "ה-PDF יהיה זמין כשכל החלקים ייכתבו."}
                        </span>
                      </div>
                      {pdf.s === "building" ? <span className="a-chip busy">מכינים</span> : !ready ? <span className="a-chip">ממתין</span> : null}
                    </button>
                  )}
                </li>
              ) : null}

              <li>
                <button type="button" className="a-li share-option" onClick={print} disabled={!ready || printing}>
                  <div>
                    <b className="share-title">הדפסה מהמכשיר</b>
                    <span className="m share-sub">{ready ? "בלי שרת. באייפון בלי מספרי העמודים." : "ההדפסה תהיה זמינה כשכל החלקים ייכתבו."}</span>
                  </div>
                  {!ready ? <span className="a-chip">ממתין</span> : null}
                </button>
              </li>
            </ul>
            {pdf.s === "error" ? (
              <p className="a-error" role="alert">
                {pdf.text}
              </p>
            ) : null}

            {hasNotes ? (
              <label className="a-choice share-check">
                <input type="checkbox" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} />
                <span>לכלול את ההערות מההקלטה</span>
              </label>
            ) : null}
            {flags.pdf ? <p className="share-foot a-small a-muted">קובץ PDF שנשלח יוצא מהאפליקציה: כל מי שמקבלים אותו יכולים לקרוא אותו.</p> : null}
          </div>
        )}
      </Sheet>
      {layout ? (
        <PrintDoc
          ref={doc}
          lecture={lecture}
          sections={sections}
          figureUrl={figureUrl}
          groupName={groupName}
          local={layout.local}
          extrasFor={hasNotes && withNotes ? extrasFor : undefined}
        />
      ) : null}
    </>
  );
}
