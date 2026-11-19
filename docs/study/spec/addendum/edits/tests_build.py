"""The addendum's checks (spec §12.11), from the three designs' checks with
the review's edits, and the review's own checks (tests/review/)."""
import pathlib
from lib import once, read, write, MEET, FUN, SRV, FINAL

T = FINAL / "tests"


def build() -> None:
    # Checks that share the spec's session (the meeting design's labels QA ZA CA KA M N V T MG)
    for f in ["95-extensions-test", "96-meeting-test", "97-anchor-var-today-test"]:
        write(T / f"shared/{f}.sql", edit_shared(f, read(MEET / f"tests/{f}.sql")))
    g = read(MEET / "tests/98-merge-test.sql")
    g = once(g, "'study_is_member', 'study_lecture_group', 'study_is_member_path');",
             "'study_is_member', 'study_lecture_group', 'study_is_member_path',\n"
             "                         'study_bank_take', 'study_bank_input', 'study_bank_report', 'study_bank_save', 'study_bank_finish');",
             "MG5: the worker's five functions")
    g = once(g, "(expect A 1, C 2, F 1, K 2, M 1, N 1, P 1, Q 2, T 1, V 1, W 1, Z 2)",
             "(expect A 1, B 1, C 2, E 1, F 1, G 1, H 1, J 1, K 2, M 1, N 1, P 2, Q 2, T 1, U 1, V 1, W 1, Z 2)", "MG6")
    write(T / "shared/98-merge-test.sql", edit_shared("98-merge-test", g))
    # Checks in a database of their own: the fun design's (U J H, merge M0-M7)
    for f in ["10-fixtures", "20-pulse-test", "30-wall-test", "40-boss-test", "50-later-test", "60-merge-test"]:
        write(T / f"fun/{f}.sql", edit_fun(f, read(FUN / f"tests/{f}.sql")))
    # Checks in a database of their own: the server design's (QS CS KS PS BS GS ES DS MS)
    for f in ["00-fixtures", "10-questions-test", "20-cards-test", "30-collab-test", "40-progress-test",
              "50-bank-test", "60-plan-extras-test", "70-merge-test"]:
        write(T / f"server/{f}.sql", edit_server(f, read(SRV / f"tests/{f}.sql")))


def edit_shared(name: str, t: str) -> str:
    if name == "95-extensions-test":
        t = once(t, "'study_private.trap_card(uuid,integer,integer,text,text,text,text,integer[],text)'",
                 "'study_private.trap_card(uuid,integer,integer,text,text,text,text,integer[],text,timestamp with time zone)'",
                 "tests 95: the trap maker's signature (review SEC-6)")
        t = once(t, "case when sqlerrm = 'not the reader' then 'ok' else 'FAIL' end, sqlerrm; end $$;\nset request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';\nselect set_config('t.e1'",
                 "case when sqlerrm = 'not live' then 'ok' else 'FAIL' end, sqlerrm; end $$;\nset request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';\nselect set_config('t.e1'",
                 "KA6: aloud without a live reading is 'not live' (review SEC-3)")
        t = once(t, """select 'ZA7. the round''s trap became a card: ' || count(*) || ', source ' || max(source) || ', on part ' || max(part_idx) || ' paragraph ' || max(anchor)
       || ', asks "למה לא": ' || bool_and(front like '%למה לא %?') || ', back is the trap''s explanation: ' || bool_and(back = 'הסבר ב: לא כאן [ש'' 5]')
       || ' (expect 1, trap, 0, 1, true, true)'""", """select 'ZA7. two players chose the round''s trap: cards made ' || count(*)
       || ' (expect 0: a trap card needs 3 players'' choice and opens the next study day, review SEC-6; check SR6c covers 3)'""",
                 "ZA7: two choosing a trap make no card (review SEC-6)")
    if name == "96-meeting-test":
        t = once(t, """ ('3c7a0000-0000-4000-8000-000000000004', '3c100000-0000-4000-8000-000000000002', 0, 2, 'Pentostam', 'mnemonic', 'Pentostam: 5 כוכבים, עובדת ב-3', false,
  '3c000000-0000-4000-8000-000000000003', now() - interval '1 day' + interval '1 hour');""",
                 """ ('3c7a0000-0000-4000-8000-000000000004', '3c100000-0000-4000-8000-000000000002', 0, 2, 'Pentostam', 'comment', 'Pentostam: 5 כוכבים, עובדת ב-3', false,
  '3c000000-0000-4000-8000-000000000003', now() - interval '1 day' + interval '1 hour');
-- review F-13: the association pinned in the meeting is the wall's moment (section J), posted by name
insert into public.study_aids (id, group_id, lecture_id, part_idx, anchor, quote, kind, body, fact, slides, named_by, created_at)
values ('3c7b0000-0000-4000-8000-000000000001', :'gid', '3c100000-0000-4000-8000-000000000002', 0, 2, 'Pentostam', 'moment',
        'Pentostam: 5 כוכבים, עובדת ב-3', 'Pentostam: חמש-ערכי, ECG לפני [ש'' 3]', '{3}', '3c000000-0000-4000-8000-000000000003',
        now() - interval '1 day' + interval '1 hour');
insert into public.study_aid_authors (aid_id, user_id) values ('3c7b0000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000003');""",
                 "M fixtures: the meeting's association is a wall moment (review F-13)")
        t = once(t, "|| ' (expect 1,3: the least answered of each paragraph; true)';",
                 "|| ' (expect 1,2: the first paragraphs in reading order, no count of who answered, review SEC-5; true)';",
                 "M2: the guesses in reading order (review SEC-5)")
        t = once(t, "|| ' (expect one callout: part 0, paragraph 2, n 3, no names)';",
                 "|| ' (expect one callout: part 0, paragraph 2, n 3, no names and no text, review SEC-11)';", "M5b: no text (review SEC-11)")
        t = once(t, """select 'M3b. the reader is warned""", """reset role;
update study_private.features set enabled = true where name = 'pulse';   -- decision 1's switch governs the warning (review F-14)
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'M3b. the reader is warned""", "M3b: the pulse switch on for the warning (review F-14)")
        t = once(t, """set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_meeting_place(current_setting('t.m')::uuid, 0, 5);""", """reset role;
update study_private.features set enabled = false where name = 'pulse';
set role authenticated;
-- Noa and Itai follow the reading (review SEC-3, SEC-4: a reading counts as live with two followers)
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000001';
select public.study_meeting_here(current_setting('t.m')::uuid) is null as h \\gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_meeting_here(current_setting('t.m')::uuid) is null as h \\gset
do $$ begin perform public.study_meeting_place(current_setting('t.m')::uuid, 0, 5);""", "M4: two followers before the reading releases a guess (review SEC-4)")
        t = once(t, """exception when others then raise notice 'M7. %: aloud is the reader''s (%)', case when sqlerrm = 'not the reader' then 'ok' else 'FAIL' end, sqlerrm; end $$;""",
                 """exception when others then raise notice 'M7. %: aloud is the reader''s (%)', case when sqlerrm = 'not live' then 'ok' else 'FAIL' end, sqlerrm; end $$;""",
                 "M7: a follower's aloud is 'not live' (review SEC-3)")
        t = once(t, """select 'M7c. the reader''s own proposal, agreed aloud by the table: ' || ((public.study_approve_edit(current_setting('t.pb')::uuid, true) ->> 'edit_id') is not null)
       || ' (expect true)';""", """do $$ begin perform public.study_approve_edit(current_setting('t.pb')::uuid, true);
  raise notice 'M7c. FAIL: the reader approved her own proposal aloud';
exception when others then raise notice 'M7c. %: the reader''s own proposal needs another member, aloud too (%)',
  case when sqlerrm = 'own proposal' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_withdraw_edit(current_setting('t.pb')::uuid) is null as w \\gset""", "M7c: never one's own proposal aloud (review SEC-3)")
        t = once(t, """select public.study_edit_block('3c100000-0000-4000-8000-000000000001', 2, 1, 'Artemisinins לעולם לא לבד: t½ של 1-2 שעות. [ש'' 30]',
  'Artemisinins לעולם לא לבד. [ש'' 30]', (select rev from public.study_sections where lecture_id = '3c100000-0000-4000-8000-000000000001' and idx = 2),
  0, 1, '', (select edit_id from public.study_edit_proposals where id = current_setting('t.pb')::uuid)) is not null as u \\gset
""", "", "M7c: nothing to put back")
        t = once(t, """-- ═════════ The opening ("3 לקפה") and the closing quiz ═════════
""", """-- ═════════ The opening ("3 לקפה") and the closing quiz ═════════
-- Decision 7's cap is one opening and one closing a study day for the group
-- (review F-15): the earlier checks' quizzes of these presets move to yesterday.
reset role;
update public.study_quizzes set created_at = created_at - interval '1 day'
 where group_id = :'gid' and preset in ('coffee', 'end');
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
""", "M8: the day's cap, earlier quizzes moved to yesterday (review F-15)")
        t = once(t, """select 'M12e. finished: in "קראו" ' || (select count(*) from public.study_reads where lecture_id = '3c100000-0000-4000-8000-000000000002' and user_id = auth.uid())
       || ', still offered ' || (select count(*) from public.study_my_missed(:'gid') where meeting_id = '3c6a0000-0000-4000-8000-000000000001')
       || ' (expect 1, 0)';""", """select 'M12e. finished: in "קראו" at once ' || (select count(*) from public.study_reads where lecture_id = '3c100000-0000-4000-8000-000000000002' and user_id = auth.uid())
       || ', still offered ' || (select count(*) from public.study_my_missed(:'gid') where meeting_id = '3c6a0000-0000-4000-8000-000000000001')
       || ' (expect 0: the mark is written the next study day, review SEC-12; 0)';
reset role;
update public.study_meeting_catchups set done_at = done_at - interval '1 day'
 where meeting_id = '3c6a0000-0000-4000-8000-000000000001' and user_id = 'abababab-0000-4000-8000-000000000007';
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select public.study_meeting_band(:'gid') is not null as b \\gset
select 'M12f. the next study day: Dana in "קראו" ' || count(*) || ', at the meeting''s time ' || bool_and(r.read_at = m.started_at)
       || ' (expect 1, true: review SEC-12)'
  from public.study_reads r join public.study_meetings m on m.id = '3c6a0000-0000-4000-8000-000000000001'
 where r.lecture_id = '3c100000-0000-4000-8000-000000000002' and r.user_id = 'abababab-0000-4000-8000-000000000007';
set request.jwt.claim.sub = 'abababab-0000-4000-8000-000000000007';""", "M12e/M12f: the catch-up's mark the next study day (review SEC-12)")
    if name == "97-anchor-var-today-test":
        t = edit_97(t)
    return t


def edit_97(t: str) -> str:
    t = once(t, "(expect 2 questions (1, 1), 2 cards: the deck''s and the trap card (1))",
             "(expect 2 questions (1, 1), 1 card: the deck''s; two chose the round''s trap, no trap card, review SEC-6 (1))",
             "N2: no trap card from two players (review SEC-6)")
    t = once(t, """select 'T3. the danger row: the miss ' || (question_id::text = current_setting('t.qb')) || ', asked now in another wording '
       || other_wording || ' (a question on the same paragraph: ' || (select anchor from public.study_questions where id = ask_id) || ')'
       || ' (expect true, true (2))'
  from public.study_my_danger(:'gid');""", """select 'T3. the danger row is the danger list''s first due row: ' || (d.question_id = l.question_id and d.ask_id = l.ask_id)
       || '; the newer miss is on the list too: ' || exists (select 1 from public.study_my_danger_list(:'gid') x where x.question_id::text = current_setting('t.qb'))
       || '; asked in another wording when its paragraph has one: ' || (d.other_wording = (d.ask_id <> d.question_id))
       || ' (expect true; true; true: one rule for the "על בטוח" row, review F-9)'
  from public.study_my_danger(:'gid') d,
       lateral (select x.* from public.study_my_danger_list(:'gid') x where x.due_day <= public.study_day(now()) + date '1970-01-01'
                 order by x.due_day, x.wrong_at limit 1) l;""", "T3: the danger row is the list's first due row (review F-9)")
    t = once(t, "       || ' (expect נועה כהן vs מאיה, {\"a\": 1, \"b\": 2}, false; 0)'",
             "       || ' (expect נועה כהן vs מאיה, none: the split shows once backing closes, review SEC-10; false; 0)'",
             "V2d: no split while backing is open (review SEC-10)")
    t = once(t, """-- VAR (op 'var' saves with the server key)
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';""", """-- VAR (op 'var' takes the dispute, then saves with the server key)
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin perform public.study_dispute_judge_begin(current_setting('t.d1')::uuid);
  raise notice 'V2f. FAIL: the hold without the server key';
exception when others then raise notice 'V2f. %: only op var takes the dispute (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_dispute_judge_begin(current_setting('t.d1')::uuid, :'key') is null as j \\gset
do $$ begin perform public.study_dispute_judge_begin(current_setting('t.d1')::uuid, 'k-0123456789abcdef0123456789abcdef');
  raise notice 'V2g. FAIL: a second phone''s VAR while the first runs';
exception when others then raise notice 'V2g. %: one VAR call at a time (%)', case when sqlerrm = 'busy' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'V2h. VAR asked, backing closed: Noa sees ' || coalesce((public.study_dispute_state(current_setting('t.d1')::uuid) -> 'backs')::text, 'none')
       || ' (expect {"a": 1, "b": 2}: three backers, review SEC-10)';
set request.jwt.claim.sub = '3c000000-0000-4000-8000-000000000002';
do $$ begin perform public.study_dispute_back(current_setting('t.d1')::uuid, 'b');
  raise notice 'V2i. FAIL: backing after VAR was asked';
exception when others then raise notice 'V2i. %: backing closes when VAR is asked (%)', case when sqlerrm = 'not open' then 'ok' else 'FAIL' end, sqlerrm; end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';""", "V2f-V2i: the hold and the split after backing closes (review SEC-10, SEC-15)")
    t = once(t, """select public.study_dispute_claim(current_setting('t.d2')::uuid, 'בשקף 30: combine with long-acting partner', array[30]) is null as c \\gset
select public.study_dispute_verdict(current_setting('t.d2')::uuid,""", """select public.study_dispute_claim(current_setting('t.d2')::uuid, 'בשקף 30: combine with long-acting partner', array[30]) is null as c \\gset
select public.study_dispute_judge_begin(current_setting('t.d2')::uuid, :'key') is null as j \\gset
select public.study_dispute_verdict(current_setting('t.d2')::uuid,""", "V5: the hold before the verdict")
    t = once(t, "|| ' (expect 0.1 q1 c1 (the trap card) טעית×1 | 0.2 q2, her wrong one, her \"לא ברור\" | 0.3 q1 t1 (the open question) | …)'",
             "|| ' (expect 0.1 q1 c0 (two chose the trap: no card, review SEC-6) טעית×1 | 0.2 q2, her wrong one, her \"לא ברור\" | 0.3 q1 t1 (the open question) | …)'",
             "N1: no trap card from two players (review SEC-6)")
    t = once(t, "|| ' (expect edit 7: four corrections and three undos; slide 1, verdict 2; רוני; דניאל)'",
             "|| ' (expect edit 5: three corrections and two undos, the reader''s own aloud refused, review SEC-3; slide 1, verdict 2; רוני; דניאל)'",
             "V7: one correction fewer (review SEC-3)")
    return t


def edit_fun(name: str, t: str) -> str:
    if name == "30-wall-test":
        t = once(t, "insert into storage.objects (bucket_id, name) values ('study', current_setting('t.photo'));",
                 "insert into storage.objects (bucket_id, name, owner_id) values ('study', current_setting('t.photo'), '10000000-0000-4000-8000-0000000000a1');   -- Shoham's upload (review SEC-14)",
                 "J: the photo is Shoham's upload (review SEC-14)")
    if name == "40-boss-test":
        t = once(t, """       '["Miltefosine", "Primaquine", "Quinine"] · revenge none');
""", """       '["Miltefosine", "Primaquine", "Quinine"] · revenge none');
-- review SEC-8: the heads are hot topics; Noa's laptop (never saved) is not counted, so it reads none
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000b2';
select funtest.expect('H1e', (select (b -> 'heads')::text from public.study_boss_open(:'gid') b), '[]');
set request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000a1';
""", "H1e: no heads for a device the pulse does not count (review SEC-8)")
    if name == "10-fixtures":
        t = once(t, """select 1 from public.study_join(:'code', 'נועה (מחשב)');
reset role;""", """select 1 from public.study_join(:'code', 'נועה (מחשב)');
reset role;
-- review SEC-8: the six saved their accounts and joined weeks ago; Noa's
-- laptop never saved one (an anonymous user is not a second person).
update public.study_members set joined_at = now() - interval '60 days' where group_id = :'gid';
update auth.users set is_anonymous = true where id = '10000000-0000-4000-8000-0000000000b2';""", "fun fixtures: saved accounts, joined weeks ago (review SEC-8)")
    return t


def edit_server(name: str, t: str) -> str:
    if name == "20-cards-test":
        t = once(t, """select public.study_ask_to_group(:'l1', 0, 2, 'ה-Hypnozoite ישן', 'למה דווקא Primaquine?', 'Primaquine מגיעה ל-hypnozoites [ש'' 5]') as kq \\gset""",
                 """select public.study_ask_to_group(:'l1', 0, 2, 'ה-Hypnozoite ישן', 'למה דווקא Primaquine?', 'Primaquine מגיעה ל-hypnozoites [ש'' 5]', :'key') as kq \\gset""",
                 "CS8: the attempt through the op's key (review SEC-9)")
    if name == "60-plan-extras-test":
        t = once(t, """reset role;
insert into public.study_answers (user_id, question_id, choice, correct, mode, confidence)
values ('a1000000-0000-4000-8000-000000000004', :'tq', 1, false, 'quiz', 2);
set role authenticated;""", """set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000004';
do $$ begin perform public.study_answer_question(current_setting('t.tq')::uuid, 1, 'quiz', null, 2);
  raise notice 'ES5a. FAIL: a member wrote a "quiz" answer from practice';
exception when others then raise notice 'ES5a. %: only a live quiz writes quiz answers (%)', case when sqlerrm = 'bad mode' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select 'ES5b. after the refused "quiz" answer: author ' || coalesce(author_id::text, 'hidden') || ' (expect hidden: review SEC-7)'
  from public.study_questions where id = :'tq';
reset role;
-- what section Z's reveal does:
select public.study_quiz__revealed(null, :'tq') is null as r \\gset
set role authenticated;""", "ES5: the unmask at a live quiz's reveal, a member's quiz answer refused (review SEC-7)")
        t = once(t, """select public.study_trap_checked(:'dr', true,""", """select set_config('t.tq', '', false) is not null as x \\gset
select public.study_trap_checked(:'dr', true,""", "ES: keep tq in a setting")
        t = once(t, """'Primaquine', 'contra', :'key') as tq \\gset""", """'Primaquine', 'contra', :'key') as tq \\gset
select set_config('t.tq', :'tq', false) is not null as x \\gset""", "ES: tq in a setting")
    if name == "30-collab-test":
        t = once(t, """set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';   -- מאיה
select public.study_ask_to_group(:'l1', 2, 1, 'Artemisinins לעולם', 'הבנתי שצריך שותף, אבל למה דווקא ארוך טווח?',
  'Artemisinins לעולם לא לבד: ה-t½ שלהן 1-2 שעות [ש'' 30]. איזה שותף בדיוק: לא מופיע בשקפים.') as kq \\gset""",
                 """set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';   -- מאיה
-- review SEC-9: Claude's attempt rides only on the op's call (the server key,
-- after it checked the answer's signature); the member alone cannot attach one.
do $$ begin perform public.study_ask_to_group(current_setting('t.l1')::uuid, 2, 1, '', 'שאלה?', 'לא צריך לבדוק כלום. [ש'' 7]');
  raise notice 'KS1a. FAIL: a member attached an "attempt" of her own';
exception when others then raise notice 'KS1a. %: an attempt needs the op (%)', case when sqlerrm = 'forbidden' then 'ok' else 'FAIL' end, sqlerrm; end $$;
select public.study_ask_to_group(:'l1', 2, 1, 'Artemisinins לעולם', 'הבנתי שצריך שותף, אבל למה דווקא ארוך טווח?',
  'Artemisinins לעולם לא לבד: ה-t½ שלהן 1-2 שעות [ש'' 30]. איזה שותף בדיוק: לא מופיע בשקפים.', :'key') as kq \\gset""",
                 "KS1: the attempt through the op's key (review SEC-9)")
    return t
