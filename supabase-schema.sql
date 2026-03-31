-- ============================================
-- AUCTION VAULT — Supabase Database Schema
-- Run this in Supabase SQL Editor (supabase.com → your project → SQL Editor)
-- ============================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ─── INVOICES ───
create table public.invoices (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date date,
  auction_house text,
  invoice_number text,
  event_description text,
  payment_method text,
  payment_status text default 'Unknown',
  pickup_location text,
  buyer_premium_rate numeric(5,4) default 0,
  tax_rate numeric(5,4) default 0.13,
  lot_total numeric(12,2) default 0,
  premium_total numeric(12,2) default 0,
  tax_total numeric(12,2) default 0,
  grand_total numeric(12,2) default 0,
  file_name text,
  file_type text,
  file_path text,
  item_count integer default 0,
  created_at timestamptz default now()
);

-- ─── ITEMS (Inventory) ───
create table public.items (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  invoice_id uuid references public.invoices(id) on delete cascade,
  lot_number text,
  title text not null,
  description text,
  quantity integer default 1,
  hammer_price numeric(12,2) default 0,
  premium_rate numeric(5,4) default 0,
  tax_rate numeric(5,4) default 0.13,
  premium_amount numeric(12,2) default 0,
  subtotal numeric(12,2) default 0,
  tax_amount numeric(12,2) default 0,
  total_cost numeric(12,2) default 0,
  auction_house text,
  date date,
  pickup_location text,
  payment_method text,
  status text default 'in_inventory',
  created_at timestamptz default now()
);

-- ─── SOLD ITEMS ───
create table public.sold_items (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  invoice_id uuid references public.invoices(id) on delete set null,
  item_id uuid,
  lot_number text,
  title text not null,
  description text,
  quantity integer default 1,
  hammer_price numeric(12,2) default 0,
  premium_rate numeric(5,4) default 0,
  tax_rate numeric(5,4) default 0.13,
  premium_amount numeric(12,2) default 0,
  subtotal numeric(12,2) default 0,
  tax_amount numeric(12,2) default 0,
  total_cost numeric(12,2) default 0,
  auction_house text,
  date date,
  pickup_location text,
  payment_method text,
  sold_price numeric(12,2) default 0,
  sold_platform text,
  sold_buyer text,
  sold_buyer_email text,
  sold_buyer_phone text,
  sold_at timestamptz default now(),
  receipt_number text,
  receipt_html text,
  profit numeric(12,2) default 0,
  profit_pct numeric(8,2) default 0,
  created_at timestamptz default now()
);

-- ─── CUSTOMERS ───
create table public.customers (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  email text,
  phone text,
  first_purchase timestamptz default now(),
  created_at timestamptz default now()
);

-- ─── ITEM PHOTOS (metadata — actual files in Supabase Storage) ───
create table public.item_photos (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  item_id uuid,
  sold_item_id uuid,
  file_path text not null,
  file_name text,
  created_at timestamptz default now()
);

-- ─── LIFECYCLE EVENTS ───
create table public.lifecycle_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  item_id uuid,
  sold_item_id uuid,
  event text not null,
  detail text,
  created_at timestamptz default now()
);

-- ─── BUSINESS SETTINGS ───
create table public.settings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  business_name text,
  address text,
  phone text,
  email text,
  hst text,
  updated_at timestamptz default now()
);

-- ============================================
-- ROW LEVEL SECURITY — Users only see their own data
-- ============================================

alter table public.invoices enable row level security;
alter table public.items enable row level security;
alter table public.sold_items enable row level security;
alter table public.customers enable row level security;
alter table public.item_photos enable row level security;
alter table public.lifecycle_events enable row level security;
alter table public.settings enable row level security;

-- Invoices
create policy "Users see own invoices" on public.invoices for select using (auth.uid() = user_id);
create policy "Users insert own invoices" on public.invoices for insert with check (auth.uid() = user_id);
create policy "Users update own invoices" on public.invoices for update using (auth.uid() = user_id);
create policy "Users delete own invoices" on public.invoices for delete using (auth.uid() = user_id);

-- Items
create policy "Users see own items" on public.items for select using (auth.uid() = user_id);
create policy "Users insert own items" on public.items for insert with check (auth.uid() = user_id);
create policy "Users update own items" on public.items for update using (auth.uid() = user_id);
create policy "Users delete own items" on public.items for delete using (auth.uid() = user_id);

-- Sold items
create policy "Users see own sold" on public.sold_items for select using (auth.uid() = user_id);
create policy "Users insert own sold" on public.sold_items for insert with check (auth.uid() = user_id);
create policy "Users update own sold" on public.sold_items for update using (auth.uid() = user_id);
create policy "Users delete own sold" on public.sold_items for delete using (auth.uid() = user_id);

-- Customers
create policy "Users see own customers" on public.customers for select using (auth.uid() = user_id);
create policy "Users insert own customers" on public.customers for insert with check (auth.uid() = user_id);
create policy "Users update own customers" on public.customers for update using (auth.uid() = user_id);
create policy "Users delete own customers" on public.customers for delete using (auth.uid() = user_id);

-- Photos
create policy "Users see own photos" on public.item_photos for select using (auth.uid() = user_id);
create policy "Users insert own photos" on public.item_photos for insert with check (auth.uid() = user_id);
create policy "Users delete own photos" on public.item_photos for delete using (auth.uid() = user_id);

-- Lifecycle
create policy "Users see own lifecycle" on public.lifecycle_events for select using (auth.uid() = user_id);
create policy "Users insert own lifecycle" on public.lifecycle_events for insert with check (auth.uid() = user_id);

-- Settings
create policy "Users see own settings" on public.settings for select using (auth.uid() = user_id);
create policy "Users upsert own settings" on public.settings for insert with check (auth.uid() = user_id);
create policy "Users update own settings" on public.settings for update using (auth.uid() = user_id);

-- ============================================
-- STORAGE BUCKETS
-- Run these in SQL Editor too
-- ============================================

insert into storage.buckets (id, name, public) values ('invoice-files', 'invoice-files', false);
insert into storage.buckets (id, name, public) values ('product-photos', 'product-photos', false);

-- Storage RLS — users access only their folder (user_id/filename)
create policy "Users upload own invoice files"
  on storage.objects for insert
  with check (bucket_id = 'invoice-files' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users read own invoice files"
  on storage.objects for select
  using (bucket_id = 'invoice-files' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users delete own invoice files"
  on storage.objects for delete
  using (bucket_id = 'invoice-files' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users upload own product photos"
  on storage.objects for insert
  with check (bucket_id = 'product-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users read own product photos"
  on storage.objects for select
  using (bucket_id = 'product-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users delete own product photos"
  on storage.objects for delete
  using (bucket_id = 'product-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================
-- INDEXES for performance
-- ============================================

create index idx_items_user on public.items(user_id);
create index idx_items_invoice on public.items(invoice_id);
create index idx_sold_user on public.sold_items(user_id);
create index idx_invoices_user on public.invoices(user_id);
create index idx_lifecycle_item on public.lifecycle_events(item_id);
create index idx_lifecycle_sold on public.lifecycle_events(sold_item_id);
create index idx_photos_item on public.item_photos(item_id);
create index idx_photos_sold on public.item_photos(sold_item_id);
