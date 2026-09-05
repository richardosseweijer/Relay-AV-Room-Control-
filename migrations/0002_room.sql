create table if not exists room_store (
  id text primary key,
  config_json text not null,
  drivers_json text not null,
  state_json text not null,
  updated_at timestamptz not null default now()
);
