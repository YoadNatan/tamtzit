import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ScreenProps } from "../features/types";
import { flags } from "../lib/flags";
import { guideMark } from "../lib/guideMark";
import { detect, isIos, probe } from "../lib/install";
import { DEFAULT_PREFS, devices as listDevices, readPrefs, removeDevice, savePrefs, sendTest, type Device, type Prefs } from "../lib/notices";
import { available, deviceOf, enable, isComputer, readState, registerWorker, removeThisDevice, thisEndpoint, type PushState } from "../lib/notify";
import { dayMonth, deniedWords, deviceName, enabledToast, halfHours, inApp, iosOld, NT, quietRow, since } from "../lib/notifyText";
import { EscapeButtons } from "./InstallParts";
import { BackLink, Head, Loading, RouteLink } from "./Shell";
import "../styles/notify.css";

/* ── "הגדרות התראות" (?v=notify&x=set; section R, the design's §5.2-5.3) ──
 * Shown only when pushes are offered to this member (health says they work,
 * and the switch or the pilot lets this member); otherwise the address opens
 * the inbox. On top, this device: on (with a test push), "להפעיל" (the
 * browser's question comes only from that tap), or why not here (an iPhone
 * outside the home-screen app, another app's browser, blocked, an old iOS,
 * no pushes in this browser, a failed try, offline). Below, what is sent
 * (two categories and the daily reminder), when not (the night, Shabbat),
 * and, with two devices or more, the devices. A switch saves at once and
 * goes back when the save fails. The words: lib/notifyText.ts. */

const TEST_REST_MS = 20_000;

/** A save's failure, in words. */
const failed = () => (typeof navigator !== "undefined" && navigator.onLine === false ? NT.device.offline : NT.errSave);

export default function NotifyScreen({ ctx }: ScreenProps<"notify">) {
  const [ready, setReady] = useState(false);
  const [key, setKey] = useState<{ key: string; keyId: string } | null>(null);
  const [state, setState] = useState<PushState>("ask");
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [devs, setDevs] = useState<Device[]>([]);
  const [hours, setHours] = useState(false);
  const [testUntil, setTestUntil] = useState(0);
  const status = useRef<HTMLParagraphElement>(null);
  const fromSel = useRef<HTMLSelectElement>(null);
  // The app's go(), read when needed: the checks below run once per group, not on every new ctx.
  const go = useRef(ctx.go);
  go.current = ctx.go;
  const env = detect(probe());

  const loadDevices = useCallback(async () => {
    const mine = await thisEndpoint();
    setDevs(await listDevices(mine).catch(() => []));
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const a = await available(true);
      if (!alive) return;
      if (!a.ok || !a.key || !a.keyId) {
        go.current({ v: "notify" }, { replace: true });
        return;
      }
      setKey({ key: a.key, keyId: a.keyId });
      const s = await readState(true);
      if (!alive) return;
      setState(s);
      setReady(true);
      // The worker is ready before the tap, so the tap goes straight to the browser's question.
      if (s === "ask" || s === "broken") void registerWorker().catch(() => undefined);
      readPrefs()
        .then((p) => alive && setPrefs(p))
        .catch(() => alive && setPrefs(DEFAULT_PREFS));
      void loadDevices();
    })();
    return () => {
      alive = false;
    };
  }, [ctx.group.id, loadDevices]);

  useEffect(() => {
    if (!testUntil) return;
    const t = setTimeout(() => setTestUntil(0), Math.max(0, testUntil - Date.now()));
    return () => clearTimeout(t);
  }, [testUntil]);

  /** "להפעיל": the browser's question is the first thing the tap does (enable()). */
  const turnOn = () => {
    if (!key) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setState("offline");
      return;
    }
    // The browser's question is the tap's first call (Safari asks only inside the tap).
    const asked = enable(key.key, key.keyId, ctx.userId);
    setBusy(true);
    void asked.then(async (s) => {
      setState(s);
      setBusy(false);
      if (s === "on") {
        guideMark("notify"); // the guide's step "לקבל התראות" (nothing without VITE_STUDY_GUIDE)
        ctx.say(enabledToast(prefs ?? DEFAULT_PREFS));
        await loadDevices();
      }
      setTimeout(() => status.current?.focus(), 0);
    });
  };

  const test = async () => {
    setTestUntil(Date.now() + TEST_REST_MS);
    try {
      await sendTest();
      const p = probe();
      ctx.say(isComputer(detect(p), p.ua, navigator.maxTouchPoints ?? 0) ? `${NT.device.testToast} ${NT.device.testDesktop}` : NT.device.testToast);
    } catch (e) {
      ctx.say(e instanceof Error && e.message === "too many" ? NT.device.testMany : failed());
    }
  };

  /** A switch or a select: shown at once, saved, and back as it was when the save fails. */
  const save = async (patch: Partial<Prefs>) => {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, ...patch });
    try {
      setPrefs(await savePrefs(patch));
    } catch {
      setPrefs(before);
      ctx.say(failed());
    }
  };

  const remove = async (d: Device) => {
    try {
      if (d.this) {
        await removeThisDevice();
        setState(await readState(true));
      } else await removeDevice(d.id);
      await loadDevices();
    } catch {
      ctx.say(failed());
    }
  };

  const back = <BackLink go={ctx.go} fallback={{ v: "me" }} />;
  if (!ready) {
    return (
      <main className="notify-set">
        <Head back={back} title={NT.set.title} />
        <Loading />
      </main>
    );
  }

  const working = state === "on" || devs.length > 0;
  const p = prefs ?? DEFAULT_PREFS;
  const ua = probe().ua;
  const dev = deviceOf(ua, typeof navigator !== "undefined" ? navigator.maxTouchPoints ?? 0 : 0);
  // An iPad's home-screen app says "Macintosh": deviceOf tells it by touch.
  const ios = isIos(env) || dev.device === "iphone" || dev.device === "ipad";
  let card: ReactNode;
  switch (state) {
    case "on":
      card = (
        <>
          <p className="ntf-status ok" ref={status} tabIndex={-1} role="status">
            {NT.device.on}
          </p>
          <button type="button" className="a-btn ntf-test" disabled={testUntil > 0} aria-describedby={testUntil > 0 ? "ntf-test-wait" : undefined} onClick={() => void test()}>
            {NT.device.test}
          </button>
          {testUntil > 0 ? (
            <p id="ntf-test-wait" className="a-small a-muted ntf-test-wait">
              {NT.device.testWait}
            </p>
          ) : null}
        </>
      );
      break;
    case "ios-install":
      card = (
        <>
          <p className="ntf-status" ref={status} tabIndex={-1}>
            {dev.device === "ipad" ? NT.device.iosInstallIpad : NT.device.iosInstall}
          </p>
          {flags.install ? (
            <RouteLink to={{ v: "install" }} go={ctx.go} className="a-btn primary ntf-install">
              {NT.device.iosInstallBtn}
            </RouteLink>
          ) : null}
          <p className="a-small a-muted">{NT.device.iosInstallHas}</p>
        </>
      );
      break;
    case "inapp":
      card = (
        <>
          <p className="ntf-status" ref={status} tabIndex={-1}>
            {inApp(env.kind === "ios-inapp" || env.kind === "android-inapp" ? env.app : "other", ios)}
          </p>
          <EscapeButtons env={env} />
        </>
      );
      break;
    case "ios-old":
      card = (
        <p className="ntf-status" ref={status} tabIndex={-1}>
          {iosOld()}
        </p>
      );
      break;
    case "unsupported":
      card = (
        <p className="ntf-status" ref={status} tabIndex={-1}>
          {NT.device.unsupported}
        </p>
      );
      break;
    case "denied":
      card = (
        <>
          <p className="ntf-status warn" ref={status} tabIndex={-1} role="status">
            {NT.device.denied}
          </p>
          <p className="a-small">{deniedWords({ device: dev.device, browser: dev.browser, app: env.kind === "standalone" })}</p>
        </>
      );
      break;
    case "broken":
      card = (
        <>
          <p className="ntf-status warn" ref={status} tabIndex={-1} role="status">
            {NT.device.broken}
          </p>
          <button type="button" className="a-btn primary" disabled={busy} onClick={turnOn}>
            {busy ? NT.device.enabling : NT.device.retry}
          </button>
        </>
      );
      break;
    case "offline":
      card = (
        <>
          <p className="ntf-status warn" ref={status} tabIndex={-1} role="status">
            {NT.device.offline}
          </p>
          <button type="button" className="a-btn" disabled={busy} onClick={turnOn}>
            {NT.device.retry}
          </button>
        </>
      );
      break;
    default:
      card = (
        <>
          <p className="ntf-status" ref={status} tabIndex={-1}>
            {NT.device.ask}
          </p>
          <button type="button" className="a-btn primary ntf-enable" disabled={busy} onClick={turnOn}>
            {busy ? NT.device.enabling : NT.device.enable}
          </button>
        </>
      );
  }

  const off = !working || !prefs;
  // Plain functions, not components: a row keeps its focus when its switch saves.
  const toggle = (k: "live" | "mine" | "digest" | "quiet" | "shabbat", title: ReactNode, desc: string) => (
    <label className="a-li setting-row setting-check ntf-switch">
      <span>
        <b>{title}</b>
        <span className="m">{desc}</span>
      </span>
      <input type="checkbox" role="switch" name={k} checked={p[k]} disabled={off} onChange={(e) => void save({ [k]: e.target.checked })} />
    </label>
  );
  const select = (k: "digest_at" | "quiet_from" | "quiet_to", label: string, options: string[]) => (
    <select ref={k === "quiet_from" ? fromSel : undefined} className="a-input ntf-time" name={k} aria-label={label} value={p[k]} disabled={off} dir="ltr" onChange={(e) => void save({ [k]: e.target.value })}>
      {options.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );

  return (
    <main className="notify-set">
      <Head back={back} title={NT.set.title} />

      <section className="a-card flat a-stack ntf-device" aria-labelledby="ntf-device-h">
        <h2 id="ntf-device-h" className="ntf-h">
          {NT.device.h}
        </h2>
        {card}
      </section>

      <section className="a-stack" aria-labelledby="ntf-cats-h">
        <div className="a-sec">
          <h2 id="ntf-cats-h">{NT.cats.h}</h2>
        </div>
        <p className="a-small a-muted ntf-applies">{working ? NT.cats.all : NT.cats.disabled}</p>
        <div className="a-list settings">
          {toggle("live", NT.cats.live.title, NT.cats.live.desc)}
          {toggle("mine", NT.cats.mine.title, NT.cats.mine.desc)}
          {toggle("digest", NT.cats.digest.title, NT.cats.digest.desc)}
          {p.digest ? (
            <div className="a-li setting-row ntf-at">
              <span>{NT.cats.digestAt}</span>
              {select("digest_at", `${NT.cats.digest.title}: ${NT.cats.digestAt}`, halfHours("06:00", "22:00"))}
            </div>
          ) : null}
        </div>
        <p className="a-small a-muted">{NT.cats.security}</p>
      </section>

      <section className="a-stack" aria-labelledby="ntf-quiet-h">
        <div className="a-sec">
          <h2 id="ntf-quiet-h">{NT.quiet.h}</h2>
        </div>
        <div className="a-list settings">
          {toggle(
            "quiet",
            // In words, as the hours below: "(מ-23:00 עד 07:30)", each time isolated.
            <>
              {NT.quiet.night} ({NT.quiet.from}
              <bdi dir="ltr">{p.quiet_from}</bdi> {NT.quiet.to} <bdi dir="ltr">{p.quiet_to}</bdi>)
            </>,
            NT.quiet.note,
          )}
          {hours ? (
            <div className="a-li setting-row ntf-hours">
              <span>{NT.quiet.from}</span>
              {select("quiet_from", NT.quiet.fromAria, halfHours())}
              <span>{NT.quiet.to}</span>
              {select("quiet_to", NT.quiet.toAria, halfHours())}
            </div>
          ) : (
            <button
              type="button"
              className="a-li row-link ntf-change"
              aria-label={`${NT.quiet.change}: ${quietRow(p.quiet_from, p.quiet_to)}`}
              disabled={off}
              onClick={() => {
                setHours(true);
                // The button goes: the focus moves to the first of the two times.
                setTimeout(() => fromSel.current?.focus(), 0);
              }}
            >
              <span>{NT.quiet.change}</span>
              <span className="ntf-chev" aria-hidden="true">
                ‹
              </span>
            </button>
          )}
          {toggle("shabbat", NT.quiet.shabbat, NT.quiet.shabbatNote)}
        </div>
      </section>

      {devs.length >= 2 ? (
        <section className="a-stack" aria-labelledby="ntf-devs-h">
          <div className="a-sec">
            <h2 id="ntf-devs-h">{NT.devices.h}</h2>
          </div>
          <ul className="a-list ntf-devices">
            {devs.map((d) => (
              <li key={d.id} className="a-li ntf-dev">
                <span>
                  {deviceName(d.device, d.browser)}
                  {d.this ? ` · ${NT.devices.this}` : ""} · {since(dayMonth(Date.parse(d.created_at)))}
                </span>
                <button type="button" className="a-btn small ghost" aria-label={`${NT.devices.removeAria}${deviceName(d.device, d.browser)}${d.this ? ` (${NT.devices.this})` : ""}`} onClick={() => void remove(d)}>
                  {NT.devices.remove}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
