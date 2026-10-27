-- Initial schema for the NYU course planner.
-- Three groups: catalog (what exists), requirements (what counts), offerings (what runs each term).

-- Catalog ------------------------------------------------------------------

create table schools (
  id          serial primary key,
  code        text not null unique,          -- e.g. UB (Stern), UT (Tisch), UA (CAS)
  name        text not null
);

create table programs (
  id            serial primary key,
  school_id     int  not null references schools(id),
  slug          text not null,               -- bulletin slug, e.g. economics-computer-science-ba
  name          text not null,
  degree        text not null,               -- BA, BS, BFA
  concentration text,                        -- e.g. Finance for Stern's BS in Business
  bulletin_url  text not null,
  catalog_year  text not null,               -- e.g. 2026-2027
  total_credits int,
  unique (slug, concentration, catalog_year)
);

create table courses (
  id           serial primary key,
  subject      text not null,                -- e.g. ECON-UA
  number       text not null,                -- text because of codes like 9001 or 1-UA
  title        text not null,
  credits_min  numeric(4,1) not null,
  credits_max  numeric(4,1) not null,
  description  text,
  unique (subject, number),
  check (credits_max >= credits_min)
);

create index courses_subject_idx on courses (subject);

-- rule is a tree: {"all": [...]}, {"any": [...]}, or {"course": "ECON-UA 1"}.
-- raw_text keeps the bulletin wording so a person can check the parse.
create table prerequisites (
  course_id  int primary key references courses(id) on delete cascade,
  rule       jsonb,
  raw_text   text not null,
  reviewed   boolean not null default false
);

-- Requirements -------------------------------------------------------------

create type requirement_rule as enum ('all', 'choose_n', 'credits_min');

create table requirement_groups (
  id          serial primary key,
  program_id  int  not null references programs(id) on delete cascade,
  parent_id   int  references requirement_groups(id) on delete cascade,
  position    int  not null default 0,       -- display order among siblings
  label       text not null,                 -- e.g. Core Courses, Select one of the following
  rule_type   requirement_rule not null,
  n           int,                           -- for choose_n
  credits     numeric(4,1),                  -- for credits_min
  check (rule_type <> 'choose_n'    or n is not null),
  check (rule_type <> 'credits_min' or credits is not null)
);

create index requirement_groups_program_idx on requirement_groups (program_id);
create index requirement_groups_parent_idx  on requirement_groups (parent_id);

-- A member is a specific course, or a pattern such as ECON-UA 3xx for
-- "any upper-level economics elective". Courses listed as "A or B" share an or_group.
create table requirement_courses (
  id              serial primary key,
  group_id        int  not null references requirement_groups(id) on delete cascade,
  course_id       int  references courses(id),
  subject_pattern text,                      -- SQL LIKE pattern on "SUBJECT NUMBER"
  or_group        int,
  check ((course_id is null) <> (subject_pattern is null))
);

create index requirement_courses_group_idx on requirement_courses (group_id);

-- Offerings ----------------------------------------------------------------

create table terms (
  id          serial primary key,
  code        text not null unique,          -- NYU term code, e.g. 1274
  name        text not null,                 -- e.g. Spring 2027
  start_date  date
);

create table sections (
  id            serial primary key,
  course_id     int  not null references courses(id),
  term_id       int  not null references terms(id),
  section_code  text not null,               -- e.g. 001
  class_number  text,                        -- Albert class number
  component     text,                        -- Lecture, Recitation, Lab
  mode          text,                        -- In-Person, Online, Blended
  status        text,                        -- Open, Closed, Wait List
  seats_open    int,
  seats_total   int,
  updated_at    timestamptz not null default now(),
  unique (term_id, course_id, section_code)
);

create index sections_course_term_idx on sections (course_id, term_id);

create table meetings (
  id          serial primary key,
  section_id  int  not null references sections(id) on delete cascade,
  days        text not null,                 -- e.g. MW, TR
  start_time  time,
  end_time    time,
  location    text
);

create table instructors (
  id              serial primary key,
  name            text not null,
  normalized_name text not null unique,      -- lowercase, no middle initials or punctuation
  rmp_id          text,
  rmp_url         text,
  rmp_rating      numeric(2,1),
  rmp_difficulty  numeric(2,1),
  rmp_count       int,
  rmp_match_ok    boolean,                   -- null = not matched yet, false = needs review
  updated_at      timestamptz not null default now()
);

create table section_instructors (
  section_id     int not null references sections(id) on delete cascade,
  instructor_id  int not null references instructors(id),
  primary key (section_id, instructor_id)
);

-- Public read access -------------------------------------------------------
-- Everything here is public catalog data. The app reads with the anon key;
-- scrapers write with the service role key, which bypasses RLS.

do $$
declare t text;
begin
  foreach t in array array[
    'schools', 'programs', 'courses', 'prerequisites', 'requirement_groups',
    'requirement_courses', 'terms', 'sections', 'meetings', 'instructors',
    'section_instructors'
  ] loop
    execute format('alter table %I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('create policy "public read" on %I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
