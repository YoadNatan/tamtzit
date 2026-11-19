-- ════════════════════════════════════════════════════════════════════════
--  SECTION N · THE PARAGRAPH ANCHOR   (package N; spec §12.4.N)
--  After sections Q's and C's ends. Section M's taps and section J's wall
--  are read when they exist (review F-10, F-13). Re-runnable.
--
--  A2  the chip row under each paragraph: how many questions, cards,
--      comments and wall entries sit on it (the group's), and two
--      chips only the caller sees: "טעית כאן" (her answers on its questions
--      that are still wrong) and her "לא ברור" from a meeting.
--  A4  the paragraph sheet's "תרגול" tab: its questions and cards, each
--      with the caller's own state, and the questions for "לתרגל את הפסקה".
--  Both are computed for the caller only; nothing private leaves her.
-- ════════════════════════════════════════════════════════════════════════

-- The caller's own "לא ברור" paragraphs of the last 14 days not yet seen
-- again (section M's taps), and the wall's visible entries per paragraph
-- (section J): read only when those sections exist, so section N loads
-- and runs without them (review F-10, F-13).
create or replace function study_private.my_unclear_spots(p_lecture uuid)
returns table (part_idx int, anchor int) language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('public.study_meeting_taps') is null then return; end if;
  return query execute
    'select t.part_idx, t.anchor from public.study_meeting_taps t
      where t.user_id = auth.uid() and t.lecture_id = $1 and t.done_at is null and t.created_at > now() - interval ''14 days''
      group by 1, 2' using p_lecture;
end;
$$;
create or replace function study_private.aid_spots(p_lecture uuid)
returns table (part_idx int, anchor int, n int) language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('public.study_aids') is null then return; end if;
  return query execute
    'select a.part_idx, a.anchor, count(*)::int from public.study_aids a
      where a.lecture_id = $1 and a.kind <> ''draft'' and a.flag is distinct from ''not_ok''
      group by 1, 2' using p_lecture;
end;
$$;
revoke all on function study_private.my_unclear_spots(uuid), study_private.aid_spots(uuid) from public;

drop function if exists public.study_paragraph_chips(uuid);   -- its result changed: 'aids' (the wall's) replaces 'mnemonics'
create or replace function public.study_paragraph_chips(p_lecture uuid)
returns table (part_idx int, anchor int, questions int, cards int, comments int, aids int, my_wrong int, my_unclear boolean)
language sql stable security definer set search_path = public as $$
  with ok as (
    select coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false)
           and not exists (select 1 from public.study_lectures l where l.id = p_lecture and l.deleted_at is not null) as yes
  ),
  q as (
    select x.part_idx, x.anchor, count(*)::int as n from public.study_questions x
     where x.lecture_id = p_lecture and x.anchor is not null and x.retired_at is null and x.has_key
       and x.hidden_at is null                                                     -- review F-6
     group by 1, 2
  ),
  c as (
    select x.part_idx, x.anchor, count(*)::int as n from public.study_cards x
     where x.lecture_id = p_lecture and x.anchor is not null and x.deleted_at is null
       and (x.opens_at is null or x.opens_at <= now())                             -- review SEC-6
     group by 1, 2
  ),
  cm as (
    select x.part_idx, x.anchor,
           (count(*) filter (where x.kind in ('comment', 'question', 'answer')))::int as comments
      from public.study_comments x
     where x.lecture_id = p_lecture and x.parent_id is null
     group by 1, 2
  ),
  ai as (select s.part_idx, s.anchor, s.n from study_private.aid_spots(p_lecture) s),
  latest as (
    select distinct on (a.question_id) a.question_id, a.correct
      from public.study_answers a join public.study_questions x on x.id = a.question_id
     where a.user_id = auth.uid() and x.lecture_id = p_lecture
     order by a.question_id, a.answered_at desc
  ),
  mw as (
    select x.part_idx, x.anchor, count(*)::int as n
      from public.study_answers a
      join public.study_questions x on x.id = a.question_id and x.anchor is not null and x.retired_at is null
      join latest l on l.question_id = x.id and not l.correct
     where a.user_id = auth.uid() and x.lecture_id = p_lecture and not a.correct
     group by 1, 2
  ),
  mu as (select s.part_idx, s.anchor from study_private.my_unclear_spots(p_lecture) s),
  k as (
    select part_idx, anchor from q union select part_idx, anchor from c union select part_idx, anchor from cm
    union select part_idx, anchor from ai union select part_idx, anchor from mw union select part_idx, anchor from mu
  )
  select k.part_idx, k.anchor, coalesce(q.n, 0), coalesce(c.n, 0), coalesce(cm.comments, 0), coalesce(ai.n, 0),
         coalesce(mw.n, 0), mu.part_idx is not null
    from k
    left join q on q.part_idx = k.part_idx and q.anchor = k.anchor
    left join c on c.part_idx = k.part_idx and c.anchor = k.anchor
    left join cm on cm.part_idx = k.part_idx and cm.anchor = k.anchor
    left join ai on ai.part_idx = k.part_idx and ai.anchor = k.anchor
    left join mw on mw.part_idx = k.part_idx and mw.anchor = k.anchor
    left join mu on mu.part_idx = k.part_idx and mu.anchor = k.anchor
   where (select yes from ok)
   order by k.part_idx, k.anchor;
$$;

-- The "תרגול" tab of one paragraph. Error: 'lecture not found'.
create or replace function public.study_paragraph_practice(p_lecture uuid, p_part int, p_anchor int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  qs jsonb;
  cs jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not coalesce(public.study_is_member(public.study_lecture_group(p_lecture)), false)
     or exists (select 1 from public.study_lectures l where l.id = p_lecture and l.deleted_at is not null) then
    raise exception 'lecture not found';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'kind', q.kind, 'question', q.question, 'teaser', q.teaser, 'stale', q.stale_at is not null,
           'hidden', q.hidden_at is not null,                                           -- review F-6: "בבדיקה", never practised
           'answered', (select count(*) from public.study_answers a where a.user_id = auth.uid() and a.question_id = q.id),
           'wrong', (select count(*) from public.study_answers a where a.user_id = auth.uid() and a.question_id = q.id and not a.correct),
           'last_correct', (select a.correct from public.study_answers a where a.user_id = auth.uid() and a.question_id = q.id
                             order by a.answered_at desc limit 1))
           order by q.kind, q.created_at), '[]'::jsonb)
    into qs
    from public.study_questions q
   where q.lecture_id = p_lecture and q.part_idx = p_part and q.anchor = p_anchor and q.retired_at is null and q.has_key;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'front', c.front, 'source', c.source, 'stale', c.stale_at is not null,
           'in_deck', exists (select 1 from public.study_card_states s where s.user_id = auth.uid() and s.card_id = c.id and not s.suspended),
           'lapses', coalesce((select s.lapses from public.study_card_states s where s.user_id = auth.uid() and s.card_id = c.id), 0))
           order by c.created_at), '[]'::jsonb)
    into cs
    from public.study_cards c
   where c.lecture_id = p_lecture and c.part_idx = p_part and c.anchor = p_anchor and c.deleted_at is null
     and (c.opens_at is null or c.opens_at <= now());                              -- review SEC-6
  return jsonb_build_object('questions', qs, 'cards', cs);
end;
$$;

revoke all on function public.study_paragraph_chips(uuid), public.study_paragraph_practice(uuid, int, int) from public, anon;
grant execute on function public.study_paragraph_chips(uuid), public.study_paragraph_practice(uuid, int, int) to authenticated;

insert into study_private.schema_sections (section, version) values ('N', 1)
on conflict (section) do update set version = excluded.version, loaded_at = now();
