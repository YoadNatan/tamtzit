-- ════════════════════════════════════════════════════════════════════════
--  SECTION W, its end · HARDENING (package W, milestone W2)
--  Appended at the END of section W by W's follow-up pull request, once
--  W-1's server code is live (§9.1 step 4.7). From then on no code writes a
--  part or a lecture's writing state with a member's token (the browser never
--  did: src/study/lib/api.ts only reads study_sections; outline.ts and
--  section.ts now go through the RPCs with the server key). These lines come
--  after the file's own grants (study-schema.sql L301-L306), so every later
--  run of the file keeps them. Corrections (VITE_STUDY_CORRECTIONS) wait for
--  this: a correction's author and undo mean nothing if a member's token can
--  rewrite or delete the part directly (review M1).
-- ════════════════════════════════════════════════════════════════════════
revoke insert, update, delete on public.study_sections from authenticated;
grant select on public.study_sections to authenticated;
revoke update on public.study_lectures from authenticated;
grant update (title, lecturer, course, lecture_date, updated_at) on public.study_lectures to authenticated;

insert into study_private.schema_sections (section, version) values ('W', 2)
on conflict (section) do update set version = excluded.version, loaded_at = now();

