import { useEffect, useState } from "react";
import type { Ctx } from "../features/types";
import { flags } from "../lib/flags";
import { cardLive, COPY, DONE_BY, hintFlags, readMemory, writeMemory, type Memory } from "../lib/guide";
import { GUIDE_EVENT, guideSend, type GuideCommand } from "../lib/guideMark";
import { RouteLink, pushUrl } from "./Shell";
import { APP_PATH } from "../lib/route";
import "../styles/guide.css";

/* ── "מדריך לאפליקציה" in "שלי" (docs/study/guide.md §2.5) ──
 * For members who joined before the guide, and for anyone who hid it: the
 * app tour ("סיור קצר באפליקציה", over the tab bar, right here), the first
 * steps again (or from the start), the "חדש" tips on or off, "איך עושים…?"
 * and the sandbox. Everything here is this device's only. */

export default function GuideMe({ ctx }: { ctx: Ctx }) {
  const [m, setM] = useState<Memory>(() => readMemory(ctx.userId));
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<GuideCommand>).detail?.type === "changed" && setM(readMemory(ctx.userId));
    window.addEventListener(GUIDE_EVENT, on);
    return () => window.removeEventListener(GUIDE_EVENT, on);
  }, [ctx.userId]);

  const save = (patch: Partial<Memory>) => {
    const next = { ...readMemory(ctx.userId), ...patch };
    writeMemory(ctx.userId, next);
    setM(next);
    guideSend({ type: "changed" });
  };
  const home = () => ctx.go({ v: "today" });

  const now = Date.now();
  const live = cardLive(m, now);
  const done = m.list.filter((id) => DONE_BY[id].some((e) => m.did.includes(e))).length;
  let line: string;
  let action: { label: string; run: () => void };
  if (live) {
    line = m.list.length ? `${done} מתוך ${m.list.length}, במסך הבית` : "במסך הבית";
    action = { label: "למסך הבית", run: home };
  } else if (m.born && m.hidden && now - m.born <= 14 * 86_400_000) {
    line = "מוסתרים כרגע";
    action = { label: "להחזיר", run: () => (save({ hidden: false }), home()) };
  } else {
    line = m.born ? "אפשר להתחיל שוב מההתחלה" : "כמה צעדים קצרים במסך הבית, כל אחד משהו אמיתי";
    action = {
      label: m.born ? "מההתחלה" : "להתחיל",
      run: () => (save({ born: Date.now(), mode: m.mode ?? "join", views: 0, list: [], hidden: false, closed: false, known: m.known ?? hintFlags(flags) }), home()),
    };
  }

  return (
    <section className="a-stack" aria-labelledby="g-me-h">
      <div className="a-sec">
        <h2 id="g-me-h">{COPY.guideTitle}</h2>
      </div>
      <div className="a-list g-me">
        <div className="a-li g-me-tour">
          <div>
            <b>{COPY.tourTitle}</b>
            <span className="m">{COPY.meTourLine}</span>
          </div>
          <button
            type="button"
            className="a-btn small primary"
            onClick={(e) => {
              // Answers the home's offer too: the tour was found.
              if (!m.offer) save({ offer: "taken" });
              guideSend({ type: "tour", opener: e.currentTarget });
            }}
          >
            {COPY.tourStart}
          </button>
        </div>
        <div className="a-li">
          <div>
            <b>הצעדים הראשונים</b>
            <span className="m">{line}</span>
          </div>
          <button type="button" className="a-btn small" onClick={action.run}>
            {action.label}
          </button>
        </div>
        <label className="a-li setting-row setting-check">
          <span>טיפים על דברים חדשים</span>
          <input type="checkbox" checked={m.tips} onChange={(e) => save({ tips: e.target.checked })} />
        </label>
        <a
          href={`${APP_PATH}?v=help#howto`}
          className="a-li row-link"
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            pushUrl(`${APP_PATH}?v=help#howto`, "me");
          }}
        >
          איך עושים…?
        </a>
        <RouteLink to={{ v: "try" }} go={ctx.go} className="a-li row-link">
          לנסות בלי לחץ
        </RouteLink>
      </div>
    </section>
  );
}
