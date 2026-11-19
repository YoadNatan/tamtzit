-- Test fixture: a copy of the board app's schema (it lives in the other app's
-- repository and runs on the same Supabase project). The study tests load it
-- before study-schema.sql, because study-schema.sql patches its sign-up trigger
-- (board_handle_new_user) and the tests check that study users are skipped.
-- Never run this file on the real project from here.
-- ═══════════════════════════════════════════════════════════════════════
--  לוח היעדים — לוח תשובות שיתופי לכיתה.
--  להרצה פעם אחת: Supabase → SQL Editor → New query → הדביקו → Run.
--  בטוח להריץ שוב: הכול create-if-not-exists / drop-then-create.
--
--  יושב באותו פרויקט של לוח הלוגו ושל לוח הטיול. הוא נוגע אך ורק בשמות
--  שמתחילים ב-board_ , ולכן הטבלאות והמדיניות הקיימות נשארות בדיוק כפי שהן.
--
--  מודל הגישה — שונה מהותית משני הלוחות האחרים
--  ─────────────────────────────────────────────
--  לתלמידים אין חשבון. בכלל. הם נכנסים בקישור ציבורי, ופועלים מול מסד
--  הנתונים בתור התפקיד anon. זה מכוון: כיתה שלמה לא תירשם בהפסקה.
--  לכן ה-RLS כאן הוא לא שכבת נוחות אלא כל ההגנה, והוא בנוי כך:
--
--    • תלמיד קורא את מצב הלוח (השאלה, האם נחשף, האם נעול) — תמיד.
--    • תלמיד כותב תשובה — רק כשהלוח לא נעול, רק לסבב הפעיל, ורק עם שם.
--    • תלמיד קורא תשובות — רק אחרי שהמורה חשפה, ורק של הסבב הפעיל.
--      לפני החשיפה השאילתה מחזירה אפס שורות ברמת מסד הנתונים, לא ברמת
--      ממשק המשתמש. אי אפשר להציץ דרך ה-API.
--    • תלמיד לא יכול לשנות מצב, למחוק תשובה, או לגעת בסבבים קודמים.
--
--  המורה נכנסת עם חשבון (session אנונימי של Supabase נושא שם ומייל, בדיוק
--  כמו בלוח הטיול), והראשונה שנכנסת הופכת למורה. מרגע שיש מורה, אף אחד
--  אחר לא יכול להפוך לאחת — ה-RLS אוכף את זה, לא הדפדפן.
--
--  ⚠ סדר ההקמה שחשוב: הריצו את הקובץ הזה, היכנסו בעצמכם ל-/board/teacher
--     פעם אחת, ורק אחר כך שתפו את הקישור לתלמידים.
-- ═══════════════════════════════════════════════════════════════════════

-- ── מי מנהלת את הלוח ──
create table if not exists public.board_teachers (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  email      text        not null default '',
  name       text        not null default '',
  role       text        not null default 'guest' check (role in ('teacher', 'guest')),
  created_at timestamptz not null default now()
);

-- ── מצב הלוח. שורה אחת בדיוק: id בוליאני שחייב להיות true. ──
--
--    לסבב יש שתי שאלות: הראשונה בטקסט חופשי, השנייה בחירת מדינה מרשימה.
--    שתיהן חולקות את אותה חשיפה ואת אותה נעילה — המורה חושפת את התמונה
--    של הסבב, לא של שאלה בודדת.
create table if not exists public.board_state (
  id         boolean     primary key default true check (id),
  title      text        not null default 'לוח היעדים',
  question   text        not null default '',
  question2  text        not null default '',
  round      integer     not null default 1 check (round >= 1),
  revealed   boolean     not null default false,
  locked     boolean     not null default false,
  updated_at timestamptz not null default now()
);
insert into public.board_state (id) values (true) on conflict (id) do nothing;

-- מוסיף את השאלה השנייה ללוח שהוקם לפני שהיא הייתה קיימת
alter table public.board_state
  add column if not exists question2 text not null default '';

-- ── התשובות. כל תשובה נושאת את השם שהתלמיד הזין בכניסה.
--
--    השם הזה מוצהר ולא מאומת: אין לתלמידים חשבון, ולכן אין שום דבר שמונע
--    ממישהו להקליד שם אחר. הוא נועד לייחוס בכיתה, לא לזיהוי בטוח, ואסור
--    להשתמש בו למשהו שתלוי באמינות הזיהוי. ──
create table if not exists public.board_answers (
  id           uuid        primary key default gen_random_uuid(),
  round        integer     not null check (round >= 1),
  -- 1 = השאלה הפתוחה, 2 = בחירת המדינה
  slot         smallint    not null default 1 check (slot in (1, 2)),
  student_name text        not null default '' check (char_length(student_name) <= 40),
  body         text        not null check (char_length(btrim(body)) between 1 and 300),
  -- קוד ISO של המדינה שנבחרה בשאלה השנייה; ריק בשאלה הראשונה. הקוד ולא
  -- השם הוא המזהה, כדי ששינוי ניסוח של שם מדינה לא ישבור ספירה קיימת.
  country_code text        not null default '' check (char_length(country_code) <= 2),
  created_at   timestamptz not null default now()
);

-- מוסיף את עמודת השם ללוח שהוקם בגרסה מוקדמת יותר, שבה התשובות היו
-- אנונימיות. תשובות קיימות נשארות בלי שם ומוצגות כ"ללא שם".
alter table public.board_answers
  add column if not exists student_name text not null default '';

-- מוסיף את השיוך לשאלה ואת קוד המדינה ללוח מגרסה מוקדמת יותר. תשובות
-- קיימות נחשבות לשאלה הפתוחה, שהיא היחידה שהייתה אז.
alter table public.board_answers
  add column if not exists slot smallint not null default 1;
alter table public.board_answers
  add column if not exists country_code text not null default '';

do $$
begin
  alter table public.board_answers
    add constraint board_answers_slot_ck check (slot in (1, 2));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.board_answers
    add constraint board_answers_name_len check (char_length(student_name) <= 40);
exception when duplicate_object then null;
end $$;
create index if not exists board_answers_round_idx on public.board_answers (round, slot, created_at);

-- ── היסטוריית הסבבים: השאלה כפי שנשאלה, ומתי הסבב נסגר. ──
create table if not exists public.board_rounds (
  round      integer     primary key,
  question   text        not null default '',
  ended_at   timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════
--  עוזרים. SECURITY DEFINER כדי שבדיקת "האם זו המורה?" לא תיכנס שוב
--  למדיניות של board_teachers ותיצור רקורסיה. search_path מקובע כדי
--  שאי אפשר יהיה להסיט את הרשאות ההגדרה.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.board_is_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.board_teachers
    where user_id = auth.uid() and role = 'teacher'
  );
$$;

create or replace function public.board_open()
returns boolean language sql stable security definer set search_path = public as $$
  select not locked from public.board_state where id = true;
$$;

create or replace function public.board_revealed()
returns boolean language sql stable security definer set search_path = public as $$
  select revealed from public.board_state where id = true;
$$;

create or replace function public.board_round()
returns integer language sql stable security definer set search_path = public as $$
  select round from public.board_state where id = true;
$$;

-- ── כניסה חדשה → שורה בטבלת הצוות. הראשונה שנכנסת מנהלת את הלוח. ──
create or replace function public.board_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
begin
  -- משתמשי /study/ (תמצית) אינם צוות של הלוח. אותה פונקציה בדיוק מוגדרת גם
  -- ב-study-schema.sql; שמרו על השתיים זהות.
  if coalesce(new.raw_user_meta_data ->> 'app', '') = 'study' then
    return new;
  end if;

  select count(*) = 0 into first_user from public.board_teachers;

  insert into public.board_teachers (user_id, email, name, role)
  values (
    new.id,
    coalesce(nullif(new.email, ''), nullif(new.raw_user_meta_data ->> 'email', ''), ''),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, new.raw_user_meta_data ->> 'email', ''), '@', 1),
      'אורח'
    ),
    -- רק הראשונה. כל מי שנכנס אחריה הוא אורח בלי שום סמכות, וכדי לקדם
    -- אותו צריכה מורה קיימת ללחוץ על כך במסך הניהול.
    case when first_user then 'teacher' else 'guest' end
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_board on auth.users;
create trigger on_auth_user_created_board
  after insert on auth.users
  for each row execute function public.board_handle_new_user();

-- ═══════════════════════════════════════════════════════════════════════
--  Row Level Security
-- ═══════════════════════════════════════════════════════════════════════

alter table public.board_teachers enable row level security;
alter table public.board_state    enable row level security;
alter table public.board_answers  enable row level security;
alter table public.board_rounds   enable row level security;

do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename like 'board\_%'
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- ── הצוות: כל מי שמחובר רואה את השורה שלו; המורה רואה ומנהלת את כולן. ──
create policy "board team read self" on public.board_teachers
  for select using (user_id = auth.uid() or public.board_is_teacher());

create policy "board team rename self" on public.board_teachers
  for update using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    -- אורח לא מקדם את עצמו למורה
    and role = (select role from public.board_teachers t where t.user_id = auth.uid())
  );

create policy "board team manage" on public.board_teachers
  for update using (public.board_is_teacher()) with check (public.board_is_teacher());

create policy "board team remove" on public.board_teachers
  for delete using (public.board_is_teacher() and user_id <> auth.uid());

-- ── מצב הלוח: קריאה פתוחה לגמרי (כך תלמיד בלי חשבון רואה את השאלה),
--    כתיבה רק למורה. ──
create policy "board state read" on public.board_state
  for select using (true);
create policy "board state write" on public.board_state
  for update using (public.board_is_teacher()) with check (public.board_is_teacher());

-- ── התשובות ──
-- קריאה: המורה תמיד; תלמיד רק אחרי חשיפה, ורק את הסבב הפעיל. סבבים
-- קודמים לא נחשפים לכיתה גם אחרי חשיפה — הם היסטוריה של המורה.
create policy "board answers read" on public.board_answers
  for select using (
    public.board_is_teacher()
    or (public.board_revealed() and round = public.board_round())
  );

-- כתיבה: כל אחד עם הקישור, כל עוד הלוח פתוח, התשובה שייכת לסבב הפעיל,
-- ויש בה שם. דרישת השם נאכפת כאן ולא רק בטופס, כדי שגם פנייה ישירה ל-API
-- לא תוכל להשאיר תשובה בלי ייחוס.
create policy "board answers write" on public.board_answers
  for insert with check (
    public.board_open()
    and round = public.board_round()
    and char_length(btrim(student_name)) > 0
    -- בחירת מדינה חייבת לשאת קוד; תשובה פתוחה חייבת לא לשאת אחד. כך
    -- הספירה של השאלה השנייה לא יכולה להתלכלך בטקסט חופשי.
    and (
      (slot = 1 and country_code = '')
      or (slot = 2 and char_length(country_code) = 2)
    )
  );

-- מחיקה: המורה בלבד (תוכן לא ראוי). תלמיד לא מוחק — גם לא את שלו, כי השם
-- מוצהר ולא מאומת, ולכן "זו שלי" אינה טענה שאפשר לבדוק.
create policy "board answers delete" on public.board_answers
  for delete using (public.board_is_teacher());

-- אף אחד לא עורך תשובה קיימת. אין policy ל-update, ולכן היא אסורה.

-- ── היסטוריית סבבים: קריאה למורה, כתיבה למורה. ──
create policy "board rounds read"  on public.board_rounds
  for select using (public.board_is_teacher());
create policy "board rounds write" on public.board_rounds
  for insert with check (public.board_is_teacher());
create policy "board rounds update" on public.board_rounds
  for update using (public.board_is_teacher()) with check (public.board_is_teacher());

-- ═══════════════════════════════════════════════════════════════════════
--  Realtime: כדי שמונה התשובות אצל המורה ושינוי שאלה/חשיפה/נעילה אצל
--  התלמידים יתעדכנו תוך שניות ובלי רענון.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['board_state', 'board_answers', 'board_teachers'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null;  -- כבר מפורסם, תקין בהרצה חוזרת
    end;
  end loop;
end $$;
