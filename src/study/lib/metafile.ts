/* ── Text inside Windows metafiles (WMF / EMF) ──
 *
 * Older decks embed drawings as OLE objects (ChemDraw schemes, Word drawings,
 * equation editors) whose only picture is a WMF or EMF preview. Browsers cannot
 * display those, so the drawing's labels would be lost: in the antiparasitics
 * deck, slide 25's overlay (O2 → O2⁻ → "plasmodial derived SOD, Catalase" →
 * H2O) existed only there.
 *
 * This reads the text records, places each piece by its position and font size
 * (smaller text above or below the line becomes a superscript or subscript),
 * and returns the labels line by line. It does not draw anything; the result is
 * best-effort text for the model, marked as coming from a drawing.
 */

type Piece = { x: number; y: number; h: number; text: string };

const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋" };
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻" };

// The Symbol font draws Greek letters and math signs at Latin code points.
const SYMBOL_LETTERS = "αβχδεφγηιϕκλμνοπθρστυϖωξψζ";
const SYMBOL_CAPITALS = "ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ";
const SYMBOL_SIGNS: Record<number, string> = {
  0x2d: "−", 0xa3: "≤", 0xa5: "∞", 0xab: "↔", 0xac: "←", 0xad: "↑", 0xae: "→", 0xaf: "↓",
  0xb0: "°", 0xb1: "±", 0xb3: "≥", 0xb4: "×", 0xb7: "•", 0xb8: "÷", 0xb9: "≠", 0xbb: "≈", 0xd7: "⋅",
};

function symbolChar(code: number): string {
  if (code >= 0xf000) code -= 0xf000; // EMF writes Symbol glyphs in the private-use area
  if (code >= 0x61 && code <= 0x7a) return SYMBOL_LETTERS[code - 0x61];
  if (code >= 0x41 && code <= 0x5a) return SYMBOL_CAPITALS[code - 0x41];
  return SYMBOL_SIGNS[code] ?? (code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : "");
}

type Font = { h: number; kind: "text" | "symbol" | "skip"; encoding: string };

function fontKind(face: string, charset: number): Font["kind"] {
  const f = face.toLowerCase();
  if (/wingding|webding|mt extra|marlett/.test(f)) return "skip";
  if (charset === 2 || f === "symbol") return "symbol";
  return "text";
}

function encodingFor(charset: number): string {
  if (charset === 177) return "windows-1255"; // Hebrew
  if (charset === 161) return "windows-1253"; // Greek
  if (charset === 204) return "windows-1251"; // Cyrillic
  return "windows-1252";
}

function decodeBytes(bytes: Uint8Array, font: Font): string {
  if (font.kind === "skip") return "";
  if (font.kind === "symbol") return [...bytes].map(symbolChar).join("");
  try {
    return new TextDecoder(font.encoding).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const DEFAULT_FONT: Font = { h: 12, kind: "text", encoding: "windows-1252" };

/** WMF: 16-bit records. Objects (fonts, pens, brushes...) take the lowest free
 *  slot of the object table, and SELECTOBJECT picks one by slot. */
function readWmf(view: DataView): Piece[] {
  let off = view.getUint32(0, true) === 0x9ac6cdd7 ? 22 : 0;
  off += view.getUint16(off + 2, true) * 2; // header size in words
  const table: Array<Font | "other" | undefined> = [];
  const add = (o: Font | "other") => {
    let i = table.indexOf(undefined);
    if (i < 0) i = table.length;
    table[i] = o;
  };
  let font = DEFAULT_FONT;
  let align = 0;
  let cx = 0;
  let cy = 0;
  let ySign = 1;
  const pieces: Piece[] = [];
  const bytesAt = (p: number, n: number) => new Uint8Array(view.buffer, view.byteOffset + p, Math.max(0, Math.min(n, view.byteLength - p)));
  while (off + 6 <= view.byteLength) {
    const words = view.getUint32(off, true);
    const fn = view.getUint16(off + 4, true);
    if (words < 3 || off + words * 2 > view.byteLength) break;
    const p = off + 6;
    switch (fn) {
      case 0x02fb: {
        // CREATEFONTINDIRECT: height, width, escapement, orientation, weight, italic, underline, strikeout, charset ... face
        const h = Math.abs(view.getInt16(p, true)) || 12;
        const charset = view.getUint8(p + 13);
        const face = new TextDecoder("latin1").decode(bytesAt(p + 18, 32)).split("\0")[0];
        add({ h, kind: fontKind(face, charset), encoding: encodingFor(charset) });
        break;
      }
      case 0x02fa: // CREATEPENINDIRECT
      case 0x02fc: // CREATEBRUSHINDIRECT
      case 0x00f7: // CREATEPALETTE
      case 0x01f9: // CREATEPATTERNBRUSH
      case 0x0142: // DIBCREATEPATTERNBRUSH
      case 0x06ff: // CREATEREGION
        add("other");
        break;
      case 0x012d: {
        const o = table[view.getUint16(p, true)];
        if (o && o !== "other") font = o;
        break;
      }
      case 0x01f0:
        table[view.getUint16(p, true)] = undefined;
        break;
      case 0x020c: // SETWINDOWEXT: y, x; a negative y extent flips the axis
        ySign = view.getInt16(p, true) < 0 ? -1 : 1;
        break;
      case 0x012e:
        align = view.getUint16(p, true);
        break;
      case 0x0214:
        cy = view.getInt16(p, true);
        cx = view.getInt16(p + 2, true);
        break;
      case 0x0521: {
        // TEXTOUT: length, string (padded to a word), y, x
        const n = view.getInt16(p, true);
        const q = p + 2 + n + (n & 1);
        const text = decodeBytes(bytesAt(p + 2, n), font);
        const y = align & 1 ? cy : view.getInt16(q, true);
        const x = align & 1 ? cx : view.getInt16(q + 2, true);
        pieces.push({ x, y, h: font.h, text });
        if (align & 1) cx += Math.round(text.length * font.h * 0.5);
        break;
      }
      case 0x0a32: {
        // EXTTEXTOUT: y, x, length, options, [clip rectangle], string
        const y0 = view.getInt16(p, true);
        const x0 = view.getInt16(p + 2, true);
        const n = view.getInt16(p + 4, true);
        const opts = view.getUint16(p + 6, true);
        const s = p + 8 + (opts & 0x0006 ? 8 : 0);
        const text = decodeBytes(bytesAt(s, n), font);
        pieces.push({ x: align & 1 ? cx : x0, y: align & 1 ? cy : y0, h: font.h, text });
        if (align & 1) cx += Math.round(text.length * font.h * 0.5);
        break;
      }
    }
    if (fn === 0) break;
    off += words * 2;
  }
  return ySign < 0 ? pieces.map((q) => ({ ...q, y: -q.y })) : pieces;
}

/** EMF: 32-bit records; objects are numbered by the file itself. */
function readEmf(view: DataView): Piece[] {
  const fonts = new Map<number, Font>();
  let font = DEFAULT_FONT;
  const pieces: Piece[] = [];
  let off = 0;
  while (off + 8 <= view.byteLength) {
    const type = view.getUint32(off, true);
    const size = view.getUint32(off + 4, true);
    if (size < 8 || off + size > view.byteLength) break;
    if (type === 0x52 && size >= 8 + 4 + 28 + 64) {
      // EXTCREATEFONTINDIRECTW: ihFont, LOGFONTW
      const id = view.getUint32(off + 8, true);
      const lf = off + 12;
      const h = Math.abs(view.getInt32(lf, true)) || 12;
      const charset = view.getUint8(lf + 23);
      let face = "";
      for (let i = 0; i < 32; i++) {
        const c = view.getUint16(lf + 28 + i * 2, true);
        if (!c) break;
        face += String.fromCharCode(c);
      }
      fonts.set(id, { h, kind: fontKind(face, charset), encoding: encodingFor(charset) });
    } else if (type === 0x25) {
      const f = fonts.get(view.getUint32(off + 8, true));
      if (f) font = f;
    } else if (type === 0x28) {
      fonts.delete(view.getUint32(off + 8, true));
    } else if ((type === 0x54 || type === 0x53) && size >= 76) {
      // EXTTEXTOUTW / EXTTEXTOUTA: bounds, graphics mode, scales, then EMRTEXT
      const t = off + 36;
      const x = view.getInt32(t, true);
      const y = view.getInt32(t + 4, true);
      const n = view.getUint32(t + 8, true);
      const at = off + view.getUint32(t + 12, true);
      let text = "";
      if (type === 0x54) {
        for (let i = 0; i < n && at + i * 2 + 2 <= off + size; i++) {
          const c = view.getUint16(at + i * 2, true);
          // Wingdings and the like: pictograms, not text. Symbol glyphs may sit in the private-use area.
          if (font.kind === "skip") continue;
          text += font.kind === "symbol" || (c >= 0xf020 && c <= 0xf0ff) ? symbolChar(c) : String.fromCharCode(c);
        }
      } else {
        text = decodeBytes(new Uint8Array(view.buffer, view.byteOffset + at, Math.max(0, Math.min(n, off + size - at))), font);
      }
      pieces.push({ x, y, h: font.h, text });
    }
    if (type === 0x0e) break; // EOF
    off += size;
  }
  return pieces;
}

/** Group pieces into lines by baseline, order them left to right, and turn
 *  small raised or lowered digits and signs into superscripts or subscripts. */
function layout(pieces: Piece[]): string[] {
  const items = pieces.filter((p) => p.text.length);
  if (!items.length) return [];
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Piece[][] = [];
  for (const it of items) {
    const line = lines[lines.length - 1];
    const top = line ? Math.max(...line.map((p) => p.h)) : 0;
    if (line && it.y - line[0].y <= 0.75 * Math.max(top, it.h)) line.push(it);
    else lines.push([it]);
  }
  const out: string[] = [];
  for (const line of lines) {
    const main = Math.max(...line.map((p) => p.h));
    const base = line.filter((p) => p.h >= 0.85 * main).map((p) => p.y);
    const baseline = base.length ? base.sort((a, b) => a - b)[Math.floor(base.length / 2)] : line[0].y;
    line.sort((a, b) => a.x - b.x);
    let s = "";
    let end = -Infinity;
    for (const p of line) {
      let t = p.text;
      if (p.h < 0.85 * main && /^[0-9+-]+$/.test(t.trim())) {
        const map = p.y > baseline + 0.1 * main ? SUB : p.y < baseline - 0.1 * main ? SUP : null;
        if (map) t = [...t.trim()].map((c) => map[c] ?? c).join("");
      }
      if (s && p.x - end > 0.6 * main && !s.endsWith(" ") && !t.startsWith(" ")) s += " ";
      s += t;
      end = Math.max(end, p.x + t.length * p.h * 0.5);
    }
    const clean = s.replace(/\s+/g, " ").trim();
    if (clean) out.push(clean);
  }
  return out;
}

/** The text labels inside a WMF or EMF picture, one string per line ([] if none). */
export function metafileText(bytes: Uint8Array): string[] {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 40) return [];
    const isEmf = view.getUint32(0, true) === 1 && view.getUint32(40, true) === 0x464d4520; // " EMF"
    return layout(isEmf ? readEmf(view) : readWmf(view));
  } catch {
    return [];
  }
}

/** True when a drawing's text says something: at least one word of three or
 *  more letters. A chemical structure only carries atom labels (O, NH, Sb). */
export function hasWords(lines: string[]): boolean {
  return lines.some((l) => /\p{L}{3,}/u.test(l));
}
