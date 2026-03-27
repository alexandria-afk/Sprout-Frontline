-- Add asset_id to issues so staff can link a problem to a specific piece of equipment
alter table issues
  add column if not exists asset_id uuid references assets(id);

create index if not exists issues_asset_id_idx on issues(asset_id);
