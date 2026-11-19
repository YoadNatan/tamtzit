-- ── Additions to supabase/tests/stubs.sql (package F, F1Δ; spec §12.2) ──
-- Two columns Supabase Storage has and the local stand-in lacked: who
-- uploaded an object (owner_id, the uploader's auth.uid() as text, set by
-- the Storage API), and a bucket's limits (review SEC-14).
alter table storage.objects add column if not exists owner_id text;
alter table storage.buckets add column if not exists file_size_limit bigint;
alter table storage.buckets add column if not exists allowed_mime_types text[];
