-- Stable public references shared by loads and available trucks.
-- Registry rows survive deletion; public clients can only read the identifiers.
create sequence private.ad_reference_seq start with 3000;
create table public.ad_references (
  ad_id uuid primary key,
  ad_number bigint not null unique default nextval('private.ad_reference_seq'),
  ad_kind text not null check (ad_kind in ('load','truck'))
);
alter table public.ad_references enable row level security;
revoke all on public.ad_references from public, anon, authenticated;
grant select on public.ad_references to anon, authenticated;
create policy public_reference_read on public.ad_references for select to anon, authenticated using (true);
-- Serialize the backfill with incoming inserts so chronological allocation is stable.
lock table public.loads, public.truck_availability in share row exclusive mode;
insert into public.ad_references(ad_id,ad_kind)
select id,kind from (
  select id,'load'::text kind,published_at stamp from public.loads
  union all
  select id,'truck'::text,coalesce(created_at,available_from) from public.truck_availability
) ads order by stamp nulls first,id;
create function private.assign_ad_reference() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- This is only a trigger on existing RLS-protected insert paths, never an RPC.
  if tg_table_schema<>'public' or tg_table_name not in ('loads','truck_availability') then
    raise exception 'invalid trigger source';
  end if;
  insert into public.ad_references(ad_id,ad_kind)
  values(new.id,case when tg_table_name='loads' then 'load' else 'truck' end);
  return new;
end $$;
revoke all on function private.assign_ad_reference() from public,anon,authenticated;
create trigger assign_ad_reference after insert on public.loads for each row execute function private.assign_ad_reference();
create trigger assign_ad_reference after insert on public.truck_availability for each row execute function private.assign_ad_reference();

create table private.channel_numbering_control(singleton boolean primary key default true check(singleton),ready boolean not null default false);
insert into private.channel_numbering_control values(true,false);
create table private.channel_daily_counters(day date primary key,last_number integer not null check(last_number>=0));
create table private.channel_publication_numbers(
  source_key text primary key,
  ad_id uuid unique references public.ad_references(ad_id),
  day date not null,
  daily_number integer not null check(daily_number>0),
  message_id text unique,
  status text not null check(status in ('reserved','sent')),
  sent_at timestamptz,
  unique(day,daily_number)
);
alter table private.channel_numbering_control enable row level security;
alter table private.channel_daily_counters enable row level security;
alter table private.channel_publication_numbers enable row level security;
revoke all on private.channel_numbering_control,private.channel_daily_counters,private.channel_publication_numbers from public,anon,authenticated;

create function public.whatsapp_publication_number(p_token text,p_ad_id uuid,p_action text default 'reserve',p_message_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_hash text;
  v_ad bigint;
  v_day date := (now() at time zone 'Asia/Riyadh')::date;
  v_number integer;
  v_row private.channel_publication_numbers%rowtype;
begin
  select token_hash into v_hash from private.whatsapp_bot_config where singleton=true;
  if v_hash is null or encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex')<>v_hash then
    raise exception 'unauthorized';
  end if;
  if not (select ready from private.channel_numbering_control where singleton=true) then
    return jsonb_build_object('ready',false);
  end if;
  select ad_number into v_ad from public.ad_references where ad_id=p_ad_id;
  if v_ad is null then raise exception 'unknown advertisement'; end if;
  -- One lock orders reservations and makes retries idempotent across processes.
  perform pg_advisory_xact_lock(30002026,1);
  select * into v_row from private.channel_publication_numbers where ad_id=p_ad_id;
  if p_action='confirm' then
    if v_row.ad_id is null or coalesce(length(p_message_id),0)<5 then raise exception 'invalid confirmation'; end if;
    update private.channel_publication_numbers set status='sent',message_id=p_message_id,sent_at=coalesce(sent_at,now()) where ad_id=p_ad_id;
    return jsonb_build_object('ready',true,'sent',true);
  elsif p_action<>'reserve' then raise exception 'invalid action'; end if;
  if v_row.ad_id is null then
    insert into private.channel_daily_counters(day,last_number) values(v_day,1)
    on conflict(day) do update set last_number=private.channel_daily_counters.last_number+1
    returning last_number into v_number;
    insert into private.channel_publication_numbers(source_key,ad_id,day,daily_number,status)
    values('ad:'||p_ad_id,p_ad_id,v_day,v_number,'reserved') returning * into v_row;
  end if;
  return jsonb_build_object('ready',true,'ad_number',v_ad,'daily_number',v_row.daily_number,'day',v_row.day,'already_sent',v_row.status='sent');
end $$;
revoke all on function public.whatsapp_publication_number(text,uuid,text,text) from public;
grant execute on function public.whatsapp_publication_number(text,uuid,text,text) to anon,authenticated;
