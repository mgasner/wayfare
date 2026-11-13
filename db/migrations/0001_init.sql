create table city (
  id text primary key,
  name text not null,
  country text not null,
  tz text not null,
  currency text not null,
  languages text not null,
  bbox text not null,
  config text not null
);

create table area (
  id text primary key,
  city text not null references city,
  name text not null,
  lat real,
  lng real,
  polygon text,
  brief text,
  stops text not null default '[]'
);

create table place (
  id text primary key,
  city text not null references city,
  area text references area,
  name text not null,
  kind text check (kind in ('reserve_ahead', 'bookable', 'walk_in', 'informal')),
  google_place_id text unique,
  overture_id text unique,
  lat real,
  lng real,
  channels text not null default '[]',
  summary text,
  links text not null default '[]',
  curated integer not null default 0
);
create index place_city on place (city, curated);

create table fact (
  place text not null references place,
  field text not null,
  value text not null,
  source text not null,
  checked_at text not null,
  primary key (place, field, source)
);

create table slot_read (
  place text not null references place,
  date text not null,
  party integer not null,
  service text not null default '',
  times text not null,
  waitlist text not null default '[]',
  checked_at text not null,
  interaction text not null,
  primary key (place, date, party, service)
);

create table app_user (
  id text primary key,
  email text not null unique,
  name text not null,
  picture text,
  created_at text not null
);

create table trip (
  id text primary key,
  owner text not null references app_user,
  city text not null references city,
  start_date text not null,
  end_date text not null,
  party integer not null,
  base text not null,
  appetite text,
  budget text,
  diet text,
  booking text,
  refresh text not null default 'standard',
  created_at text not null
);
create index trip_owner on trip (owner);

create table anchor (
  id text primary key,
  trip text not null references trip,
  date text not null,
  start_time text,
  end_time text,
  area text references area,
  place text,
  lat real,
  lng real,
  source text not null check (source in ('hint', 'calendar')),
  text text,
  calendar_event text
);
create index anchor_trip on anchor (trip, date);

create table meal (
  id text primary key,
  trip text not null references trip,
  place text not null references place,
  date text not null,
  slot text not null check (slot in ('lunch', 'dinner', 'other')),
  time text,
  status text not null check (status in ('want', 'requested', 'confirmed', 'waitlist', 'failed', 'skipped')),
  channel text,
  note text,
  updated_at text not null
);
create index meal_trip on meal (trip, date);

create table save (
  owner text not null references app_user,
  place text not null references place,
  source text,
  note text,
  notify_nearby integer not null default 0,
  created_at text not null,
  primary key (owner, place)
);

create table interaction (
  id text primary key,
  parent text,
  at text not null,
  owner text,
  place text,
  channel text not null,
  kind text not null,
  outcome text not null check (outcome in ('ok', 'empty', 'error', 'timeout', 'blocked')),
  error text,
  latency_ms integer,
  cost_usd real,
  fallback text,
  request text
);
create index interaction_at on interaction (at);

create table interaction_private (
  interaction text primary key references interaction,
  owner text not null,
  payload text not null,
  media text
);

create table media (
  id text primary key,
  owner text not null references app_user,
  kind text not null,
  mime text not null,
  bytes blob not null,
  created_at text not null
);

create table calendar_link (
  owner text not null references app_user,
  provider text not null check (provider in ('google', 'ics')),
  ref text not null,
  credentials text,
  last_sync text,
  primary key (owner, provider, ref)
);
