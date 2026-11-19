// The accessibility check every e2e screenshot step runs (spec §7, §8.3;
// review UX-3, UX-8), in the page itself:
//   - every visible button, link, chip and slide tag has text contrast of at
//     least 4.5:1 against what is behind it (3:1 for large text: 24 px, or
//     18.66 px bold), computed from the computed styles;
//   - every visible button and link (and tappable tag) has a hit area of at
//     least 44 × 44 px: its box together with an absolutely placed ::before
//     or ::after (the app's way of growing a small target). A link inside a
//     sentence is exempt, as WCAG 2.5.8 exempts inline targets;
//   - on an immersive screen, the primary action (a selector) sits wholly in
//     the bottom quarter of the viewport without scrolling;
//   - a screen's title, "לפסקה: <part>" and a bar's label are never cut
//     (they wrap); a bottom bar's buttons and a draft's actions keep their
//     words on one line;
//   - while a modal sheet is open, a tap at the centre of each of its controls
//     on screen lands on that control, and a tap on any control outside it
//     lands on the backdrop (nothing but the toast is drawn above a sheet).
// Usage: const report = await a11y(page, { primary: ".ph-foot .a-btn.primary" });
//        report.problems is [] when everything passes.

module.exports = async function a11y(page, o = {}) {
  return page.evaluate(({ primary }) => {
    const problems = [];
    const parse = (c) => {
      if (!c) return null;
      let m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(c);
      if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
      m = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/.exec(c);
      if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : Number(m[4])];
      return null;
    };
    const over = (top, bottom) => {
      const a = top[3];
      return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
    };
    // What is painted behind an element: its own background and its ancestors', blended down to the page.
    const behind = (el) => {
      const layers = [];
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c[3] > 0) layers.push(c);
        if (c && c[3] >= 1) break;
      }
      let color = parse(getComputedStyle(document.documentElement).backgroundColor) || [255, 255, 255, 1];
      if (color[3] < 1) color = over(color, [255, 255, 255, 1]);
      for (const l of layers.reverse()) color = over(l, color);
      return color;
    };
    const lum = ([r, g, b]) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      for (let n = el; n; n = n.parentElement) if (getComputedStyle(n).display === "none") return false;
      return r.bottom > 0 && r.top < innerHeight;
    };
    const name = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} "${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30)}"`;
    const inlineLink = (el) => {
      if (el.tagName !== "A") return false;
      const p = el.parentElement;
      if (!p || !/^(P|LI|SPAN|TD)$/.test(p.tagName)) return false;
      return [...p.childNodes].some((n) => n !== el && n.nodeType === 3 && n.textContent.trim().length > 0);
    };
    // The box a finger can hit: the element's, grown by an absolutely placed pseudo-element.
    const hitBox = (el) => {
      const r = el.getBoundingClientRect();
      let [l, t, rr, b] = [r.left, r.top, r.right, r.bottom];
      for (const ps of ["::before", "::after"]) {
        const s = getComputedStyle(el, ps);
        if (s.content === "none" || s.content === "normal" || s.position !== "absolute") continue;
        const px = (v) => (v.endsWith("px") ? Number(v.slice(0, -2)) : null);
        const [it, ir, ib, il] = [px(s.top), px(s.right), px(s.bottom), px(s.left)];
        if ([it, ir, ib, il].some((v) => v === null)) continue;
        l = Math.min(l, r.left + il);
        t = Math.min(t, r.top + it);
        rr = Math.max(rr, r.right - ir);
        b = Math.max(b, r.bottom - ib);
      }
      return { w: rr - l, h: b - t };
    };

    const targets = [...document.querySelectorAll("button, a[href], [role=button], [role=radio], [role=tab], summary, .a-chip, .a-tag, .src-link, .src-tag, input[type=checkbox]")].filter(visible);
    let checked = 0;
    for (const el of targets) {
      const s = getComputedStyle(el);
      const disabled = el.disabled === true || el.getAttribute("aria-disabled") === "true";
      const hasText = (el.innerText || "").trim().length > 0;
      if (hasText && !disabled) {
        checked += 1;
        const fg = parse(s.color);
        const bg = behind(el);
        if (fg) {
          const shown = fg[3] < 1 ? over(fg, bg) : fg;
          const size = parseFloat(s.fontSize);
          const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
          const need = large ? 3 : 4.5;
          const got = ratio(shown, bg);
          if (got < need) problems.push(`contrast ${got.toFixed(2)}:1 < ${need}:1 on ${name(el)}`);
        }
      }
      const interactive = el.matches("button, a[href], [role=button], [role=radio], [role=tab], summary, .src-link, input[type=checkbox]");
      if (interactive && !inlineLink(el)) {
        // A checkbox inside its label is hit through the whole label.
        const box = el.matches("input") && el.closest("label") ? hitBox(el.closest("label")) : hitBox(el);
        if (box.w < 43.5 || box.h < 43.5) problems.push(`hit area ${Math.round(box.w)}×${Math.round(box.h)} < 44×44 on ${name(el)}`);
      }
    }
    // A modal sheet: its controls can be hit where they show, and nothing
    // outside it can (a fixed bar drawn above the backdrop stays tappable).
    const modal = [...document.querySelectorAll('[aria-modal="true"]')].filter(visible).pop();
    if (modal) {
      // The centre of a control, unless a scrolling box it is in hides it.
      const centre = (el) => {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.overflowY === "visible" && s.overflowX === "visible") continue;
          const c = n.getBoundingClientRect();
          if (x < c.left || x > c.right || y < c.top || y > c.bottom) return null;
        }
        return { x, y };
      };
      for (const el of targets) {
        const c = centre(el);
        if (!c || el.closest(".a-toast")) continue;
        const hit = document.elementFromPoint(c.x, c.y);
        const reached = Boolean(hit && (hit === el || el.contains(hit)));
        if (modal.contains(el) && !reached) problems.push(`covered in the sheet: ${name(el)} is under ${hit ? name(hit) : "nothing"}`);
        if (!modal.contains(el) && reached) problems.push(`above the sheet's backdrop: ${name(el)} can be tapped while the sheet is open`);
      }
    }
    if (primary) {
      const el = document.querySelector(primary);
      if (!el) problems.push(`no primary action ${primary}`);
      else {
        const r = el.getBoundingClientRect();
        if (r.top < innerHeight * 0.75 || r.bottom > innerHeight) problems.push(`primary action ${name(el)} at ${Math.round(r.top)}-${Math.round(r.bottom)} is not in the bottom quarter of ${innerHeight}`);
      }
    }
    // Names are never cut (review LOOK-1, LOOK-2): a screen's title, "לפסקה: <part>"
    // and a bar's label wrap (a title and that label to two lines at most)
    // rather than lose letters; an ellipsis in a right-to-left line cuts an
    // English name from its start.
    for (const el of document.querySelectorAll(".ph-head > .t, .pq-label, .a-bars .r > span:first-child")) {
      if (!visible(el)) continue;
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) problems.push(`clipped text: ${name(el)}`);
    }
    // A bottom bar's buttons and a draft's actions keep their words on one line
    // (review LOOK-3); "לפסקה: <part>" may take two.
    const lines = (el) => {
      const tops = [];
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent.trim()) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        for (const rect of r.getClientRects()) if (rect.width > 0.5) tops.push(rect.top + rect.height / 2);
      }
      tops.sort((x, y) => x - y);
      const lh = parseFloat(getComputedStyle(el).fontSize) || 16;
      let n = tops.length ? 1 : 0;
      for (let i = 1; i < tops.length; i++) if (tops[i] - tops[i - 1] > lh * 0.6) n += 1;
      return n;
    };
    for (const el of document.querySelectorAll(".ph-foot > .a-btn:not(.pq-paragraph), .pb-actions > .a-btn")) {
      if (!visible(el)) continue;
      if (lines(el) > 1) problems.push(`a button's words wrap: ${name(el)}`);
    }
    const overflow = document.documentElement.scrollWidth > innerWidth + 1;
    if (overflow) problems.push(`horizontal overflow: ${document.documentElement.scrollWidth} > ${innerWidth}`);
    return { checked, problems };
  }, { primary: o.primary || null });
};

/** A screenshot step: the check in light and dark, at 390×844 and 360×640,
 *  with screenshots `<prefix>-<step>-<scheme>.png` at 390×844. Returns the
 *  problems, each labelled with where it was found. */
module.exports.snap = async function snap(page, out, name, o = {}) {
  const check = module.exports;
  const problems = [];
  const size = page.viewportSize() || { width: 390, height: 844 };
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(120);
      const r = await check(page, o);
      for (const p of r.problems) problems.push(`${name} ${scheme} ${vp.width}: ${p}`);
      if (vp.width === 390 && out) await page.screenshot({ path: require("path").join(out, `${name}-${scheme}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: o.scheme || "light" });
  await page.setViewportSize(size);
  return problems;
};
