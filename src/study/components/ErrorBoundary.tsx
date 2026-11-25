import { Component, type ErrorInfo, type ReactNode } from "react";
import { isChunkError, reloadOnce } from "../lib/staleChunk";

/* ── A screen that failed to load (docs/study/ux-p1.md, WP1) ──
 * Around the routed screen (StudyApp) and the guide's layer (GuideSlot). A
 * lazy screen whose code cannot be fetched, or a screen that throws, would
 * otherwise blank the whole app (React unmounts the tree). A chunk gone after
 * a deploy reloads the page once (lib/staleChunk.ts); offline, or once that
 * reload was spent, the screen says so with "לנסות שוב", which reloads once
 * the connection is back (a failed lazy import stays failed until then), and
 * the connection's return tries by itself. Another screen (a tab) clears it:
 * `reset` is the screen's key. */

export const SCREEN_FAILED = "המסך לא נטען. כדאי לבדוק את החיבור ולנסות שוב.";
export const STILL_OFFLINE = "עדיין אין חיבור. ננסה שוב כשהחיבור יחזור.";

type Props = {
  /** The screen's key: a new one clears the failure. */
  reset: string;
  /** What to show instead (the guide's layer shows nothing). */
  fallback?: "screen" | "none";
  children: ReactNode;
};
type State = { failed: boolean; key: string; offline: boolean };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, key: this.props.reset, offline: false };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.reset === state.key ? null : { failed: false, key: props.reset, offline: false };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // A chunk from before a deploy: the page reloads once, online.
    if (isChunkError(error) && reloadOnce()) return;
    console.warn("study: a screen failed", error, info.componentStack);
  }

  componentDidMount(): void {
    window.addEventListener("online", this.onOnline);
  }

  componentWillUnmount(): void {
    window.removeEventListener("online", this.onOnline);
  }

  private onOnline = () => {
    if (this.state.failed) location.reload();
  };

  private retry = () => {
    if (navigator.onLine === false) this.setState({ offline: true });
    else location.reload();
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback === "none") return null;
    return (
      <main className="gate screen-failed">
        <div className="a-card gate-card">
          <p role="alert">{SCREEN_FAILED}</p>
          {this.state.offline ? (
            <p className="a-small a-muted" role="status">
              {STILL_OFFLINE}
            </p>
          ) : null}
          <button type="button" className="a-btn primary" onClick={this.retry}>
            לנסות שוב
          </button>
        </div>
      </main>
    );
  }
}
