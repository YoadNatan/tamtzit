"""Section Z's end (package Z): the meeting design's approved group quiz
(presets, the bet, Mazur's revote, the round's trap, the record), the fun
design's hook points (mode 'boss', the signal, the boss's pick, reveal and
state), and the review's fixes (§12.10): hidden questions out, small-vote
counts withheld, the trap opened the next study day, a pick that does not
read two players' private answers, rituals capped per day."""
from lib import once

HOOKS = """
-- ── Hooks that later sections fill (the pattern of section F's
--    study_corrections_of: same names, arguments and results, so a later
--    section's create-or-replace swaps the body on every run). Here they do
--    nothing: the group's anonymous signal per question, 3 confident errors ·
--    2 missed · 1 split · 0 (section U, Q10), and a boss battle's rounds, hit
--    points and state (section H). ──
-- A boss battle (section H) is a quiz in mode 'boss': co-op, no points.
alter table public.study_quizzes drop constraint if exists study_quizzes_mode_check;
alter table public.study_quizzes add constraint study_quizzes_mode_check check (mode in ('coop', 'race', 'boss'));
create or replace function public.study_quiz__signal(p_question uuid)
returns int language sql stable set search_path = public as $$ select 0 $$;
create or replace function public.study_quiz__pick_boss(p_quiz uuid)
returns int language sql volatile set search_path = public as $$ select 0 $$;
create or replace function public.study_quiz__after_reveal(p_quiz uuid, p_idx int)
returns void language plpgsql volatile set search_path = public as $$ begin null; end $$;
create or replace function public.study_quiz__boss_state(p_quiz uuid)
returns jsonb language sql stable set search_path = public as $$ select null::jsonb $$;
-- A question was revealed in a live quiz (section E unmasks a member's trap
-- here, review SEC-7: never from a column a member can set).
create or replace function public.study_quiz__revealed(p_quiz uuid, p_question uuid)
returns void language plpgsql volatile set search_path = public as $$ begin null; end $$;
"""


def build(texts: list[str]) -> str:
    (t,) = texts
    t = once(t, "\n-- ── Internal helpers (no grants) ──\n", HOOKS + "\n-- ── Internal helpers (no grants) ──\n",
             "Z: the hook points of the fun design live in Z's end")
    t = once(t, "  public.study_quiz__open(uuid, int), public.study_quiz__reveal(uuid, int), public.study_quiz__finish(uuid), public.study_quiz__due(uuid)\n  from public, anon, authenticated;",
             "  public.study_quiz__open(uuid, int), public.study_quiz__reveal(uuid, int), public.study_quiz__finish(uuid), public.study_quiz__due(uuid),\n"
             "  public.study_quiz__signal(uuid), public.study_quiz__pick_boss(uuid), public.study_quiz__after_reveal(uuid, int),\n"
             "  public.study_quiz__boss_state(uuid), public.study_quiz__revealed(uuid, uuid)\n  from public, anon, authenticated;",
             "Z: the hooks revoked from everyone")
    return fix(t)


def fix(t: str) -> str:
    # F-6: a question two members flagged (hidden) is out of every quiz.
    t = once(t, """       and q.retired_at is null
       and q.stale_at is null
       and q.has_key
       and (z.kinds = 'all' or q.kind = z.kinds)""", """       and q.retired_at is null
       and q.stale_at is null
       and q.hidden_at is null                                   -- review F-6: two flags hide it everywhere
       and q.has_key
       and (z.kinds = 'all' or q.kind = z.kinds)""", "F-6: Z's pick leaves hidden questions out")
    # SEC-5: "fewest seen by these players" reads the players' private
    # answers; with fewer than 3 players it would ask exactly what the other
    # player never answered, so it counts only from 3 players (else random).
    t = once(t, """declare
  z   public.study_quizzes;
  n   int;
  ids uuid[];
begin
  select * into z from public.study_quizzes x where x.id = p_quiz;
  delete from public.study_quiz_rounds r where r.quiz_id = p_quiz;""", """declare
  z   public.study_quizzes;
  n   int;
  ids uuid[];
  np  int;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz;
  delete from public.study_quiz_rounds r where r.quiz_id = p_quiz;
  select count(*) into np from public.study_quiz_players p where p.quiz_id = p_quiz and p.left_at is null;""",
             "SEC-5: the pick counts its players")
    t = once(t, """           (select count(distinct a.user_id)
              from public.study_answers a
              join public.study_quiz_players p on p.user_id = a.user_id and p.quiz_id = p_quiz and p.left_at is null
             where a.question_id = q.id) as seen,""", """           case when np >= 3 then                                -- review SEC-5: an aggregate of 3 players at least
             (select count(distinct a.user_id)
                from public.study_answers a
                join public.study_quiz_players p on p.user_id = a.user_id and p.quiz_id = p_quiz and p.left_at is null
               where a.question_id = q.id) else 0 end as seen,""", "SEC-5: 'seen' only from 3 players")
    t = once(t, """-- Chooses the questions when the quiz starts: as section Z (keyed, not
-- retired, chosen lectures and kinds, spread over parts, flagged last,
-- fewest seen by these players, then random), plus: only the quiz's part
-- range when it has one, never a question a correction marked (stale), and
-- the opening's own choice for preset 'coffee'.""", """-- Chooses the questions when the quiz starts: as section Z (keyed, not
-- retired, chosen lectures and kinds, spread over parts, flagged last,
-- fewest seen by these players, then random), plus: only the quiz's part
-- range when it has one, never a question a correction marked (stale) or
-- two members' flags hid (review F-6), the group's nightly signal first
-- (section U's hook), "fewest seen" only when 3 or more play (review SEC-5:
-- with two players it would read the other's private answers), and the
-- opening's own choice for preset 'coffee'.""", "SEC-5, F-6: the pick's comment")
    # SEC-6: the round's trap card reaches every deck only when 3 players
    # chose that option, and opens at the next study day's start, so nobody
    # can match it to the players list of a quiz that just ended.
    t = once(t, """  if r.trap is null or r.question_id is null then return null; end if;
  if to_regprocedure('study_private.trap_card(uuid,integer,integer,text,text,text,text,integer[],text)') is null then return null; end if;""",
             """  if r.trap is null or r.question_id is null then return null; end if;
  if coalesce(r.counts1[r.trap + 1], 0) < 3 then return null; end if;                 -- review SEC-6: chosen by 3 at least
  if to_regprocedure('study_private.trap_card(uuid,integer,integer,text,text,text,text,integer[],text,timestamp with time zone)') is null then
    return null;
  end if;""", "SEC-6: a trap card only from 3 players' choice")
    t = once(t, """    (select coalesce(array_agg(s), '{}') from (select s from unnest(q.slides) s limit 12) x),
    'q:' || q.id::text || ':' || r.trap::text);""", """    (select coalesce(array_agg(s), '{}') from (select s from unnest(q.slides) s limit 12) x),
    'q:' || q.id::text || ':' || r.trap::text,
    -- review SEC-6: it opens at the next study day's start (04:00, Israel)
    ((((coalesce(r.revealed_at, now()) at time zone 'Asia/Jerusalem') - interval '4 hours')::date + 1) + time '04:00')
      at time zone 'Asia/Jerusalem');""", "SEC-6: the trap card opens the next study day")
    t = once(t, """-- A group trap card from the round's trap (section C's end makes it, once
-- per question and option). Nothing when section C is not there.""", """-- A group trap card from the round's trap (section C's end makes it, once
-- per question and option). Nothing when section C is not there. Only when 3
-- or more players chose the trap, and the card opens at the next study day's
-- start (review SEC-6: the museum's own rule, "so nobody can guess who").""", "SEC-6: comment")
    # SEC-7: a member's trap is unmasked here, at a live quiz's reveal (the
    # hook section E fills), never by a trigger on a column a member sets.
    t = once(t, """  perform public.study_quiz__after_reveal(p_quiz, r.idx);   -- a boss battle's hit points (section H)""",
             """  perform public.study_quiz__after_reveal(p_quiz, r.idx);   -- a boss battle's hit points (section H)
  perform public.study_quiz__revealed(p_quiz, r.question_id);   -- a member's trap is named (section E, review SEC-7)""",
             "SEC-7: the reveal calls section E's hook")
    # SEC-6: counts below 3 answers, round details to non-players, a solo
    # quiz's score: none of them leave the database.
    t = once(t, """      if z.preset = 'coffee' then
        v_rnd := v_rnd || jsonb_build_object(
          'majority', case when coalesce(r.answered1, 0) < 3 then null""", """      if not player then
        -- review SEC-6: a member who does not play sees the question and the
        -- key at the reveal, never how the players answered
        v_rnd := v_rnd || jsonb_build_object('answered', n_fin);
      elsif z.preset = 'coffee' then
        v_rnd := v_rnd || jsonb_build_object(
          'majority', case when coalesce(r.answered1, 0) < 3 then null""", "SEC-6: non-players see no answers")
    t = once(t, """        v_rnd := v_rnd || jsonb_build_object(
          'counts', to_jsonb(public.study_quiz__counts(r.id, r.vote, coalesce(cardinality(q.options), 0))),
          'dont_know', (select count(*) from public.study_quiz_answers a where a.round_id = r.id and a.vote = r.vote and a.choice is null),
          'answered', n_fin, 'right', ok_fin,
          'trap', r.trap,""", """        v_rnd := v_rnd || jsonb_build_object(
          -- review SEC-6: how many chose what, only from 3 answers (else only how many answered)
          'counts', case when n_fin >= 3 then to_jsonb(public.study_quiz__counts(r.id, r.vote, coalesce(cardinality(q.options), 0))) end,
          'dont_know', case when n_fin >= 3 then
                         (select count(*) from public.study_quiz_answers a where a.round_id = r.id and a.vote = r.vote and a.choice is null) end,
          'answered', n_fin, 'right', case when n_fin >= 3 then ok_fin end,
          'trap', r.trap,""", "SEC-6: reveal counts only from 3 answers")
    t = once(t, """                'answered', (select count(*) from public.study_quiz_answers a where a.round_id = r2.id and a.vote = r2.vote),
                'right', (select count(*) from public.study_quiz_answers a where a.round_id = r2.id and a.vote = r2.vote and a.correct),
                'counts', to_jsonb(public.study_quiz__counts(r2.id, r2.vote, coalesce(cardinality(q2.options), 0))),
                'counts1', case when r2.vote = 2 then to_jsonb(r2.counts1) end,
                'right1', case when r2.vote = 2 then r2.right1 end) end""", """                'answered', (select count(*) from public.study_quiz_answers a where a.round_id = r2.id and a.vote = r2.vote))
              || case when (select count(*) from public.study_quiz_answers a where a.round_id = r2.id and a.vote = r2.vote) >= 3
                      then jsonb_build_object(                    -- review SEC-6: from 3 answers only
                'right', (select count(*) from public.study_quiz_answers a where a.round_id = r2.id and a.vote = r2.vote and a.correct),
                'counts', to_jsonb(public.study_quiz__counts(r2.id, r2.vote, coalesce(cardinality(q2.options), 0))),
                'counts1', case when r2.vote = 2 then to_jsonb(r2.counts1) end,
                'right1', case when r2.vote = 2 then r2.right1 end)
                      else '{}'::jsonb end end""", "SEC-6: the end summary's counts only from 3 answers")
    t = once(t, """    if z.mode = 'coop' and z.preset in ('free', 'end') then
      select round(100.0""", """    if z.mode = 'coop' and z.preset in ('free', 'end')
       and (select count(*) from public.study_quiz_players p where p.quiz_id = p_quiz) >= 3 then   -- review SEC-6
      select round(100.0""", "SEC-6: the team's score only from 3 players")
    t = once(t, """         case when z.preset <> 'coffee' then
           (select round(100.0 * count(*) filter (where a.correct) / nullif(count(*), 0))::int""", """         case when z.preset <> 'coffee'
                   and (select count(*) from public.study_quiz_players p where p.quiz_id = z.id) >= 3 then   -- review SEC-6
           (select round(100.0 * count(*) filter (where a.correct) / nullif(count(*), 0))::int""", "SEC-6: recent's share only from 3 players")
    t = once(t, """-- The "יחד" card: as section Z (same result, so its signature stays); the
-- group's share counts final votes and none for an opening (its reveal
-- shows no numbers);""", """-- The "יחד" card: as section Z (same result, so its signature stays); the
-- group's share counts final votes, none for an opening (its reveal shows
-- no numbers) and none for a quiz of fewer than 3 players (review SEC-6: a
-- solo quiz would publish its host's score);""", "SEC-6: recent's comment")
    # F-15: decision 7's "at most two a day" is per group and study day, not
    # per meeting (a day with two lectures has two meetings).
    t = once(t, """  if p_meeting is not null and p_preset in ('coffee', 'end')
     and exists (select 1 from public.study_quizzes x
                  where x.meeting_id = p_meeting and x.preset = p_preset and x.state <> 'cancelled') then
    raise exception 'already';
  end if;""", """  if p_preset in ('coffee', 'end')
     and exists (select 1 from public.study_quizzes x
                  where x.group_id = p_group and x.preset = p_preset and x.state <> 'cancelled'
                    and ((x.created_at at time zone 'Asia/Jerusalem') - interval '4 hours')::date
                      = ((now() at time zone 'Asia/Jerusalem') - interval '4 hours')::date) then
    raise exception 'already';                              -- review F-15: one opening and one closing a study day
  end if;""", "F-15: one coffee and one end per group and study day")
    return t
