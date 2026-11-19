"""Spec §12: the final text of this section (see §12.10 for the review's edits)."""
from lib import once, times


def build(texts: list[str]) -> str:
    (t,) = texts
    return fix(t)


TRAP9 = "'study_private.trap_card(uuid,integer,integer,text,text,text,text,integer[],text)'"
TRAP10 = "'study_private.trap_card(uuid,integer,integer,text,text,text,text,integer[],text,timestamp with time zone)'"


def fix(t: str) -> str:
    # SEC-6: section C's trap card maker takes when the card opens (a tenth
    # argument with a default): the existence check names the new signature.
    t = once(t, TRAP9, TRAP10, "SEC-6: var' checks the trap maker's new signature")
    # SEC-10: the published row says nothing about backing (no count, no
    # version bump per back); backing closes when VAR is asked; the split
    # shows only then, from 3 backers other than the caller.
    t = once(t, """  trap_card     uuid,
  backs_n       int         not null default 0 check (backs_n >= 0),
  version       int         not null default 1 check (version >= 1),""", """  trap_card     uuid,
  judging_until timestamptz,                                -- op 'var' holds the dispute (review SEC-15)
  var_asked_at  timestamptz,                                -- VAR asked: backing closes (review SEC-10)
  version       int         not null default 1 check (version >= 1),""", "SEC-10, SEC-15: the dispute's columns")
    t = once(t, """create unique index if not exists study_disputes_open on public.study_disputes (lecture_id, part_idx, anchor)""",
             """alter table public.study_disputes drop column if exists backs_n;              -- review SEC-10: not published
alter table public.study_disputes add column if not exists judging_until timestamptz;
alter table public.study_disputes add column if not exists var_asked_at timestamptz;
create unique index if not exists study_disputes_open on public.study_disputes (lecture_id, part_idx, anchor)""", "SEC-10: drop backs_n on re-run")
    t = once(t, """  if d.state not in ('open', 'judged') then raise exception 'not open'; end if;
  if auth.uid() in (d.author_a, d.author_b) then raise exception 'a side cannot back'; end if;""",
             """  if d.state <> 'open' or d.var_asked_at is not null then raise exception 'not open'; end if;   -- review SEC-10
  if auth.uid() in (d.author_a, d.author_b) then raise exception 'a side cannot back'; end if;""", "SEC-10: backing closes when VAR is asked")
    t = once(t, """  update public.study_disputes x set backs_n = (select count(*) from public.study_dispute_backs b where b.dispute_id = p_dispute),
                                     version = x.version + 1, updated_at = now()
   where x.id = p_dispute;
end;""", """  -- review SEC-10: the shared row does not change on a back (no count, no version)
end;""", "SEC-10: a back changes nothing published")
    t = once(t, """       set claim_b = btrim(p_claim), slides_b = p_slides, author_b = auth.uid(),
           backs_n = (select count(*) from public.study_dispute_backs b where b.dispute_id = p_dispute),
           version = x.version + 1, updated_at = now()""", """       set claim_b = btrim(p_claim), slides_b = p_slides, author_b = auth.uid(),
           version = x.version + 1, updated_at = now()""", "SEC-10: no count on the published row")
    t = once(t, """-- A dispute as the caller may see it: the claims with names (what one
-- publishes carries the name), the counts by side only from 3 backers,
-- her own backing, the verdict.""", """-- A dispute as the caller may see it: the claims with names (what one
-- publishes carries the name), how many back the sides, her own backing,
-- the verdict. The split by side shows once backing has closed (VAR asked
-- or the card decided), from 3 backers other than the caller (review
-- SEC-10: one's own back and un-back can no longer read the others').""", "SEC-10: state's comment")
    t = once(t, """    'backs', case when na + nb >= 3 then jsonb_build_object('a', na, 'b', nb) end,""",
             """    'backs', case when (d.state <> 'open' or d.var_asked_at is not null)
                       and na + nb - (select count(*) from public.study_dispute_backs b
                                       where b.dispute_id = p_dispute and b.user_id = auth.uid()) >= 3
                  then jsonb_build_object('a', na, 'b', nb) end,
    'backing_open', d.state = 'open' and d.var_asked_at is null,""", "SEC-10: the split after backing closes")
    # SEC-15: one VAR call per dispute at a time: the op takes the hold
    # before it reserves; a second phone gets 'busy'.
    t = once(t, """-- op 'var' saves Claude's verdict (server key, with the member's token).""", """-- op 'var' first takes the dispute (server key, with the member's token)
-- for 3 minutes, before it reserves the budget: a second phone gets 'busy'
-- and pays nothing (review SEC-15). Errors: 'forbidden', 'dispute not
-- found', 'not ready', 'busy'.
create or replace function public.study_dispute_judge_begin(p_dispute uuid, p_key text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare d public.study_disputes;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into d from public.study_disputes x where x.id = p_dispute for update;
  if not found or not coalesce(public.study_is_member(public.study_lecture_group(d.lecture_id)), false) then
    raise exception 'dispute not found';
  end if;
  if d.state <> 'open' or d.claim_b is null then raise exception 'not ready'; end if;
  if d.judging_until > now() then raise exception 'busy'; end if;
  update public.study_disputes x
     set judging_until = now() + interval '3 minutes', var_asked_at = coalesce(x.var_asked_at, now()),
         version = x.version + 1, updated_at = now()
   where x.id = p_dispute;
end;
$$;

-- op 'var' saves Claude's verdict (server key, with the member's token).""", "SEC-15: study_dispute_judge_begin")
    t = once(t, """  if d.state <> 'open' or d.claim_b is null then raise exception 'not ready'; end if;
  if not study_private.verdict_ok(p_verdict, study_private.lecture_slides(d.lecture_id)) then raise exception 'bad verdict'; end if;
  update public.study_disputes x
     set verdict = p_verdict, verdict_model = left(p_model, 80), judged_at = now(), state = 'judged',""",
             """  if d.state <> 'open' or d.claim_b is null or d.judging_until is null then raise exception 'not ready'; end if;   -- review SEC-15
  if not study_private.verdict_ok(p_verdict, study_private.lecture_slides(d.lecture_id)) then raise exception 'bad verdict'; end if;
  update public.study_disputes x
     set verdict = p_verdict, verdict_model = left(p_model, 80), judged_at = now(), state = 'judged', judging_until = null,""",
             "SEC-15: a verdict follows the hold")
    t = times(t, "public.study_dispute_verdict(uuid, jsonb, text, text), public.study_dispute_decide(uuid, text, text), public.study_dispute_close(uuid),",
              "public.study_dispute_verdict(uuid, jsonb, text, text), public.study_dispute_judge_begin(uuid, text),\n  public.study_dispute_decide(uuid, text, text), public.study_dispute_close(uuid),",
              2, "SEC-15: grants of judge_begin")
    return t
