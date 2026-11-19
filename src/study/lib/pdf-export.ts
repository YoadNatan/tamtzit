import { PRINT_CSS } from "../../../shared/study/print-css";
import { postStudy } from "./api";

/* ── Getting a summary out of the app: a PDF file, or the device's printing ──
 * requestPdf sends the print layout's HTML to /api/study/pdf (the server
 * renders it with page numbers; package W, W3) and gets the file back.
 * deliverFile hands a file to the system's share sheet when the browser can
 * share files (it must follow a fresh tap), else saves it. printHere prints
 * the layout on this device with the same stylesheet. */

/** The server's PDF of a print layout: the file, named after the lecture, and its page count. */
export async function requestPdf(lectureId: string, doc: HTMLElement): Promise<{ file: File; pages: number }> {
  const res = await postStudy("/api/study/pdf", { lectureId, html: doc.outerHTML });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      /* not json */
    }
    throw new Error(code);
  }
  const blob = await res.blob();
  let name = "";
  try {
    name = decodeURIComponent(res.headers.get("x-file-name") ?? "");
  } catch {
    /* a name that is not URI-encoded: the default */
  }
  return { file: new File([blob], fileName(name), { type: "application/pdf" }), pages: Number(res.headers.get("x-pages") ?? 0) || 0 };
}

/** A name every system accepts for a file: a lecture's title may hold a
 *  colon or a slash, which a browser refuses in a download's name (it then
 *  saves the file as "download"). */
export function fileName(name: string): string {
  const base = name
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${base || "summary"}.pdf`;
}

/** A downloaded file's name. Chromium saves a file whose suggested name is
 *  Hebrew as "download", with no extension (seen in its headless build here;
 *  research-pdf §3.7 left Hebrew names unverified), so a name that is not
 *  plain ASCII becomes design-platform §5's fallback, tamtzit-<date>.pdf. The
 *  share sheet keeps the lecture's own name. */
export function downloadName(name: string, now = new Date()): string {
  if (/^[\x20-\x7e]+$/.test(name)) return name;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `tamtzit-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.pdf`;
}

/** Whether this browser can hand a file to the share sheet. */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** "שליחה" shares the file (the system's sheet: WhatsApp, Files…); "שמירה",
 *  or a browser that cannot share files, downloads it. */
export async function deliverFile(file: File, how: "share" | "save" = "share"): Promise<"shared" | "saved" | "cancelled"> {
  if (how === "share" && canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = downloadName(file.name);
  document.body.appendChild(a);
  a.click();
  // Removing the link in the same tick can lose its file name, so wait.
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 10_000);
  return "saved";
}

const STYLE_ID = "study-print-css";

/** The print stylesheet, while a print layout is on the page. */
export function addPrintCss(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = PRINT_CSS;
  document.head.appendChild(style);
}

export function removePrintCss(): void {
  document.getElementById(STYLE_ID)?.remove();
}

/** Prints the layout here, once its fonts and pictures have loaded. */
export async function printHere(doc: HTMLElement): Promise<void> {
  addPrintCss();
  try {
    await document.fonts?.ready;
  } catch {
    /* print anyway */
  }
  await Promise.all(
    [...doc.querySelectorAll("img")].map((img) =>
      img.complete
        ? null
        : new Promise<void>((ok) => {
            img.addEventListener("load", () => ok(), { once: true });
            img.addEventListener("error", () => ok(), { once: true });
            setTimeout(ok, 8_000);
          }),
    ),
  );
  window.print();
}
