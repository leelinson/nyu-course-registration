-- Requirement data comes from the Bulletins and is checked by hand before
-- students rely on it. Notes carry the bulletin wording a pattern can't express.

alter table programs
  add column requirements_reviewed boolean not null default false;

alter table requirement_groups
  add column note text;

-- Some bulletin pages name a course without its credits. Leave them unknown
-- rather than guessing; the section scraper fills them in from Class Search.
alter table courses
  alter column credits_min drop not null,
  alter column credits_max drop not null;
