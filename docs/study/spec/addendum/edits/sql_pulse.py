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
    t = once(t, TRAP9, TRAP10, "SEC-6: pulse' checks the trap maker's new signature")
    t = once(t, "   where x.rn = 1 and q.group_id = p_group and q.retired_at is null and q.has_key",
             "   where x.rn = 1 and q.group_id = p_group and q.retired_at is null and q.hidden_at is null and q.has_key",
             "F-6: the night counts no hidden question")
    t = once(t, "     where q.group_id = p_group and q.retired_at is null and btrim(q.topic) <> ''",
             "     where q.group_id = p_group and q.retired_at is null and q.hidden_at is null and btrim(q.topic) <> ''",
             "F-6: 'אצלך' counts no hidden question")
    t = once(t, "   where s.lecture_id = p_lecture and q.retired_at is null",
             "   where s.lecture_id = p_lecture and q.retired_at is null and q.hidden_at is null", "F-6: the brief's question is never hidden")
    # SEC-8 (A, B): who counts is a person, not a member id: a saved account
    # (one per person; a second device signs in and merges) in the group for
    # 7 days; and reading is reciprocal: only members the last night counted
    # read the pulse, the spots, the museum and "דרושות", so nobody compares
    # a night with her and a night without her (an opt-out, a return, a
    # newly saved account all wait for the next night).
    t = once(t, """create table if not exists study_private.pulse_runs (
  group_id uuid        primary key references public.study_groups (id) on delete cascade,
  cutoff   timestamptz not null,               -- signals before this instant were counted
  ran_at   timestamptz not null default now(),
  counted  jsonb       not null default '{}'::jsonb
);""", """create table if not exists study_private.pulse_runs (
  group_id uuid        primary key references public.study_groups (id) on delete cascade,
  cutoff   timestamptz not null,               -- signals before this instant were counted
  ran_at   timestamptz not null default now(),
  counted  jsonb       not null default '{}'::jsonb
);
-- review SEC-8: who the night counted (they, and only they, read what it wrote)
alter table study_private.pulse_runs add column if not exists members uuid[] not null default '{}';""", "SEC-8: the run records who it counted")
    t = once(t, """-- The members whose signals count: in the group now, not opted out.
create or replace function study_private.pulse_counted(p_group uuid)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select m.user_id from public.study_members m
   where m.group_id = p_group
     and not exists (select 1 from public.study_pulse_optout o where o.group_id = p_group and o.user_id = m.user_id)
$$;""", """-- The members whose signals count: in the group for 7 days at least, with a
-- saved account (one person, one account: an unsaved second device is not a
-- second person), not opted out (review SEC-8).
create or replace function study_private.pulse_counted(p_group uuid)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select m.user_id from public.study_members m
    join auth.users u on u.id = m.user_id and not coalesce(u.is_anonymous, false)
   where m.group_id = p_group
     and m.joined_at <= now() - interval '7 days'
     and not exists (select 1 from public.study_pulse_optout o where o.group_id = p_group and o.user_id = m.user_id)
$$;
-- The caller reads the group's counts only when the last night counted her
-- and she is not out now (review SEC-8: reading is reciprocal).
create or replace function public.study_pulse_reader(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from study_private.pulse_runs r where r.group_id = p_group and auth.uid() = any (r.members))
     and not exists (select 1 from public.study_pulse_optout o where o.group_id = p_group and o.user_id = auth.uid())
$$;
revoke all on function public.study_pulse_reader(uuid) from public, anon;
grant execute on function public.study_pulse_reader(uuid) to authenticated;""", "SEC-8: counted people, and the reader rule")
    t = once(t, """    insert into study_private.pulse_runs (group_id, cutoff, ran_at, counted) values (g, c, now(), v_cnt)
    on conflict (group_id) do update set cutoff = excluded.cutoff, ran_at = excluded.ran_at, counted = excluded.counted;""",
             """    insert into study_private.pulse_runs (group_id, cutoff, ran_at, counted, members)
    values (g, c, now(), v_cnt, array(select x.user_id from study_private.pulse_counted(g) x))
    on conflict (group_id) do update set cutoff = excluded.cutoff, ran_at = excluded.ran_at, counted = excluded.counted,
                                         members = excluded.members;""", "SEC-8: the night records its members")
    t = once(t, """  if not study_private.feature_on('pulse') then return null; end if;
  perform study_private.pulse_night(p_group);
  return (select r.cutoff from study_private.pulse_runs r where r.group_id = p_group);""", """  if not study_private.feature_on('pulse') then return null; end if;
  perform study_private.pulse_night(p_group);
  if not public.study_pulse_reader(p_group) then return null; end if;    -- review SEC-8: reciprocal
  return (select r.cutoff from study_private.pulse_runs r where r.group_id = p_group);""", "SEC-8: every pulse read is reciprocal")
    t = once(t, """-- The study day's counts are ready: runs the night's count first when
-- pg_cron has not (the first read of the study day). Returns the cut-off
-- they cover, or null while the switch 'pulse' is off.""", """-- The study day's counts are ready: runs the night's count first when
-- pg_cron has not (the first read of the study day). Returns the cut-off
-- they cover, or null while the switch 'pulse' is off or the caller is not
-- among the members the night counted (review SEC-8). Every pulse,
-- museum, trap-card and boss read starts here.""", "SEC-8: comment")
    for tbl in ["topics", "questions", "cards", "spots"]:
        t = once(t, f"""create policy "study pulse {tbl} read" on public.study_pulse_{tbl}
  for select using (public.study_is_member(group_id) and public.study_feature_on('pulse'));""",
                 f"""create policy "study pulse {tbl} read" on public.study_pulse_{tbl}
  for select using (public.study_is_member(group_id) and public.study_feature_on('pulse') and public.study_pulse_reader(group_id));""",
                 f"SEC-8: {tbl} read only by the counted")
    # SEC-15: the optional plaque, one call at a time.
    t = once(t, """  plaque      jsonb,                                        -- {claim, line}: the optional plaque by Claude
  unique (question_id, option)
);""", """  plaque      jsonb,                                        -- {claim, line}: the optional plaque by Claude
  plaque_until timestamptz,                                 -- op 'plaque' holds the exhibit (review SEC-15)
  unique (question_id, option)
);
alter table public.study_traps add column if not exists plaque_until timestamptz;""", "SEC-15: the plaque's hold")
    t = once(t, """-- MU2's optional plaque (op "plaque", Claude, ≈ $0.01): written once, with the server key.""",
             """-- op 'plaque' first takes the exhibit for 2 minutes, before it reserves the
-- budget: a second phone gets 'busy' and pays nothing (review SEC-15).
-- Errors: 'forbidden', 'exhibit not found', 'checked' (it has a plaque), 'busy'.
create or replace function public.study_trap_plaque_begin(p_trap uuid, p_key text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare t public.study_traps;
begin
  if not study_private.is_worker(p_key) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into t from public.study_traps x where x.id = p_trap for update;
  if not found or not coalesce(public.study_is_member(t.group_id), false)
     or t.exhibit_no is null or t.exhibit_at > now() or t.state <> 'open' then
    raise exception 'exhibit not found';
  end if;
  if t.plaque is not null then raise exception 'checked'; end if;
  if t.plaque_until > now() then raise exception 'busy'; end if;
  update public.study_traps x set plaque_until = now() + interval '2 minutes' where x.id = p_trap;
end;
$$;

-- MU2's optional plaque (op "plaque", Claude, ≈ $0.01): written once, with the server key.""", "SEC-15: study_trap_plaque_begin")
    t = times(t, "public.study_museum_pick(uuid), public.study_museum_shown(uuid), public.study_trap_plaque(uuid, text, text, text)",
              "public.study_museum_pick(uuid), public.study_museum_shown(uuid), public.study_trap_plaque(uuid, text, text, text),\n  public.study_trap_plaque_begin(uuid, text)",
              2, "SEC-15: grants of the plaque's hold")
    return t
