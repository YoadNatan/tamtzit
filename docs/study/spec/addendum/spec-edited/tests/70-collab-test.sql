-- ════════════════════════════════════════════════════════════════════════
--  SECTION K checks · corrections, shared answers, memory aids   (package K)
-- ════════════════════════════════════════════════════════════════════════
-- Behaviour test for sql/collab.sql, on a throwaway local Postgres (never the
-- real project). Runs after supabase/tests/study.sql in the same database
-- (its users and group). Every line reads "ok ..." or a value; "FAIL" means
-- a rule no longer holds.
\set ON_ERROR_STOP 1
\pset tuples_only on
reset role;
select id as gid from public.study_groups limit 1 \gset

-- meeting addendum: an applied edit is now a proposal plus a second
-- approval (section K's end). This helper does both, as the caller and then
-- as another member, and raises what either step raises (a paragraph that
-- changed meanwhile comes back from the approval as "conflict").
reset role;
create schema if not exists mtest;
grant usage on schema mtest to authenticated, anon;
create or replace function mtest.edit_block(p_lecture uuid, p_part int, p_anchor int, p_before text, p_after text,
  p_base_rev int, p_base_gen int, p_occurrence int default 1, p_note text default '', p_undo_of uuid default null)
returns jsonb language plpgsql as $f$
declare
  me  text := current_setting('request.jwt.claim.sub', true);
  pid uuid;
  res jsonb;
begin
  if p_undo_of is not null then
    return public.study_edit_block(p_lecture, p_part, p_anchor, p_before, p_after, p_base_rev, p_base_gen, p_occurrence, p_note, p_undo_of);
  end if;
  pid := public.study_propose_edit(p_lecture, p_part, p_anchor, p_before, p_after, p_base_rev, p_base_gen, coalesce(p_occurrence, 1),
                                   p_note, 'external', '{}', null, 'בדיקה');
  perform set_config('request.jwt.claim.sub',
                     case when me = 'bbbbbbbb-0000-4000-8000-000000000002' then 'cccccccc-0000-4000-8000-000000000003'
                          else 'bbbbbbbb-0000-4000-8000-000000000002' end, true);
  res := public.study_approve_edit(pid);
  perform set_config('request.jwt.claim.sub', me, true);
  if coalesce((res ->> 'conflict')::boolean, false) then raise exception '%', res ->> 'reason'; end if;
  return res;
end;
$f$;
grant execute on function mtest.edit_block(uuid, int, int, text, text, int, int, int, text, uuid) to authenticated, anon;
select set_config('t.gid', :'gid', false) is not null as have_gid \gset
-- A lecture with two parts written by the summary writer (as the owner, like section.ts would).
insert into public.study_lectures (id, group_id, title, source_kind, slides, created_by)
values ('eeeeeeee-0000-4000-8000-000000000007', :'gid', 'Corrections test', 'pptx', '[]'::jsonb, 'bbbbbbbb-0000-4000-8000-000000000002');
insert into public.study_sections (lecture_id, idx, title, slide_from, slide_to, status, markdown) values
('eeeeeeee-0000-4000-8000-000000000007', 0, 'Metronidazole: מנגנון ושימושים', 4, 7, 'pending', ''),
('eeeeeeee-0000-4000-8000-000000000007', 1, 'Tidy', 3, 3, 'pending', '');
select 'K1. new parts start at rev ' || min(rev) || ', gen ' || min(gen) || ' (expect 0, 0)' from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007';
-- The writer claims and finishes part 0 (status writing, then ready with text).
update public.study_sections set status = 'writing', markdown = '' where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007';
update public.study_sections set status = 'ready', markdown = $md$## Metronidazole: מנגנון ושימושים

### מנגנון פעולה

**מנגנון פעולה:** Metronidazole היא prodrug שמשופעלת בתאים אנאירוביים על ידי PFOR. [ש' 5]

- Headache
- Headache
- Metallic taste

> **שימו לב:** בשקף 7 כתוב 48 שעות. [ש' 7]

**טבלה: Amebicides** [ש' 4]

| קבוצה | תרופות |
|---|---|
| Luminal | Paromomycin |
| Mixed | Metronidazole |

![שיני זהב כתזכורת לטעם המתכתי (שקף 7)](fig:7-1)$md$
 where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;
update public.study_sections set status = 'ready', markdown = E'## Tidy\n\nהטווח הוא 7 – 31 ימים.‏ [ש'' 3]'
 where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 1;
select 'K2. after one writing: rev ' || rev || ', gen ' || gen || ' (expect 1, 1: the first text is rev 1)' from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;

set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';   -- Noa, a member
do $$ begin update public.study_sections set rev = 99, gen = 99 where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 1;
  raise notice 'K3. % (expect rev 1, gen 1: a client cannot set the counters)', (select 'rev ' || rev || ', gen ' || gen from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 1);
exception when insufficient_privilege then raise notice 'K3. ok: after W2 a member cannot write a part at all';
end $$;

-- C4. Noa corrects the paragraph (anchor 2), with a note.
select 'K4. ' || case when (r ->> 'rev')::int = 2 and (r ->> 'merged')::boolean = false then 'ok: saved, rev 2' else 'FAIL ' || r::text end
  from (select mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 2,
    $b$**מנגנון פעולה:** Metronidazole היא prodrug שמשופעלת בתאים אנאירוביים על ידי PFOR. [ש' 5]$b$,
    $a$**מנגנון פעולה:** Metronidazole היא prodrug שמשופעלת בתאים אנאירוביים על ידי PFOR או hydrogenase. [ש' 5]$a$,
    1, 1, 1, 'בשקף 5 מופיע גם hydrogenase') as r) x;
select 'K5. ' || case when markdown like '%PFOR או hydrogenase. [ש'' 5]%' and markdown like '## Metronidazole%' and markdown like '%(fig:7-1)'
                       and (length(markdown) - length(replace(markdown, E'\n\n', ''))) / 2 = 7 then 'ok: only that paragraph changed, the 7 gaps between blocks kept' else 'FAIL ' || markdown end
  from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;
select 'K6. history: ' || count(*) || ' row, author Noa: ' || bool_and(author_id = 'cccccccc-0000-4000-8000-000000000003') || ', kind ' || min(kind) || ', anchor ' || min(anchor) || ', gen ' || min(gen) || ', note kept: ' || bool_and(note <> '')
  from public.study_edits where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007';

-- C7. Shoham, editor opened at rev 2, corrects ANOTHER paragraph (the box): merged.
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'K7. ' || case when (r ->> 'merged')::boolean and (r ->> 'rev')::int = 3 then 'ok: other paragraph changed meanwhile, merged' else 'FAIL ' || r::text end
  from (select mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 6,
    $b$> **שימו לב:** בשקף 7 כתוב 48 שעות. [ש' 7]$b$, $a$> **שימו לב:** בשקף 7 כתוב 48 שעות אחרי המנה האחרונה. [ש' 7]$a$, 1, 1) as r) x;
-- C8. Shoham, also from rev 2, corrects the paragraph Noa already changed: conflict.
do $$ begin perform mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 2,
    $b$**מנגנון פעולה:** Metronidazole היא prodrug שמשופעלת בתאים אנאירוביים על ידי PFOR. [ש' 5]$b$,
    $a$**מנגנון פעולה:** Metronidazole היא prodrug. [ש' 5]$a$, 1, 1);
  raise notice 'K8. FAIL: a stale correction overwrote a newer one';
exception when others then
  if sqlerrm = 'edit conflict' then raise notice 'K8. ok: same paragraph changed meanwhile -> edit conflict'; else raise notice 'K8. FAIL: %', sqlerrm; end if;
end $$;

-- C9. Duplicate items: with the current rev, occurrence 2 is the second "- Headache".
select mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 4, '- Headache', '- Nausea', 3, 1, 2) as r \gset
select 'K9. ' || case when not (:'r'::jsonb ->> 'merged')::boolean and markdown like E'%- Headache\n- Nausea\n- Metallic taste%' then 'ok: the second of two identical items changed' else 'FAIL ' || markdown end
  from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;
-- C10. Same text twice and a stale rev: no guessing.
reset role;
update public.study_sections set markdown = replace(markdown, '- Nausea', '- Headache') where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
do $$ begin perform mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 3, '- Headache', '- Dizziness', 4, 1, 1);  -- rev is 5 now
  raise notice 'K10. FAIL: an ambiguous block was edited on a stale rev';
exception when others then
  if sqlerrm = 'edit conflict' then raise notice 'K10. ok: ambiguous text on a stale rev -> edit conflict'; else raise notice 'K10. FAIL: %', sqlerrm; end if;
end $$;

-- C11. Edits that would move anchors (or touch what is not text) are refused.
do $$
declare
  cur int := (select rev from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0);
  c record;
  n_ok int := 0;
begin
  for c in select * from (values
    ('blank line',      0, '### מנגנון פעולה', E'### מנגנון\n\nפעולה'),
    ('heading level',   1, '### מנגנון פעולה', '#### מנגנון פעולה'),
    ('heading -> text', 1, '### מנגנון פעולה', 'מנגנון פעולה'),
    ('para -> list',    2, 'x', '- x'),
    ('item marker',     3, '- Headache', '* Headache'),
    ('item -> para',    3, '- Headache', 'Headache'),
    ('box label',       6, E'> **שימו לב:** בשקף 7 כתוב 48 שעות אחרי המנה האחרונה. [ש'' 7]', E'> **הרחבה (לא מהשקפים):** בשקף 7 כתוב 48 שעות. [ש'' 7]'),
    ('box -> para',     6, E'> **שימו לב:** בשקף 7 כתוב 48 שעות אחרי המנה האחרונה. [ש'' 7]', 'בשקף 7 כתוב 48 שעות.'),
    ('table add row',   8, E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |', E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |\n| X | Y |'),
    ('table columns',   8, E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |', E'| קבוצה | תרופות | עוד |\n|---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |'),
    ('table delimiter', 8, E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |', E'| קבוצה | תרופות |\n|:---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |'),
    ('table backslash', 8, E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |', E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin\\\\|\n| Mixed | Metronidazole |'),
    ('figure ref',      9, '![שיני זהב כתזכורת לטעם המתכתי (שקף 7)](fig:7-1)', '![שיני זהב](fig:7-2)'),
    ('figure bracket',  9, '![שיני זהב כתזכורת לטעם המתכתי (שקף 7)](fig:7-1)', '![שיני [זהב](fig:7-1)'),
    ('rule',            2, 'x', '---'),
    ('html',            2, 'x', '<div>x</div>'),
    ('link definition', 2, 'x', '[ש]: http://x'),
    ('code fence',      2, 'x', '```'),
    ('indented code',   2, 'x', '    x'),
    ('two lines',       2, 'x', E'x\ny')
  ) as t(label, anchor, before, after) loop
    begin
      perform mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, c.anchor, c.before, c.after, cur, 1, 1);
      raise notice 'K11. FAIL: % was accepted', c.label;
    exception when others then
      if sqlerrm = 'bad block' then n_ok := n_ok + 1;
      else raise notice 'K11. FAIL: % refused for another reason: %', c.label, sqlerrm; end if;
    end;
  end loop;
  raise notice 'K11. ok: % of 20 structure-changing edits refused as bad block', n_ok;
end $$;
-- C12. A table cell and a figure caption can be corrected (rows, columns, ids kept).
select mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 8,
  E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin |\n| Mixed | Metronidazole |',
  E'| קבוצה | תרופות |\n|---|---|\n| Luminal | Paromomycin, Diloxanide furoate |\n| Mixed | Metronidazole |',
  (select rev from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0), 1) as a \gset
select mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 9,
  '![שיני זהב כתזכורת לטעם המתכתי (שקף 7)](fig:7-1)', '![שיני זהב: הטעם המתכתי בפה (שקף 7)](fig:7-1)',
  (select rev from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0), 1) as b \gset
select 'K12. ' || case when (:'b'::jsonb ->> 'rev')::int = (:'a'::jsonb ->> 'rev')::int + 1 and not (:'b'::jsonb ->> 'merged')::boolean
                       then 'ok: table cell and figure caption corrected' else 'FAIL ' || :'a' || ' ' || :'b' end;
-- C13. No change, an empty after, and a note over 300 characters.
do $$ begin perform mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 1, '### מנגנון פעולה', '### מנגנון פעולה', 0, 1);
  raise notice 'K13. FAIL: an unchanged block was saved';
exception when others then if sqlerrm = 'no change' then raise notice 'K13. ok: no change refused'; else raise notice 'K13. FAIL: %', sqlerrm; end if; end $$;
do $$ begin perform mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 1, '### מנגנון פעולה', '### מנגנון', 0, 1, 1, repeat('x', 301));
  raise notice 'K13b. FAIL: a long note was saved';
exception when others then if sqlerrm = 'too long' then raise notice 'K13b. ok: note over 300 characters refused'; else raise notice 'K13b. FAIL: %', sqlerrm; end if; end $$;

-- C14. The part's own heading is its title too.
select mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 0, '## Metronidazole: מנגנון ושימושים', '## Metronidazole: מנגנון, שימושים ועמידות',
  (select rev from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0), 1) as r \gset
select 'K14. ' || case when title = 'Metronidazole: מנגנון, שימושים ועמידות' then 'ok: title follows the ## heading' else 'FAIL title ' || title end
  from public.study_sections s where s.lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and s.idx = 0;

-- C15. Tidy: the stored part had an en dash and a direction mark; the phone sends what it renders.
select mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 1, 1, E'הטווח הוא 7-31 ימים. [ש'' 3]', E'הטווח הוא 7 \u2013 31 ימים, לפי שקף 3. [ש'' 3]', 1, 1) as r \gset
select 'K15. ' || case when s.markdown = E'## Tidy\n\nהטווח הוא 7-31 ימים, לפי שקף 3. [ש'' 3]' then 'ok: found in the tidy text; stored tidy' else 'FAIL ' || s.markdown end
  from public.study_sections s where s.lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and s.idx = 1;

-- C16. Undo: Noa's correction is put back by Shoham (an undo is a correction with undo_of).
select set_config('t.noa_edit', (select id::text from public.study_edits where anchor = 2 and lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' order by rev limit 1), false) is not null as have_edit \gset
select mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 2,
  $a$**מנגנון פעולה:** Metronidazole היא prodrug שמשופעלת בתאים אנאירוביים על ידי PFOR או hydrogenase. [ש' 5]$a$,
  $b$**מנגנון פעולה:** Metronidazole היא prodrug שמשופעלת בתאים אנאירוביים על ידי PFOR. [ש' 5]$b$,
  (select rev from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0), 1, 1, '',
  current_setting('t.noa_edit')::uuid) as r \gset
select 'K16. ' || case when s.markdown like '%על ידי PFOR. [ש'' 5]%' and e.undo_of::text = current_setting('t.noa_edit') then 'ok: undone, linked to the edit it undoes' else 'FAIL' end
  from public.study_sections s, public.study_edits e
 where s.lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and s.idx = 0 and e.id = (:'r'::jsonb ->> 'edit_id')::uuid;
do $$ begin perform mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 1, '### מנגנון פעולה', '### מנגנון', 0, 1, 1, '', current_setting('t.noa_edit')::uuid);
  raise notice 'K16b. FAIL: an undo pointed at another paragraph';
exception when others then if sqlerrm = 'bad undo' then raise notice 'K16b. ok: an undo must point at an edit of the same paragraph'; else raise notice 'K16b. FAIL: %', sqlerrm; end if; end $$;

-- C17. Nobody writes the history directly; a stranger can neither read it nor correct.
do $$ begin insert into public.study_edits (lecture_id, part_idx, anchor, gen, rev, kind, before_text, after_text) values ('eeeeeeee-0000-4000-8000-000000000007', 0, 0, 1, 1, 'paragraph', 'a', 'b');
  raise notice 'K17. FAIL: a member wrote history directly';
exception when insufficient_privilege then raise notice 'K17. ok: no direct insert (%)', sqlerrm; end $$;
do $$ begin update public.study_edits set after_text = 'x'; raise notice 'K17b. FAIL: history rewritten';
exception when insufficient_privilege then raise notice 'K17b. ok: no update'; end $$;
do $$ begin delete from public.study_edits; raise notice 'K17c. FAIL: history deleted';
exception when insufficient_privilege then raise notice 'K17c. ok: no delete'; end $$;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
select 'K18. stranger sees ' || count(*) || ' history rows (expect 0)' from public.study_edits;
do $$ begin perform mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 1, '### מנגנון פעולה', '### x', 0, 1);
  raise notice 'K18b. FAIL: a stranger corrected a part';
exception when others then if sqlerrm = 'forbidden' then raise notice 'K18b. ok: stranger refused'; else raise notice 'K18b. FAIL: %', sqlerrm; end if; end $$;
reset role;
set role anon;
do $$ begin perform public.study_edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 1, '### מנגנון פעולה', '### x', 0, 1);
  raise notice 'K18c. FAIL: anon called the function';
exception when insufficient_privilege then raise notice 'K18c. ok: anon cannot call it (%)', sqlerrm; end $$;
reset role;

-- C19. A part being written cannot be corrected; a rewrite starts a new generation,
--      and the writer gets the old generation's net corrections.
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'K19. corrections now (no earlier generation): ' || public.study_part_corrections('eeeeeeee-0000-4000-8000-000000000007', 0)::text || ' (expect [])';
reset role;
update public.study_sections set status = 'writing', markdown = '' where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 1, '### מנגנון פעולה', '### x', 0, 2);
  raise notice 'K19b. FAIL: a part being written was corrected';
exception when others then if sqlerrm = 'part busy' then raise notice 'K19b. ok: part busy while written'; else raise notice 'K19b. FAIL: %', sqlerrm; end if; end $$;
select 'K19c. gen after the rewrite started: ' || gen || ' (expect 2)' from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;
select 'K19d. corrections for the writer: ' || jsonb_array_length(c) || ' (expect 5: the undone paragraph drops out)'
       || case when c::text like '%48 שעות אחרי המנה האחרונה%' and c::text like '%Diloxanide furoate%' and c::text like '%שימושים ועמידות%' and c::text not like '%hydrogenase%' then ', ok' else ', FAIL ' || c::text end
  from public.study_part_corrections('eeeeeeee-0000-4000-8000-000000000007', 0) c;
select 'K19e. history kept: ' || count(*) || ' rows (expect 8)' from public.study_edits where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007';
reset role;
update public.study_sections set status = 'ready', markdown = '## Metronidazole' where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0;
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform mtest.edit_block('eeeeeeee-0000-4000-8000-000000000007', 0, 0, '## Metronidazole', '## Metronidazole: x', (select rev from public.study_sections where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007' and idx = 0), 1);
  raise notice 'K19f. FAIL: an editor opened on the old generation saved';
exception when others then if sqlerrm = 'part rewritten' then raise notice 'K19f. ok: an editor from the old generation gets part rewritten'; else raise notice 'K19f. FAIL: %', sqlerrm; end if; end $$;

-- C20. Comments: shared memory aids and answers are top-level; answers may be longer.
insert into public.study_comments (lecture_id, part_idx, anchor, quote, kind, body) values
 ('eeeeeeee-0000-4000-8000-000000000007', 0, 0, 'Metronidazole', 'mnemonic', E'MeTRo: Metallic taste · Trichomonas\nM = Metallic taste'),
 ('eeeeeeee-0000-4000-8000-000000000007', 0, 0, 'Metronidazole', 'answer', repeat('א', 3500));
select 'K20. a mnemonic and a 3500-character answer saved: ' || count(*) from public.study_comments where lecture_id = 'eeeeeeee-0000-4000-8000-000000000007';
do $$ begin insert into public.study_comments (lecture_id, part_idx, anchor, kind, body) values ('eeeeeeee-0000-4000-8000-000000000007', 0, 0, 'mnemonic', repeat('א', 2001));
  raise notice 'K20b. FAIL: a 2001-character mnemonic was saved';
exception when check_violation then raise notice 'K20b. ok: mnemonics keep the 2000 limit'; end $$;
do $$ begin insert into public.study_comments (lecture_id, part_idx, anchor, kind, body, parent_id)
  values ('eeeeeeee-0000-4000-8000-000000000007', 0, 0, 'answer', 'x', (select id from public.study_comments where kind = 'mnemonic' limit 1));
  raise notice 'K20c. FAIL: an answer was saved as a reply';
exception when check_violation then raise notice 'K20c. ok: replies are plain comments'; end $$;
do $$ begin insert into public.study_comments (lecture_id, part_idx, anchor, kind, body) values ('eeeeeeee-0000-4000-8000-000000000007', 0, 0, 'note', 'x');
  raise notice 'K20d. FAIL: an unknown kind was saved';
exception when check_violation then raise notice 'K20d. ok: unknown kinds refused'; end $$;

-- C21. My uses today: only my own rows of that kind, today in Israel.
reset role;
insert into public.study_usage (group_id, lecture_id, user_id, kind, ref, model, cost_usd, created_at) values
 (:'gid', 'eeeeeeee-0000-4000-8000-000000000007', 'cccccccc-0000-4000-8000-000000000003', 'ask', 'answer', 'claude-opus-5-5', 0.02, now()),
 (:'gid', 'eeeeeeee-0000-4000-8000-000000000007', 'cccccccc-0000-4000-8000-000000000003', 'ask', 'answer', 'claude-opus-5-5', 0.02, now()),
 (:'gid', 'eeeeeeee-0000-4000-8000-000000000007', 'cccccccc-0000-4000-8000-000000000003', 'ask', 'route', 'claude-opus-5-5', 0.01, now()),
 (:'gid', 'eeeeeeee-0000-4000-8000-000000000007', 'cccccccc-0000-4000-8000-000000000003', 'ask', 'answer', 'claude-opus-5-5', 0.02,
  (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem') - interval '1 minute'),
 (:'gid', 'eeeeeeee-0000-4000-8000-000000000007', 'bbbbbbbb-0000-4000-8000-000000000002', 'ask', 'answer', 'claude-opus-5-5', 0.02, now()),
 (:'gid', 'eeeeeeee-0000-4000-8000-000000000007', 'cccccccc-0000-4000-8000-000000000003', 'mnemonic', null, 'claude-opus-5-5', 0.03, now());
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select 'K21. Noa asked today: ' || public.study_my_uses_today(:'gid', 'ask', 'answer') || ' (expect 2), mnemonics: ' || public.study_my_uses_today(:'gid', 'mnemonic') || ' (expect 1)';
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000004';
do $$ begin perform public.study_my_uses_today((select current_setting('t.gid'))::uuid, 'ask');
  raise notice 'K21b. FAIL: a stranger got a count';
exception when others then if sqlerrm = 'forbidden' then raise notice 'K21b. ok: stranger refused'; else raise notice 'K21b. ok: refused (%)', sqlerrm; end if; end $$;
reset role;

-- ════ Review checks: M9 (no new links in a correction) ════
select 'KR1. a correction that adds a URL: ' || coalesce(public.study_block_edit_problem('Primaquine גורמת להמוליזה. [ש'' 3]', 'Primaquine גורמת להמוליזה, ראו https://evil.example/login [ש'' 3]'), 'accepted') || ' (expect link)';
select 'KR1b. a Markdown link: ' || coalesce(public.study_block_edit_problem('ההקלטה של ההרצאה. [ש'' 3]', 'ההקלטה [המלאה](https://x.example) של ההרצאה. [ש'' 3]'), 'accepted') || ' (expect link)';
select 'KR1c. "www." without a scheme: ' || coalesce(public.study_block_edit_problem('טקסט. [ש'' 3]', 'טקסט, ב-www.evil.example. [ש'' 3]'), 'accepted') || ' (expect link)';
select 'KR1d. an ordinary fix with its slide tag: ' || coalesce(public.study_block_edit_problem('טקסט. [ש'' 3]', 'טקסט מתוקן. [ש'' 3]'), 'accepted') || ' (expect accepted)';
select 'KR1e. a link the block already had may stay: ' || coalesce(public.study_block_edit_problem('ראו https://moodle.bgu.ac.il/x. [ש'' 3]', 'ראו גם https://moodle.bgu.ac.il/x. [ש'' 3]'), 'accepted') || ' (expect accepted)';
select 'K-reg. the registry: ' || (public.study_schema() ->> 'K') || ' (expect 2: with section K''s end)';

-- C22. Realtime publishes the history; the trigger function is not callable.
select 'K22. study_edits in supabase_realtime: ' || exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'study_edits');
select 'K22b. authenticated may execute study_sections_versions: ' || has_function_privilege('authenticated', 'public.study_sections_versions()', 'execute') || ' (expect false)';

-- C23. Deleting the lecture removes its parts and their history.
delete from public.study_lectures where id = 'eeeeeeee-0000-4000-8000-000000000007';
select 'K23. history rows left: ' || count(*) || ' (expect 0)' from public.study_edits;
