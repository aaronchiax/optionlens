-- OptionLens — user accounts & saved analyses (Supabase / PostgreSQL)
-- Not yet wired into the app: the MVP uses LocalStorageRepository. A SupabaseRepository
-- implementing src/lib/user-data/repository.ts#UserDataRepository maps onto these tables.

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  disclaimer_acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null default 'My Watchlist',
  created_at timestamptz not null default now()
);

create table if not exists watchlist_items (
  watchlist_id uuid not null references watchlists on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z0-9.\-^=]{1,15}$'),
  added_at timestamptz not null default now(),
  primary key (watchlist_id, symbol)
);

-- A scenario = the user's market view for a symbol
create table if not exists scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  symbol text not null,
  target_price numeric not null check (target_price > 0),
  horizon text not null check (horizon in ('1w','2w','1m','2m','3m','6m','12m')),
  outlook text not null check (outlook in ('bullish','moderately_bullish','neutral','moderately_bearish','bearish')),
  preference text not null default 'all',
  max_capital numeric,
  max_loss numeric,
  created_at timestamptz not null default now()
);

-- A saved analysis run: snapshot of market context + generated strategies (as JSON)
create table if not exists analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  scenario_id uuid not null references scenarios on delete cascade,
  spot_at_run numeric not null,
  expiration date,
  data_provider text not null,
  data_type text not null check (data_type in ('realtime','delayed','simulated')),
  data_as_of timestamptz,
  strategies jsonb not null,
  note text,
  created_at timestamptz not null default now()
);

-- Individually saved strategies (incl. custom builder positions)
create table if not exists saved_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  analysis_id uuid references analyses on delete set null,
  symbol text not null,
  template_id text not null,
  label text not null,
  legs jsonb not null,
  metrics jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists analyses_user_created_idx on analyses (user_id, created_at desc);
create index if not exists scenarios_user_symbol_idx on scenarios (user_id, symbol);

-- Row-level security: users only see their own rows
alter table profiles enable row level security;
alter table watchlists enable row level security;
alter table watchlist_items enable row level security;
alter table scenarios enable row level security;
alter table analyses enable row level security;
alter table saved_strategies enable row level security;

create policy "own profile" on profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own watchlists" on watchlists for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own watchlist items" on watchlist_items for all
  using (exists (select 1 from watchlists w where w.id = watchlist_id and w.user_id = auth.uid()))
  with check (exists (select 1 from watchlists w where w.id = watchlist_id and w.user_id = auth.uid()));
create policy "own scenarios" on scenarios for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own analyses" on analyses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own strategies" on saved_strategies for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
