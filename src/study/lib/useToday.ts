import { useEffect, useMemo, useState } from "react";
import type { KindFlag, QueueItem } from "../../../shared/study/today";
import { TODAY_SLOTS, type TodaySlot } from "../features/today";
import type { Ctx } from "../features/types";
import { flags } from "./flags";
import { loadToday, loadTodayCards, todayItems, type TodayCards, type TodayData } from "./today";

/* ── Today's sources, as one hook (package T, T-1) ──
 * The database's one call (study_today), the due cards (C's queue on the
 * phone, with the in-app review on), and the other packages' rows through
 * TODAY_SLOTS (features/today.tsx), each only with its flag. A failing
 * source leaves its row out; only the database's call failing is an error.
 * Today's home and its session read the same queue. */

/** Whether a row's flag is on in this build. */
export const rowOn = (k: KindFlag): boolean => Boolean(flags[k]);

/** Today's sources: the database's call, the due cards, the other packages' rows. */
export function useTodayQueue(ctx: Ctx, on = true): { data: TodayData | null; items: QueueItem[]; ready: boolean; error: boolean; reload: () => void } {
  const [data, setData] = useState<TodayData | null>(null);
  const [cards, setCards] = useState<TodayCards | null>(null);
  const [extra, setExtra] = useState<QueueItem[]>([]);
  /** The cards and the slots have answered (or failed): the queue is whole. */
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    setError(false);
    setSettled(false);
    loadToday(ctx.group.id)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true));
    const slots = [flags.mistakes && TODAY_SLOTS.again, flags.pulse && TODAY_SLOTS.pulse, flags.groupPlan && TODAY_SLOTS.lane].filter(
      (s): s is TodaySlot => Boolean(s),
    );
    void Promise.all([
      // the cards' row only: a failure leaves the rest of the queue
      flags.cardsReview ? loadTodayCards(ctx.group.id, ctx.userId).catch(() => null) : Promise.resolve(null),
      Promise.all(slots.map((s) => s(ctx).catch(() => [] as QueueItem[]))),
    ]).then(([c, xs]) => {
      if (!alive) return;
      setCards(c);
      setExtra(xs.flat());
      setSettled(true);
    });
    return () => {
      alive = false;
    };
    // ctx is stable for a group and a member.
  }, [ctx.group.id, ctx.userId, tick, on]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => (data ? [...todayItems(data, cards), ...extra] : []), [data, cards, extra]);
  return { data, items, ready: Boolean(data) && settled, error, reload: () => setTick((t) => t + 1) };
}

