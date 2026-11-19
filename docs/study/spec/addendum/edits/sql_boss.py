"""Section H (package H): the fun design's boss battle, with the review's
fixes (§12.10): a question two members hid is out of the heads, the rounds and
the relapses (F-6); the heads are hot topics, so only a member the pulse
counted may see them before a battle (SEC-8's reciprocal rule)."""
from lib import once


def build(texts: list[str]) -> str:
    (t,) = texts
    return fix(t)


def fix(t: str) -> str:
    t = once(t, "and lower(btrim(q.topic)) = r.topic_key and q.retired_at is null and q.has_key",
             "and lower(btrim(q.topic)) = r.topic_key and q.retired_at is null and q.hidden_at is null and q.has_key",
             "F-6: boss heads without hidden questions")
    t = once(t, "   where q.retired_at is null and q.has_key and r.o <= 30;",
             "   where q.retired_at is null and q.hidden_at is null and q.has_key and r.o <= 30;", "F-6: boss rounds without hidden questions")
    t = once(t, "from public.study_questions x where x.id = (hd ->> 'key_q')::uuid and x.retired_at is null;",
             "from public.study_questions x where x.id = (hd ->> 'key_q')::uuid and x.retired_at is null and x.hidden_at is null;",
             "F-6: a relapse never brings back a hidden question")
    t = once(t, """    perform public.study_pulse_ready(p_group);
    v_heads := study_private.boss_heads(p_group, lec);""",
             """    -- review SEC-8: the heads are the pulse's hot topics; a member the
    -- night did not count (opted out, a new or unsaved account) reads none
    if public.study_pulse_ready(p_group) is null then raise exception 'no heads'; end if;
    v_heads := study_private.boss_heads(p_group, lec);""", "SEC-8: no heads for a member the pulse does not count")
    t = once(t, """  if not study_private.feature_on('pulse') then return jsonb_build_object('heads', '[]'::jsonb); end if;
  perform public.study_pulse_ready(p_group);""",
             """  if not study_private.feature_on('pulse') then return jsonb_build_object('heads', '[]'::jsonb); end if;
  -- review SEC-8: only a member the pulse counted sees the heads (hot topics)
  if public.study_pulse_ready(p_group) is null then return jsonb_build_object('heads', '[]'::jsonb); end if;""",
             "SEC-8: the boss card's heads only for a member the pulse counts")
    return t
