
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
