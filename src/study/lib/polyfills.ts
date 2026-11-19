/* ── What pdf.js needs from the browser, for phones that lack it ──
 *
 * pdf.js 6 calls Map.prototype.getOrInsertComputed, Math.sumPrecise,
 * Promise.try, Promise.withResolvers, URL.parse and Uint8Array's base64
 * methods on the page itself, and reads a page's text with `for await` over
 * a ReadableStream, which Safari cannot iterate (on Yoad's iPhone: "text 1:
 * TypeError: undefined is not a function"). iPhone browsers (every iOS browser is Safari's
 * engine) do not all have them yet, so reading or drawing a PDF failed there
 * ("לא הצלחתי לקרוא את הקובץ"). Each is defined here only when missing, as a
 * plain property like the browser's own, before pdf.js loads (lib/pdf.ts).
 * The worker loads pdf.js's legacy build, which carries its own. */

type Fn = (...args: never[]) => unknown;

function define(target: object, name: string, value: Fn): void {
  if (name in target) return;
  Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
}

let done = false;

export function installPdfPolyfills(): void {
  if (done) return;
  done = true;

  for (const C of [Map, WeakMap] as Array<{ prototype: object }>) {
    define(C.prototype, "getOrInsert", function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
      if (!this.has(key)) this.set(key, value);
      return this.get(key);
    } as Fn);
    define(C.prototype, "getOrInsertComputed", function (this: Map<unknown, unknown>, key: unknown, make: (k: unknown) => unknown) {
      if (typeof make !== "function") throw new TypeError("callback is not a function");
      if (!this.has(key)) this.set(key, make(key));
      return this.get(key);
    } as Fn);
  }

  // Neumaier's compensated sum: close to the exact sum pdf.js asks for.
  define(Math, "sumPrecise", function (items: Iterable<number>) {
    let sum = 0;
    let c = 0;
    let any = false;
    for (const x of items) {
      if (typeof x !== "number") throw new TypeError("sumPrecise: not a number");
      any = true;
      const t = sum + x;
      c += Math.abs(sum) >= Math.abs(x) ? sum - t + x : x - t + sum;
      sum = t;
    }
    return any ? sum + c : -0;
  } as Fn);

  define(Promise, "withResolvers", function <T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (e?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  } as Fn);

  define(Promise, "try", function (fn: (...a: unknown[]) => unknown, ...args: unknown[]) {
    return new Promise((resolve) => resolve(fn(...args)));
  } as Fn);

  define(URL, "parse", function (url: string, base?: string) {
    try {
      return new URL(url, base);
    } catch {
      return null;
    }
  } as Fn);

  // `for await (const x of stream)`: a reader, released (or the stream
  // cancelled) when the loop ends early, as the Streams standard says.
  if (typeof ReadableStream !== "undefined") {
    const proto = ReadableStream.prototype as unknown as Record<PropertyKey, unknown>;
    const values = function (this: ReadableStream<unknown>, options?: { preventCancel?: boolean }) {
      const reader = this.getReader();
      const preventCancel = !!options?.preventCancel;
      const iterator: AsyncIterableIterator<unknown> & { return(value?: unknown): Promise<IteratorResult<unknown>> } = {
        async next() {
          try {
            const r = await reader.read();
            if (r.done) reader.releaseLock();
            return r.done ? { done: true, value: undefined } : { done: false, value: r.value };
          } catch (e) {
            reader.releaseLock();
            throw e;
          }
        },
        async return(value?: unknown) {
          if (!preventCancel) {
            const cancelled = reader.cancel(value);
            reader.releaseLock();
            await cancelled;
          } else reader.releaseLock();
          return { done: true, value };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
      return iterator;
    };
    define(proto, "values", values as Fn);
    if (!(Symbol.asyncIterator in proto)) {
      Object.defineProperty(proto, Symbol.asyncIterator, { value: proto.values, writable: true, configurable: true, enumerable: false });
    }
  }

  define(Uint8Array.prototype, "toBase64", function (this: Uint8Array) {
    let s = "";
    for (let i = 0; i < this.length; i += 0x8000) s += String.fromCharCode(...this.subarray(i, i + 0x8000));
    return btoa(s);
  } as Fn);
  define(Uint8Array.prototype, "toHex", function (this: Uint8Array) {
    let s = "";
    for (const b of this) s += b.toString(16).padStart(2, "0");
    return s;
  } as Fn);
  define(Uint8Array, "fromBase64", function (b64: string) {
    const s = atob(b64.replace(/[\s]/g, ""));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } as Fn);
}

/** Tests only: lets installPdfPolyfills run again after a test removed features. */
export function resetPdfPolyfillsForTests(): void {
  done = false;
}
