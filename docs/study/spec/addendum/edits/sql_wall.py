"""Section J (package J): the fun design's association wall, with the
review's fix (§12.10): a post attaches only a photo its poster uploaded
(storage's owner_id) and not already on another entry (SEC-14)."""
from lib import once


def build(texts: list[str]) -> str:
    (t,) = texts
    return fix(t)


def fix(t: str) -> str:
    t = once(t, """                                  or not exists (select 1 from storage.objects o where o.bucket_id = 'study' and o.name = p_photo))) then""",
             """                                  or not exists (select 1 from storage.objects o
                                                  where o.bucket_id = 'study' and o.name = p_photo
                                                    and o.owner_id = auth.uid()::text)          -- review SEC-14: her own upload
                                  or exists (select 1 from public.study_aids x where x.photo = p_photo))) then""",
             "SEC-14: only one's own upload, once")
    return t
