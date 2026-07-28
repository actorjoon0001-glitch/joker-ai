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

-- 일정·리마인더 (조커가 대화 중 등록) — end_at이 있으면 기간 일정
create table if not exists joker_events (
  id bigint generated always as identity primary key,
  kind text not null default 'reminder' check (kind in ('reminder', 'event')),
  title text not null,
  due_at timestamptz not null,
  end_at timestamptz,
  notified boolean not null default false,
  sms_sent boolean not null default false,
  created_at timestamptz not null default now()
);
-- 기존 설치에 기간 일정 컬럼 추가 (재실행해도 안전)
alter table joker_events add column if not exists end_at timestamptz;
-- 기한 도래 시 문자 발송 완료 표시 (netlify/functions/reminder-sms.mjs)
alter table joker_events add column if not exists sms_sent boolean not null default false;

-- API 사용량 집계 (턴별 토큰·검색 수) + 잔액 기준점(kind='base')
create table if not exists joker_usage (
  id bigint generated always as identity primary key,
  kind text not null default 'turn' check (kind in ('turn', 'base')),
  model text,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  searches int not null default 0,
  amount_usd numeric,
  created_at timestamptz not null default now()
);

-- 코워크 작업 큐 (조커가 접수, 코워크(Claude)가 실행)
create table if not exists joker_tasks (
  id bigint generated always as identity primary key,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'failed')),
  request text not null,
  result text,
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 할 일 목록 (조커 태그·사이드바에서 관리)
create table if not exists joker_todos (
  id bigint generated always as identity primary key,
  title text not null,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

-- AI 직원(팀 모드) — 담당자를 골라 대화하면 그 직원의 전문성·말투로 응대한다
create table if not exists joker_staff (
  id bigint generated always as identity primary key,
  name text not null,
  role text not null default '',
  dept text,
  emoji text,
  persona text not null default '',
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- 기본 직원 6명 (테이블이 비어 있을 때만 넣는다 — 재실행해도 중복되지 않음)
insert into joker_staff (name, role, dept, emoji, persona, sort)
select * from (values
  ('세리', '마케팅 담당', 'marketing', '🎯',
   '밝고 트렌디하다. 요즘 뜨는 채널과 소재를 빠르게 캐치해 제안한다. 광고·SNS·콘텐츠 기획이 전문이고, 아이디어를 낼 때는 근거(레퍼런스·타깃·예상 반응)를 짧게 붙인다.', 1),
  ('지훈', '영업 담당', 'sales', '🤝',
   '싹싹하고 설득력 있다. 고객 응대, 견적·제안, 미팅 준비가 전문이다. 문자나 메일 초안을 쓸 때 특히 강하고, 항상 상대 입장에서 한 번 더 다듬는다.', 2),
  ('도현', '설계·시공 관리', 'construction', '🏗',
   '꼼꼼하고 현실적이다. 현장 일정, 자재, 공정, 하자 관리가 전문이다. 일정이 빠듯하거나 리스크가 보이면 돌려 말하지 않고 바로 짚는다.', 3),
  ('수민', '정산 담당', 'finance', '💰',
   '숫자에 밝고 깐깐하다. 매출·비용·세금계산서·부가세를 챙긴다. 금액은 항상 단위를 명확히 쓰고, 빠진 증빙이나 미수금이 있으면 먼저 알려준다.', 4),
  ('한별', '전략기획', 'strategy', '📊',
   '큰 그림을 본다. 사업계획, 시장·경쟁사 분석, 우선순위 정리가 전문이다. 결론부터 말하고 근거를 3가지 이내로 정리한다.', 5),
  ('서준', '법무 담당', 'legal', '⚖️',
   '신중하고 정확하다. 계약서 검토, 특약, 분쟁·하자 리스크를 본다. 단정적인 법률 자문 대신 위험 요소와 확인이 필요한 지점을 짚어주고, 필요하면 전문가 확인을 권한다.', 6)
) as v(name, role, dept, emoji, persona, sort)
where not exists (select 1 from joker_staff);

-- 직원 업무 지시함 — [[업무:이름|내용]] 태그로 접수되고, 백그라운드 워커가
-- 그 직원의 페르소나로 실제 작업을 수행해 result에 결과를 채운다
create table if not exists joker_staff_tasks (
  id bigint generated always as identity primary key,
  staff_id bigint,
  staff_name text not null,
  staff_emoji text,
  dept text,
  request text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  result text,
  notion_url text,
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: publishable(anon) 키로 이 테이블들만 읽기/쓰기 허용
alter table joker_memory enable row level security;
alter table joker_messages enable row level security;
alter table joker_events enable row level security;
alter table joker_usage enable row level security;
alter table joker_tasks enable row level security;

drop policy if exists "joker anon tasks" on joker_tasks;
create policy "joker anon tasks" on joker_tasks
  for all to anon using (true) with check (true);

drop policy if exists "joker anon usage" on joker_usage;
create policy "joker anon usage" on joker_usage
  for all to anon using (true) with check (true);

drop policy if exists "joker anon events" on joker_events;
create policy "joker anon events" on joker_events
  for all to anon using (true) with check (true);

drop policy if exists "joker anon memory" on joker_memory;
create policy "joker anon memory" on joker_memory
  for all to anon using (true) with check (true);

drop policy if exists "joker anon messages" on joker_messages;
create policy "joker anon messages" on joker_messages
  for all to anon using (true) with check (true);

alter table joker_todos enable row level security;
drop policy if exists "joker anon todos" on joker_todos;
create policy "joker anon todos" on joker_todos
  for all to anon using (true) with check (true);

alter table joker_staff enable row level security;
drop policy if exists "joker anon staff" on joker_staff;
create policy "joker anon staff" on joker_staff
  for all to anon using (true) with check (true);

alter table joker_staff_tasks enable row level security;
drop policy if exists "joker anon staff tasks" on joker_staff_tasks;
create policy "joker anon staff tasks" on joker_staff_tasks
  for all to anon using (true) with check (true);
