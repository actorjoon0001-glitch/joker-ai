-- Joker Supabase 초기 설정
-- Supabase 대시보드 → SQL Editor → New query → 이 내용 붙여넣고 Run 한 번 실행

-- 컴퍼니 메모리 (단일 행 문서)
create table if not exists joker_memory (
  id int primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into joker_memory (id, data) values (1, '{}'::jsonb)
  on conflict (id) do nothing;

-- 대화 기록
create table if not exists joker_messages (
  id bigint generated always as identity primary key,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  dept text,
  created_at timestamptz not null default now()
);

-- 일정·리마인더 (조커가 대화 중 등록)
create table if not exists joker_events (
  id bigint generated always as identity primary key,
  kind text not null default 'reminder' check (kind in ('reminder', 'event')),
  title text not null,
  due_at timestamptz not null,
  notified boolean not null default false,
  created_at timestamptz not null default now()
);

-- RLS: publishable(anon) 키로 이 테이블들만 읽기/쓰기 허용
alter table joker_memory enable row level security;
alter table joker_messages enable row level security;
alter table joker_events enable row level security;

drop policy if exists "joker anon events" on joker_events;
create policy "joker anon events" on joker_events
  for all to anon using (true) with check (true);

drop policy if exists "joker anon memory" on joker_memory;
create policy "joker anon memory" on joker_memory
  for all to anon using (true) with check (true);

drop policy if exists "joker anon messages" on joker_messages;
create policy "joker anon messages" on joker_messages
  for all to anon using (true) with check (true);
