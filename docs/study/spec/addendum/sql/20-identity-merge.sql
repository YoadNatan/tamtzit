  -- ════ spec §12 (the addenda): every user column of Q's, Z's, C's, K's and P's ends and of
  --      sections M N V U J H B G E T joins the merge (checks ME64, I17, MG*, M0-M7, MS*) ════
  -- ── meeting addendum (design.md §9): sections Q's and C's end, K's end, M, V, T ──
  if to_regclass('public.study_questions') is not null then
    update public.study_questions set checked_by = dst where checked_by = src;
  end if;
  if to_regclass('public.study_cards') is not null then
    update public.study_cards set checked_by = dst where checked_by = src;
  end if;
  if to_regclass('public.study_edit_proposals') is not null then
    update public.study_edit_proposals set proposed_by = dst where proposed_by = src;
    update public.study_edit_proposals set approved_by = dst where approved_by = src;
    update public.study_edits set approved_by = dst where approved_by = src;
  end if;
  if to_regclass('public.study_meetings') is not null then
    update public.study_meetings set created_by = dst where created_by = src;
    update public.study_meetings set updated_by = dst where updated_by = src;
    update public.study_meetings set planned_reader = dst where planned_reader = src;
    update public.study_meetings set reader_id = dst where reader_id = src;
    update public.study_meeting_events set created_by = dst where created_by = src;
    -- one "לא ברור" a paragraph a meeting: the account's stays
    delete from public.study_meeting_taps s
     where s.user_id = src
       and exists (select 1 from public.study_meeting_taps d
                    where d.user_id = dst and d.meeting_id = s.meeting_id and d.part_idx = s.part_idx and d.anchor = s.anchor);
    update public.study_meeting_taps set user_id = dst where user_id = src;
    -- presence: one row a meeting, the earlier first and the later last
    update public.study_meeting_presence d set first_at = least(d.first_at, s.first_at), last_at = greatest(d.last_at, s.last_at)
      from public.study_meeting_presence s
     where s.user_id = src and d.user_id = dst and d.meeting_id = s.meeting_id;
    delete from public.study_meeting_presence s
     where s.user_id = src and exists (select 1 from public.study_meeting_presence d where d.user_id = dst and d.meeting_id = s.meeting_id);
    update public.study_meeting_presence set user_id = dst where user_id = src;
    delete from public.study_meeting_guess_answers s
     where s.user_id = src
       and exists (select 1 from public.study_meeting_guess_answers d
                    where d.user_id = dst and d.meeting_id = s.meeting_id and d.question_id = s.question_id);
    update public.study_meeting_guess_answers set user_id = dst where user_id = src;
    delete from public.study_meeting_catchups s
     where s.user_id = src and exists (select 1 from public.study_meeting_catchups d where d.user_id = dst and d.meeting_id = s.meeting_id);
    update public.study_meeting_catchups set user_id = dst where user_id = src;
  end if;
  if to_regclass('public.study_disputes') is not null then
    update public.study_disputes set author_a = dst where author_a = src;
    update public.study_disputes set author_b = dst where author_b = src;
    update public.study_disputes set decided_by = dst where decided_by = src;
    delete from public.study_dispute_backs s
     where s.user_id = src and exists (select 1 from public.study_dispute_backs d where d.user_id = dst and d.dispute_id = s.dispute_id);
    update public.study_dispute_backs set user_id = dst where user_id = src;
    update public.study_slide_flags set created_by = dst where created_by = src;
    update public.study_slide_flags set removed_by = dst where removed_by = src;
    delete from public.study_updates s
     where s.user_id = src and exists (select 1 from public.study_updates d where d.user_id = dst and d.edit_id = s.edit_id);
    update public.study_updates set user_id = dst where user_id = src;
  end if;
  if to_regclass('public.study_member_prefs') is not null then
    delete from public.study_member_prefs s
     where s.user_id = src and exists (select 1 from public.study_member_prefs d where d.user_id = dst and d.group_id = s.group_id);
    update public.study_member_prefs set user_id = dst where user_id = src;
  end if;

  -- ── addendum "fun": the pulse (U), the wall (J), the boss (H) ──
  if to_regclass('public.study_pulse_optout') is not null then
    -- Out of the pulse on either device: the account stays out.
    delete from public.study_pulse_optout s
     where s.user_id = src
       and exists (select 1 from public.study_pulse_optout d where d.group_id = s.group_id and d.user_id = dst);
    update public.study_pulse_optout set user_id = dst where user_id = src;
  end if;
  if to_regclass('public.study_aids') is not null then
    -- One vote of each kind per person and entry: where both voted, one stays and the total drops by one.
    update public.study_aids a
       set funny_n = greatest(0, a.funny_n - x.f), stuck_n = greatest(0, a.stuck_n - x.s)
      from (select v.aid_id, count(*) filter (where v.kind = 'funny') as f, count(*) filter (where v.kind = 'stuck') as s
              from public.study_aid_votes v
             where v.user_id = src
               and exists (select 1 from public.study_aid_votes d where d.aid_id = v.aid_id and d.kind = v.kind and d.user_id = dst)
             group by v.aid_id) x
     where a.id = x.aid_id;
    delete from public.study_aid_votes v
     where v.user_id = src
       and exists (select 1 from public.study_aid_votes d where d.aid_id = v.aid_id and d.kind = v.kind and d.user_id = dst);
    update public.study_aid_votes set user_id = dst where user_id = src;
    update public.study_aid_authors set user_id = dst where user_id = src;
    -- Nobody votes for their own entry: a vote one device gave the other's entry goes.
    update public.study_aids a
       set funny_n = greatest(0, a.funny_n - x.f), stuck_n = greatest(0, a.stuck_n - x.s)
      from (select v.aid_id, count(*) filter (where v.kind = 'funny') as f, count(*) filter (where v.kind = 'stuck') as s
              from public.study_aid_votes v
              join public.study_aid_authors w on w.aid_id = v.aid_id and w.user_id = v.user_id
             where v.user_id = dst
             group by v.aid_id) x
     where a.id = x.aid_id;
    delete from public.study_aid_votes v
     using public.study_aid_authors w
     where w.aid_id = v.aid_id and w.user_id = v.user_id and v.user_id = dst;
    update public.study_aids set named_by = dst where named_by = src;
    update public.study_aids set credit_id = dst where credit_id = src;
    update public.study_aids set flagged_by = dst where flagged_by = src;
    -- Pins: one per paragraph; the account's stays.
    delete from public.study_aid_pins s
     where s.user_id = src
       and exists (select 1 from public.study_aid_pins d
                    where d.user_id = dst and d.lecture_id = s.lecture_id and d.part_idx = s.part_idx and d.anchor = s.anchor);
    update public.study_aid_pins set user_id = dst where user_id = src;
    update public.study_aid_credits set user_id = dst where user_id = src;
  end if;
  if to_regclass('public.study_loot') is not null then
    delete from public.study_loot s
     where s.user_id = src
       and exists (select 1 from public.study_loot d where d.user_id = dst and d.quiz_id = s.quiz_id and d.question_id = s.question_id);
    update public.study_loot set user_id = dst where user_id = src;
  end if;

  -- ── server addendum (design.md §8.4): Q's, C's and K's ends, B, G, E ──
  if to_regclass('public.study_questions') is not null then
    update public.study_questions set fixed_by = dst where fixed_by = src;
  end if;
  if to_regclass('public.study_card_adoptions') is not null then
    -- Parts both devices added stay added, once.
    delete from public.study_card_adoptions s
     where s.user_id = src
       and exists (select 1 from public.study_card_adoptions d
                    where d.user_id = dst and d.lecture_id = s.lecture_id and d.part_idx = s.part_idx);
    update public.study_card_adoptions set user_id = dst where user_id = src;
  end if;
  if to_regclass('public.study_my_cards') is not null then
    -- One private card per question and per thread: the one with more reviews stays.
    delete from public.study_my_cards s
     where s.user_id = src
       and exists (select 1 from public.study_my_cards d
                    where d.user_id = dst and d.reps >= s.reps
                      and ((s.question_id is not null and d.question_id = s.question_id)
                           or (s.comment_id is not null and d.comment_id = s.comment_id)));
    delete from public.study_my_cards d
     where d.user_id = dst
       and exists (select 1 from public.study_my_cards s
                    where s.user_id = src
                      and ((s.question_id is not null and d.question_id = s.question_id)
                           or (s.comment_id is not null and d.comment_id = s.comment_id)));
    update public.study_my_cards set user_id = dst where user_id = src;
    update public.study_my_card_reviews set user_id = dst where user_id = src;
  end if;
  update public.study_comments set resolved_by = dst where resolved_by = src;
  if to_regclass('study_private.bank_jobs') is not null then
    update study_private.bank_jobs set requested_by = dst where requested_by = src;
  end if;
  if to_regclass('public.study_group_plans') is not null then
    update public.study_group_plans set created_by = dst where created_by = src;
    update public.study_group_plans set updated_by = dst where updated_by = src;
  end if;
  if to_regclass('public.study_trap_drafts') is not null then
    update public.study_trap_drafts set user_id = dst where user_id = src;
    update public.study_questions set author_id = dst where author_id = src;
  end if;

