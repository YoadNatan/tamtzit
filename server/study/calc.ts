/* ── A safe calculator for numeric answers (design-exams D17, §8.3) ──
 *
 * The sheet solver (and, later, the similar-question writer) gives a numeric
 * item's answer with its working: named inputs and a formula, e.g.
 * {inputs: {dose: 500, vd: 40}, formula: "dose / vd"}. The server
 * recomputes the formula itself ($0) and keeps the model's number only when
 * the two agree within the item's tolerance; a mismatch lowers the
 * suggested answer's confidence to 1 (it then counts in no score).
 *
 * The grammar: numbers (12, 0.5, 1.2e-3), the inputs' names, + - * / ^,
 * parentheses, a unary minus, and ln, log10, exp, sqrt, abs, min, max.
 * Nothing else: no property access, no calls of anything but those seven,
 * at most CALC_MAX_TOKENS tokens. Pure; never evaluates JavaScript. */

export const CALC_MAX_TOKENS = 200;

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

const FUNCS: Record<string, { n: [number, number]; f: (...a: number[]) => number }> = {
  ln: { n: [1, 1], f: Math.log },
  log10: { n: [1, 1], f: Math.log10 },
  exp: { n: [1, 1], f: Math.exp },
  sqrt: { n: [1, 1], f: Math.sqrt },
  abs: { n: [1, 1], f: Math.abs },
  min: { n: [1, 8], f: Math.min },
  max: { n: [1, 8], f: Math.max },
};

/** The formula's tokens, or null when it has anything else. */
export function tokens(src: string): Tok[] | null {
  const out: Tok[] = [];
  const s = src.replace(/[×·]/g, "*").replace(/[−–]/g, "-").replace(/÷/g, "/");
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i))![0];
      out.push({ t: "id", v: id });
      i += id.length;
    } else if ("+-*/^(),".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      return null;
    }
    if (out.length > CALC_MAX_TOKENS) return null;
  }
  return out;
}

/** The formula's value with these inputs, or null: a token it does not
 *  know, an unknown name, a bad shape, or a result that is not a finite
 *  number (a division by zero, the log of a negative). */
export function evaluate(formula: string, inputs: Readonly<Record<string, number>> = {}): number | null {
  const ts = tokens(formula);
  if (!ts || !ts.length) return null;
  let k = 0;
  const peek = () => ts[k];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const fail = (): never => {
    throw new Error("calc");
  };
  // expr := term (('+'|'-') term)*; term := unary (('*'|'/') unary)*;
  // unary := '-' unary | power; power := atom ('^' unary)?  (right-associative)
  const expr = (): number => {
    let v = term();
    while (isOp("+") || isOp("-")) v = ts[k++].v === "+" ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = unary();
    while (isOp("*") || isOp("/")) v = ts[k++].v === "*" ? v * unary() : v / unary();
    return v;
  };
  const unary = (): number => {
    if (isOp("-")) {
      k++;
      return -unary();
    }
    if (isOp("+")) {
      k++;
      return unary();
    }
    return power();
  };
  const power = (): number => {
    const b = atom();
    if (isOp("^")) {
      k++;
      return b ** unary();
    }
    return b;
  };
  const atom = (): number => {
    const t = ts[k++];
    if (!t) return fail();
    if (t.t === "num") return t.v;
    if (t.t === "op" && t.v === "(") {
      const v = expr();
      if (!isOp(")")) fail();
      k++;
      return v;
    }
    if (t.t === "id") {
      if (isOp("(")) {
        const fn = Object.hasOwn(FUNCS, t.v) ? FUNCS[t.v] : null;
        if (!fn) return fail();
        k++;
        const args: number[] = [];
        if (!isOp(")")) {
          args.push(expr());
          while (isOp(",")) {
            k++;
            args.push(expr());
          }
        }
        if (!isOp(")")) fail();
        k++;
        if (args.length < fn.n[0] || args.length > fn.n[1]) fail();
        return fn.f(...args);
      }
      if (Object.hasOwn(inputs, t.v) && typeof inputs[t.v] === "number") return inputs[t.v];
      return fail();
    }
    return fail();
  };
  try {
    const v = expr();
    if (k !== ts.length) return null;
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Whether `got` is `want` within `tolPct` percent of it (an answer of 0:
 *  within 1e-12), as section O 2's study_answer_value checks a member's
 *  answer. */
export function within(got: number, want: number, tolPct = 1): boolean {
  if (!Number.isFinite(got) || !Number.isFinite(want)) return false;
  return Math.abs(got - want) <= Math.max((Math.abs(want) * Math.max(0, tolPct)) / 100, 1e-12);
}

/** A numeric answer checked against its working: the model's number, and
 *  the formula's own value with the inputs. ok when they agree within the
 *  tolerance (at least 0.5%, so rounding a printed answer is not a
 *  mismatch); value is the recomputed number (null when the working cannot
 *  be computed). */
export function recompute(
  answer: number,
  calc: { inputs: ReadonlyArray<{ name: string; value: number }> | Readonly<Record<string, number>>; formula: string },
  tolPct = 1,
): { ok: boolean; value: number | null } {
  const inputs: Record<string, number> = {};
  if (Array.isArray(calc.inputs)) {
    for (const x of calc.inputs as ReadonlyArray<{ name: string; value: number }>) {
      if (x && typeof x.name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(x.name) && typeof x.value === "number") inputs[x.name] = x.value;
    }
  } else {
    for (const [n, v] of Object.entries(calc.inputs)) if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && typeof v === "number") inputs[n] = v;
  }
  const value = evaluate(calc.formula ?? "", inputs);
  return { ok: value !== null && within(answer, value, Math.max(tolPct, 0.5)), value };
}
