-- Places made from one person's free-form input are theirs alone until research or a provider confirms them.
alter table place add column created_by text references app_user;
create index place_created_by on place (created_by) where created_by is not null;

-- Rows input.interpret made before this: uncurated, no Overture or Google id, named in someone's input_undo.
update place set created_by = (
  select input_undo.owner from input_undo, json_each(input_undo.ops) op
  where json_extract(op.value, '$.table') = 'place' and json_extract(op.value, '$.key.id') = place.id
  limit 1
)
where curated = 0 and overture_id is null and google_place_id is null;
