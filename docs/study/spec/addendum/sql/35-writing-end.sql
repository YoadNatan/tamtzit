-- ════════════════════════════════════════════════════════════════════════
--  SECTION W, its end · "להאזין" FROM THE MINUTE   (package W, milestone W4;
--  spec §12.3.W). Appended at the end of section W, inside its markers,
--  after W2's hardening. W keeps its version: W4's pull request carries it
--  with the notes' kinds, and only W4's code reads the column.
--
--  REC2: a recording host may name the query parameter that opens its player
--  at a second ("t" in "?t=2470"); Yoad sets it when he allows the host
--  (§9.1 step 8). Without it the box keeps the spec's "פתיחת ההקלטה" and
--  "העתקת הזמן".
-- ════════════════════════════════════════════════════════════════════════
alter table study_private.link_hosts
  add column if not exists time_param text check (time_param ~ '^[a-z_]{1,16}$');
