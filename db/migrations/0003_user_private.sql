-- Personal data per user, out of trip rows and interaction.request. Only its owner's entrypoints read it.
create table user_private (
  owner text primary key references app_user,
  passport text,             -- null when cleared
  updated_at text not null
);

-- Whether a passport is on file is now user_private.passport, not part of each trip.
update trip set booking = json_remove(booking, '$.passport_on_file') where booking is not null;
