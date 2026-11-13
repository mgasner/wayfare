-- What one interpretation changed, so input.undo can revert exactly that.
create table input_undo (
  id text primary key,
  owner text not null references app_user,
  created_at text not null,
  interaction text,          -- the interpret call's interaction row
  media text,                -- the voice clip, null for typed input
  ops text not null,
  undone_at text
);
create index input_undo_created on input_undo (created_at);
