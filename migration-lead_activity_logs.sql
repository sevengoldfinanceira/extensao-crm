-- Seven Gold CRM — Lead Activity Logs
-- Create this table in your Supabase SQL editor before using the history feature.

create table if not exists public.lead_activity_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null,
  action_type text not null,
  action_label text not null,
  description text,
  old_value text,
  new_value text,
  created_by_email text,
  created_by_name text,
  created_by_role text,
  created_at timestamptz not null default now()
);

alter table public.lead_activity_logs enable row level security;

-- Policies
drop policy if exists "lead_activity_logs_select" on public.lead_activity_logs;
drop policy if exists "lead_activity_logs_insert" on public.lead_activity_logs;

create policy "lead_activity_logs_select"
on public.lead_activity_logs
for select
to authenticated
using (public.is_crm_user_active());

create policy "lead_activity_logs_insert"
on public.lead_activity_logs
for insert
to authenticated
with check (public.is_crm_user_active());

-- Index for faster queries by lead_id
create index if not exists idx_lead_activity_logs_lead_id on public.lead_activity_logs(lead_id);
create index if not exists idx_lead_activity_logs_created_at on public.lead_activity_logs(created_at desc);
