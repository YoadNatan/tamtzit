#!/usr/bin/env node
// The contract between the TypeScript and the SQL (spec §8.2, review FE-7).
// The unit tests and the e2e use hand-written mocks, so a renamed argument
// or column would pass them all and fail only in production: PostgREST
// matches argument names exactly. This loads the real schema into a
// throwaway local Postgres and checks every name the code uses:
//
//   - every rpc("name", { … }) — the literal keys, keyed({ … })'s keys plus
//     p_key — against pg_proc's argument names (and the required ones);
//   - every .from("table") chain's select list (embeds included), filter,
//     order, insert/update/upsert keys against information_schema.columns,
//   - and in src/study/ (the browser, which always writes with the member's
//     token), every insert/update/upsert key and every .delete() against
//     what the role authenticated is granted: since W2 (spec §3.7) a member
//     writes no part and no lecture's writing state, and inserts a lecture
//     only with the upload's columns,
//
// in server/, shared/ and src/study/ (tests excluded: they may use bad
// names on purpose). It also writes e2e/study/schema-dump.json, which the
// e2e mock loads so it refuses what the schema does not have, and a member's
// write the grants do not allow.
//
//   npm run test:contract
//   STUDY_CONTRACT_PG=<database name> to choose the throwaway database's name
//   STUDY_CONTRACT_KEEP=1 to leave it for a look afterwards
//
// It needs the local Postgres every package's machine has (§3.6), run as
// `su postgres -c "psql …"`. It never connects anywhere else.
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dbName = process.env.STUDY_CONTRACT_PG || `study_contract_${process.pid}`;
if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`STUDY_CONTRACT_PG must be a plain database name, not ${dbName}`);

/* ── Postgres ── */
const asPostgres = (cmd, input) => execFileSync("su", ["postgres", "-c", cmd], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 << 20 });
function ensurePostgres() {
  try {
    asPostgres("psql -tAc 'select 1'");
  } catch {
    spawnSync("service", ["postgresql", "start"], { stdio: "ignore" });
    asPostgres("psql -tAc 'select 1'");
  }
}
const sqlFiles = ["supabase/tests/stubs.sql", "supabase/tests/board-schema.sql", "supabase/study-schema.sql"].map((f) => readFileSync(join(root, f), "utf8"));
const query = (sql) => asPostgres(`psql -X -q -tA -F '\t' -d ${dbName} -f -`, sql);

ensurePostgres();
asPostgres(`dropdb --if-exists ${dbName}; createdb ${dbName}`);
let schema;
try {
  asPostgres(`psql -X -q -v ON_ERROR_STOP=1 -d ${dbName} -f -`, sqlFiles.join("\n"));
  const fns = query(`
    select p.proname, coalesce(array_to_string(p.proargnames, ','), ''), coalesce(array_to_string(p.proargmodes::text[], ','), ''), p.pronargs, p.pronargdefaults
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'study\\_%'
     order by 1;`);
  const cols = query(`
    select table_name, column_name from information_schema.columns
     where table_schema = 'public' and table_name like 'study\\_%' order by table_name, ordinal_position;`);
  // What a member (the role authenticated) may write in each study table:
  // the columns it may insert and update, and whether it may delete. RLS then
  // decides which rows; the grants decide which columns (section F's, and
  // W2's hardening at the end of section W).
  const grants = query(`
    select c.relname, has_table_privilege('authenticated', c.oid, 'DELETE'),
           coalesce((select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
                      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                        and has_column_privilege('authenticated', c.oid, a.attnum, 'INSERT')), ''),
           coalesce((select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
                      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                        and has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')), '')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname like 'study\\_%' and c.relkind in ('r', 'v', 'p')
     order by 1;`);
  schema = { functions: {}, tables: {}, member: {} };
  for (const line of grants.trim().split("\n").filter(Boolean)) {
    const [t, del, ins, upd] = line.split("\t");
    schema.member[t] = { insert: ins ? ins.split(",") : [], update: upd ? upd.split(",") : [], delete: del === "t" };
  }
  for (const line of fns.trim().split("\n").filter(Boolean)) {
    const [name, names, modes, nargs, ndefaults] = line.split("\t");
    const all = names ? names.split(",") : [];
    const m = modes ? modes.split(",") : all.map(() => "i");
    const args = all.filter((_, i) => m[i] === "i" || m[i] === "b");
    (schema.functions[name] ??= []).push({ args, required: Number(nargs) - Number(ndefaults) });
  }
  for (const line of cols.trim().split("\n").filter(Boolean)) {
    const [t, c] = line.split("\t");
    (schema.tables[t] ??= []).push(c);
  }
} finally {
  if (!process.env.STUDY_CONTRACT_KEEP) asPostgres(`dropdb --if-exists ${dbName}`);
}
writeFileSync(join(root, "e2e", "study", "schema-dump.json"), JSON.stringify(schema, null, 1) + "\n");

/* ── the code's names ── */
function find(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) find(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}
const files = ["server", "shared", join("src", "study")].flatMap((d) => find(join(root, d)));

/** The balanced (…) or {…} that starts at s[i]. */
function balanced(s, i) {
  const open = s[i];
  const close = open === "(" ? ")" : open === "{" ? "}" : "]";
  let depth = 0;
  let quote = null;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (quote) {
      if (ch === "\\") j++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return s.slice(i, j + 1);
  }
  return s.slice(i);
}
/** The keys written at the top level of an object literal, and in the object
 *  literals a spread holds (`...(c ? { p_x: 1 } : {})`), but not the keys of
 *  an object that is a value: `{ p_card: { ...card, model } }` is p_card. */
function keysOf(obj) {
  const entries = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (let j = 1; j < obj.length - 1; j++) {
    const ch = obj[j];
    cur += ch;
    if (quote) {
      if (ch === "\\") cur += obj[++j] ?? "";
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("({[".includes(ch)) depth++;
    else if (")}]".includes(ch)) depth--;
    else if (ch === "," && depth === 0) {
      entries.push(cur.slice(0, -1));
      cur = "";
    }
  }
  entries.push(cur);
  const keys = [];
  for (const e of entries.map((x) => x.trim())) {
    if (e.startsWith("...")) {
      for (let i = e.indexOf("{"); i >= 0; ) {
        const inner = balanced(e, i);
        keys.push(...keysOf(inner));
        i = e.indexOf("{", i + inner.length);
      }
    } else {
      const m = /^([A-Za-z_$][\w$]*)\s*:(?!:)/.exec(e);
      if (m && m[1] !== "default") keys.push(m[1]);
    }
  }
  return keys;
}
/** String constants of a file, for select lists built from them. */
function constants(src) {
  const out = {};
  for (const m of src.matchAll(/const ([A-Z_][A-Z0-9_]*)\s*=\s*("([^"]*)"|`([^`]*)`)/g)) out[m[1]] = m[3] ?? m[4];
  for (let i = 0; i < 3; i++) for (const k of Object.keys(out)) out[k] = out[k].replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, n) => out[n] ?? "");
  return out;
}

const problems = [];
let rpcs = 0;
let chains = 0;
const fail = (file, what) => problems.push(`${relative(root, file).split(sep).join("/")}: ${what}`);

/* Tables of a section that is not merged yet, which code here already reads
 * only when they exist (it answers PostgREST's "no such table" with a
 * fallback): K's "לשאול" reads the recording's notes of section W. While the
 * database lacks them, their columns are checked against the CREATE TABLE
 * (and ADD COLUMN) of that section's spec file in docs/study/spec/sql/, and
 * they stay out of the dump the e2e mock reads; once the section is merged,
 * they are checked against the database like any other table. */
const LATER_TABLES = { study_recordings: "30-writing.sql", study_recording_notes: "30-writing.sql" };
function specColumns(table, file) {
  const sql = readFileSync(join(root, "docs", "study", "spec", "sql", file), "utf8");
  const body = new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1];
  if (!body) return null;
  const cols = [];
  for (const line of body.split("\n")) {
    const m = /^\s+([a-z_][a-z0-9_]*)\s/.exec(line);
    if (m && !["constraint", "unique", "check", "primary", "foreign", "exclude"].includes(m[1])) cols.push(m[1]);
  }
  for (const alter of sql.matchAll(new RegExp(`alter table (?:if exists )?public\\.${table}\\b[^;]*;`, "g")))
    for (const m of alter[0].matchAll(/add column if not exists ([a-z_][a-z0-9_]*)/g)) cols.push(m[1]);
  return cols;
}
/* Functions of a section, or of a section's end, that are not merged yet,
 * which code here calls only behind the flag that needs that section (its
 * SQL runs before the flag, §12.7.6): K's card from an answered question
 * (section C's end, with flags.cards). Until their section is merged, their
 * argument names are checked against the CREATE FUNCTION of the addendum's
 * SQL in docs/study/spec/addendum/sql/, and they stay out of the e2e mock's
 * dump; once merged, against the database like any other function (section
 * V is merged: K's "לא מסכימים: כרטיס צהוב" is checked against the
 * database). A merged one is skipped here. */
const LATER_FUNCTIONS = { study_my_card_add: "65-cards-end.sql" };
function specFunction(name, file) {
  const sql = readFileSync(join(root, "docs", "study", "spec", "addendum", "sql", file), "utf8");
  const at = sql.indexOf(`create or replace function public.${name}(`);
  if (at < 0) return null;
  const list = balanced(sql, sql.indexOf("(", at)).slice(1, -1);
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  const args = parts.map((a) => /^([a-z_][a-z0-9_]*)\s/.exec(a)?.[1]).filter(Boolean);
  return { args, required: parts.filter((a) => !/\sdefault\s/i.test(a)).length };
}
for (const [fn, file] of Object.entries(LATER_FUNCTIONS)) {
  if (schema.functions[fn]) continue;
  const sig = specFunction(fn, file);
  if (sig) schema.later = { ...(schema.later ?? {}), [fn]: [sig] };
  else problems.push(`tools/study-contract.mjs: ${fn} is in no CREATE FUNCTION of docs/study/spec/addendum/sql/${file}`);
}

const later = {};
for (const [table, file] of Object.entries(LATER_TABLES)) {
  if (schema.tables[table]) continue;
  const cols = specColumns(table, file);
  if (cols) later[table] = cols;
  else problems.push(`tools/study-contract.mjs: ${table} is in no CREATE TABLE of docs/study/spec/sql/${file}`);
}

const checkCol = (file, table, col) => {
  const known = schema.tables[table] ?? later[table];
  if (!known) return fail(file, `unknown table ${table}`);
  if (col !== "*" && !known.includes(col)) fail(file, `unknown column ${table}.${col}`);
};
function checkSelect(file, table, sel) {
  let depth = 0;
  let cur = "";
  const items = [];
  for (const ch of sel) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      items.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  for (const item of items) {
    const m = /^([a-z_]+)(?:![a-z_]+)?\s*\(([\s\S]*)\)$/.exec(item);
    if (m) checkSelect(file, m[1], m[2]);
    else checkCol(file, table, item.replace(/\s+/g, ""));
  }
}

/* The browser's writes against the member's grants (since W2: no part, no
 * lecture's writing state, a new lecture only with the upload's columns).
 * An upsert inserts, and updates too unless it ignores duplicates. */
let writes = 0;
const browserDir = join(root, "src", "study") + sep;
function checkGrant(file, table, verb, col, chain) {
  const g = schema.member[table];
  if (!g) return; // a table of a section not merged yet: checked by its columns above
  writes += 1;
  const needs = verb === "update" ? ["update"] : verb === "upsert" && !/ignoreDuplicates:\s*true/.test(chain) ? ["insert", "update"] : ["insert"];
  for (const n of needs) if (!g[n].includes(col)) fail(file, `a member may not ${n} ${table}.${col} (no grant): the browser writes with the member's token`);
}

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const browser = file.startsWith(browserDir);
  const consts = constants(src);
  // rpc("name", { … }) / rpc("name", keyed({ … })) / rpc("name")
  for (const m of src.matchAll(/\.rpc\(\s*/g)) {
    const args = balanced(src, m.index + m[0].length - 1 - (src[m.index + m[0].length - 1] === "(" ? 0 : 0));
    const inner = balanced(src, src.indexOf("(", m.index));
    const name = /^\(\s*"([a-z_0-9]+)"/.exec(inner)?.[1];
    if (!name) continue; // a name held in a variable (health's read(fn)): checked where it is written
    rpcs += 1;
    const sigs = schema.functions[name] ?? schema.later?.[name];
    if (!sigs) {
      fail(file, `unknown function ${name}`);
      continue;
    }
    const rest = inner.slice(inner.indexOf(`"${name}"`) + name.length + 2);
    let keys = [];
    const obj = rest.indexOf("{");
    if (obj >= 0) keys = keysOf(balanced(rest, obj));
    if (/keyed\(/.test(rest)) keys.push("p_key");
    const ok = sigs.some((s) => keys.every((k) => s.args.includes(k)) && s.args.slice(0, s.required).every((a) => keys.includes(a)));
    if (!ok) fail(file, `${name}(${keys.join(", ")}) matches none of ${sigs.map((s) => `(${s.args.join(", ")})`).join(" ")}`);
    void args;
  }
  // .from("table") … chains
  for (const m of src.matchAll(/\.from\(\s*"(study_[a-z_]+)"\s*\)/g)) {
    chains += 1;
    const table = m[1];
    let end = src.indexOf(";", m.index);
    const next = src.indexOf(".from(", m.index + 6);
    if (next > 0 && next < end) end = next;
    const chain = src.slice(m.index + m[0].length, end < 0 ? undefined : end);
    for (const s of chain.matchAll(/\.select\(\s*(?:"([^"]*)"|`([^`]*)`|([A-Z_][A-Z0-9_]*)|(sectionF \? [A-Z_]+ : [A-Z_]+)|(columns))/g)) {
      if (s[5] || s[4]) continue; // a select list chosen at run time from constants checked below
      // ${columns}: a parameter holding one of the *_COLUMNS constants, checked below.
      const text = (s[1] ?? s[2] ?? consts[s[3]] ?? "")
        .replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, n) => consts[n] ?? "")
        .replace(/\$\{[a-z]\w*\},?\s*/g, "");
      if (text) checkSelect(file, table, text);
    }
    for (const f of chain.matchAll(/\.(?:eq|neq|is|in|gt|gte|lt|lte|not|order|like|ilike|contains)\(\s*"([a-z_.]+)"/g)) {
      const [t, c] = f[1].includes(".") ? f[1].split(".") : [table, f[1]];
      checkCol(file, t, c);
    }
    for (const w of chain.matchAll(/\.(insert|update|upsert)\(\s*/g)) {
      const at = w.index + w[0].length;
      let obj = "";
      if (chain[at] === "{") obj = balanced(chain, at);
      else if (chain[at] === "[" && chain[at + 1] === "{") obj = balanced(chain, at + 1);
      else {
        const v = /^([a-z][\w]*)/.exec(chain.slice(at))?.[1];
        const def = v ? new RegExp(`const ${v}\\s*=\\s*\\{`).exec(src) : null;
        if (def) obj = balanced(src, def.index + def[0].length - 1);
      }
      for (const k of keysOf(obj)) {
        checkCol(file, table, k);
        if (browser) checkGrant(file, table, w[1], k, chain);
      }
    }
    if (browser && /\.delete\(\s*\)/.test(chain) && schema.member[table] && !schema.member[table].delete) {
      writes += 1;
      fail(file, `a member may not delete from ${table} (no grant): the browser writes with the member's token`);
    }
  }
  // Column lists kept in constants (LECTURE_COLUMNS…): every constant named *_COLUMNS is checked against its table.
  for (const [name, text] of Object.entries(consts)) {
    if (!name.endsWith("COLUMNS")) continue;
    const table = name.startsWith("SECTION") ? "study_sections" : name.includes("LECTURE") ? "study_lectures" : name.startsWith("COMMENT") ? "study_comments" : null;
    if (table) checkSelect(file, table, text);
  }
}

const fnCount = Object.keys(schema.functions).length;
const tableCount = Object.keys(schema.tables).length;
if (problems.length) {
  console.error(`The contract failed: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
const pending = [...Object.keys(later), ...Object.keys(schema.later ?? {})];
console.log(
  `ok: ${rpcs} rpc calls and ${chains} table chains in ${files.length} files match the schema (${fnCount} study functions, ${tableCount} study tables); ${writes} of the browser's written columns are granted to a member; e2e/study/schema-dump.json written` +
    (pending.length ? `\n    ${pending.join(", ")}: checked against the spec's SQL until their section is merged` : ""),
);
