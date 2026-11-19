-- ════════════════════════════════════════════════════════════════════════
--  SECTION F, its end · WALL PHOTOS AND THE BUCKET'S LIMITS   (package F,
--  F1Δ; spec §12.2.6). Appended at the end of section F, inside its
--  markers, after F0's rule "the pictures stay with their lecture" (check
--  F28), which it repeats word for word and extends by one condition: the
--  last "study files delete" in the file is the one in force, so the
--  condition has to join section F's rule, not the storage block's above
--  it. F keeps its version (1). Re-runnable.
--
--  Review SEC-14: a wall photo (<group>/wall/<uuid>.jpg) is deleted only by
--  whoever uploaded it (the wall's "only the author deletes"; Supabase
--  records the uploader in storage.objects.owner_id). Every other file
--  keeps F0's rule. The bucket gets a size limit and the types the app
--  uploads (slide pictures and exam pages as JPEG, wall photos as JPEG or
--  WebP, the PDF cache), so the Storage API refuses anything else whatever
--  a phone sends. W5's pull request adds the audio types and raises the
--  limit to 50 MB if it stores audio (spec §12.3.W).
-- ════════════════════════════════════════════════════════════════════════
drop policy if exists "study files delete" on storage.objects;
create policy "study files delete" on storage.objects
  for delete using (
    bucket_id = 'study' and public.study_is_member_path(name)
    and not (split_part(name, '/', 3) ~ '^s[0-9]+-[0-9]+\.jpg$'
             and exists (select 1 from public.study_lectures l
                          where l.id::text = split_part(name, '/', 2)
                            and (l.deleted_at is null or l.deleted_at > now() - interval '30 days')))
    and (split_part(name, '/', 2) <> 'wall' or owner_id = auth.uid()::text));
update storage.buckets
   set file_size_limit = 26214400,                                   -- 25 MB: a long lecture's PDF
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
 where id = 'study';
