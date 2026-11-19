import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Comment, CommentKind, Group, Lecture, Section } from "../lib/api";
import type { At, Route } from "../lib/route";

/* ── The slot contract (spec §5.3; §12.2.3) ──
 * F1's shared screens (the shell, the library, the lecture, "יחד", "שלי")
 * render components and call hooks from one module per package,
 * src/study/features/<package>.tsx, with the fixed names and props below.
 * F seeds each module; its package then owns it and replaces the bodies,
 * never a signature (a needed change is a pull request to this file first).
 * Every `…Screen` export is lazy inside its own module (review F-8: the
 * shell, "יחד", the library and the lecture import the modules statically,
 * so a screen only splits off when the module itself loads it lazily);
 * chips, banner lines, cards and hooks stay static and small, and
 * tools/study-bundle.mjs fails a build whose entry chunk holds a screen.
 * Hooks are called unconditionally and check their own flag inside. */

export type Go = (r: Route, o?: { replace?: boolean }) => void;
/** A toast, with an optional action ("ביטול"). */
export type Say = (text: string, action?: { label: string; run: () => void }) => void;
export type Ctx = {
  group: Group & { me: string };
  session: Session;
  userId: string;
  go: Go;
  say: Say;
  /** A member's name by user id ("" when unknown). */
  nameOf: (userId: string) => string;
};
export type ScreenProps<V extends Route["v"]> = { route: Extract<Route, { v: V }>; ctx: Ctx };

/** What LectureView hands to the packages' hooks. */
export type LectureCtx = {
  ctx: Ctx;
  route: Extract<Route, { v: "lecture" }>;
  lecture: Lecture;
  sections: Section[];
  /** Patches one part in place, with no refetch (the server writer's progress). */
  patchSection: (row: Partial<Section> & { idx: number }) => void;
  refresh: () => Promise<void>;
  /** A figure's signed URL by its storage path. */
  figureUrl: (fig: string) => string | undefined;
  /** Scrolls the reader to the paragraph citing a slide and marks it for 2 s,
   *  with no new screen: a package's SlideSheet over the reader passes it as
   *  `onParagraph`, so "לפסקה בסיכום" never stacks a second reader in history. */
  toSlide: (slide: number) => void;
  /** This phone follows a member who reads aloud (§12.2.3: M's "לא ברור לי",
   *  J's "לנעוץ רגע" in the follower's bar). */
  following: boolean;
  /** This phone reads aloud to the group (M's reader card). */
  reading: boolean;
  /** The paragraph being read aloud: this phone's own while reading, else the
   *  reader's (the one followed, or the first who reads); null when nobody
   *  reads. */
  place: At | null;
  /** Opens the paragraph's sheet on a tab (N's chips open "תרגול", J's
   *  entries "אסוציאציה"), over the reader, with its own history entry. An
   *  F1Δ addition to §12.2.3, so no package reaches into the reader. */
  openParagraph: (spot: Spot, tab: SheetTab) => void;
  /** A paragraph's comments as the reader holds them, live: how many (with
   *  replies) and how many open questions; undefined for none. N's chip row
   *  shows them ("תגובה" · "3 תגובות") in place of the reader's own dot. An
   *  N addition to §12.2.3. */
  notes: (part: number, anchor: number) => { total: number; open: number } | undefined;
};

/** Drawn by F1's SummaryView, decided by K (`pending`: a proposal waits for
 *  its second approval, §12.3.K). */
export type BlockState = { edited?: number; flash?: boolean; editable?: boolean; pending?: boolean };

/** Generic hooks for a ready part's SummaryView (review FE-8). */
export type PartExtras = {
  /** Rendered after the block, never inside it (W: "מההקלטה" boxes; K: none yet). */
  blockExtras?: (anchor: number) => ReactNode;
  /** K: the edit chip, the 2-s flash, whether "תיקון" is offered. */
  blockState?: (anchor: number) => BlockState;
};

export type LectureExt = {
  /** After F's chips in the action row (W: "הקלטה"). */
  chips?: ReactNode;
  /** Under the title (W: the server note; A2: "להמשיך מהמקום שבו עצרת"). */
  top?: ReactNode;
  part?: (s: Section) => PartExtras;
  /** Sheets (W: RecordingSheet, ShareSheet). */
  overlay?: ReactNode;
  /** W: "שיתוף" opens ShareSheet instead of the link share. */
  share?: () => void;
  /** K: "לשאול" on a paragraph opens AskSheet over the reader (review UX-12). */
  ask?: (spot: Spot) => void;
  /** In the follower's one sticky bar while following, in the order W, K, A,
   *  M, N, V, J (M: "לא ברור לי" first, then J: "לנעוץ רגע"; no floating
   *  button). */
  followBar?: ReactNode;
  /** Above the reader's bar while reading aloud (M: the reader's card). */
  readerBar?: ReactNode;
};

/** The summary's writing state, rendered by LectureView. */
export type Writing = {
  /** Text streaming in on this device, by part. */
  live: Record<number, string>;
  running: boolean;
  error: string;
  needsWork: boolean;
  buttonText: "המשך כתיבה" | "התחלת הסיכום";
  continueWriting: () => void;
  /** A placeholder part's status line. */
  partLine: (s: Section) => string;
  /** Text to render as "נכתב עכשיו…" (this device or the server). */
  streaming: (s: Section) => string | undefined;
};

export type ParagraphAction = "comment" | "edit" | "mnemonic" | "ask";
export type Spot = { part: number; anchor: number; quote: string };

/** Exactly what LectureView passes to the thread today, minus onClose. */
export type ThreadProps = {
  quote: string;
  comments: Comment[];
  me: string;
  nameOf: (id: string) => string;
  /** The text being typed, kept by the page so closing the sheet never loses it. */
  draft: string;
  onDraft: (t: string) => void;
  onSend: (kind: CommentKind, body: string, parentId: string | null) => Promise<void>;
  onResolve: (c: Comment, resolved: boolean) => Promise<void>;
  onDelete: (c: Comment) => Promise<void>;
};
/** "mnemonic" keeps its id and renders J's ParagraphWall ("אסוציאציה");
 *  "practice" renders N's PracticeTab ("תרגול"). */
export type SheetTab = "comments" | "edit" | "mnemonic" | "practice";
export type ParagraphSheetProps = {
  lc: LectureCtx;
  spot: Spot;
  tab: SheetTab;
  thread: ThreadProps;
  onTab: (t: SheetTab) => void;
  onClose: () => void;
};

/** One "עדכון בסיכום" row: a correction to a paragraph the member studied
 *  after studying it (V's study_my_updates, §12.4.V), as T's queue hands it
 *  to V's UpdateCard. */
export type UpdateRow = {
  id: string;
  edit_id: string;
  lecture_id: string;
  lecture_title: string;
  part_idx: number;
  anchor: number;
  kind: string;
  before_text: string;
  after_text: string;
  author: string | null;
  approver: string | null;
  aloud: boolean;
  source_kind: string | null;
  source_slides: number[] | null;
  source_at: number | null;
  source_note: string | null;
  reason: string | null;
  reason_at: string | null;
  created_at: string;
};
