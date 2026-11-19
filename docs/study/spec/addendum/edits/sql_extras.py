"""Section E (package E): the server design's phase-3 extras with the
review's fix (§12.10): a member's trap is unmasked by a live quiz's reveal
(section Z's hook study_quiz__revealed), never by a trigger on
study_answers, whose 'quiz' rows members could write (SEC-7)."""
from lib import once


def build(texts: list[str]) -> str:
    (t,) = texts
    return fix(t)


def fix(t: str) -> str:
    t = once(t, """-- The author shows once a live quiz revealed her trap (section Z copies
-- each first vote into study_answers with mode 'quiz' at the reveal).
create or replace function public.study_answers_unmask()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.mode = 'quiz' then
    update public.study_questions q
       set unmasked_at = now(),
           author_id = (select d.user_id from public.study_trap_drafts d where d.question_id = q.id)
     where q.id = new.question_id and q.source = 'member' and q.unmasked_at is null;
  end if;
  return null;
end;
$$;
revoke all on function public.study_answers_unmask() from public, anon, authenticated;
drop trigger if exists study_answers_unmask on public.study_answers;
create trigger study_answers_unmask after insert on public.study_answers
  for each row execute function public.study_answers_unmask();""", """-- The author shows once a live quiz revealed her trap: section Z's final
-- reveal calls this hook (its no-op body is section Z's end's). Review SEC-7:
-- not a trigger on study_answers, whose 'quiz' rows a member could write.
drop trigger if exists study_answers_unmask on public.study_answers;
drop function if exists public.study_answers_unmask();
create or replace function public.study_quiz__revealed(p_quiz uuid, p_question uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.study_questions q
     set unmasked_at = now(),
         author_id = (select d.user_id from public.study_trap_drafts d where d.question_id = q.id)
   where q.id = p_question and q.source = 'member' and q.unmasked_at is null;
end;
$$;
revoke all on function public.study_quiz__revealed(uuid, uuid) from public, anon, authenticated;""", "SEC-7: the unmask at a live quiz's reveal")
    return t
