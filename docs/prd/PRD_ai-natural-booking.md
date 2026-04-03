# AI 자연어 회의실 예약 봇 PRD

> **Version**: 1.1
> **Created**: 2026-04-01
> **Updated**: 2026-04-03
> **Status**: Draft

## 1. Overview

### 1.1 Problem Statement

현재 Teams 예약 봇은 **명령어 기반 단계별 입력**을 요구한다:

```
사용자: "예약"
봇: [검색 폼 카드 표시] → 날짜 선택 → 시작시간 → 종료시간 → 층 선택 → 조회
봇: [결과 카드] → 회의실 선택 → 메모 입력 → 예약 확정
```

이는 mile.im 사이트에서 직접 예약하는 것과 입력량 면에서 차이가 없다.

추가로, 서울창업허브 회의실 운영 정책이 강화되었다:

- **일일 3시간 제한**: 전체 회의실(2층 포함) 이용시간 합산 기준 1일 최대 3시간
- **층 제한**: 입주 층(7층) + 2층(공용)만 사용 가능. 타 층 사용 불가
- **비공개 예약 금지**: 모든 예약은 공개 설정 필수
- **위반 시 제재**: 사전 안내 없이 예약 임의 조정/취소, 반복 위반 시 팀 전체 제재
- **4월 계도기간**: 2026년 4월 한 달간 계도 후 본격 시행

현재 mile.im은 화면이 파편화되어 있어 여러 층/회의실 옵션을 각각 클릭해서 비교해야 하고, "나의 예약/참석" 페이지도 단순 리스트라 오늘 누적 사용 시간을 한눈에 확인할 수 없다. 3시간 제한을 지키려면 매번 수동으로 계산해야 하는 불편함이 있다.

사용자가 원하는 것은:

```
사용자: "내일 3시에 미팅 잡자"
봇: "내일(4/2) 15:00~15:30, 7층 회의실③ 예약할까요?"
사용자: "응"
봇: "예약 완료!"
```

### 1.2 Goals

- **입력 최소화**: 자연어 한 문장으로 예약 의도 + 시간 + 장소를 한번에 전달
- **스마트 추천**: 미입력 항목(층, 회의실, 시간대)은 컨텍스트 기반으로 자동 추천
- **3시간 제한 자동 관리**: 오늘 누적 사용 시간 추적, 초과 시 사전 경고
- **대화형 확인**: 추론 결과를 보여주고 "네/아니오"로 확정
- **그룹 채팅 감지**: 팀 채팅에서 "미팅 잡자" 등 예약 의도가 감지되면 봇이 자동 제안
- **Outgoing Webhook 지원**: 관리자 앱 승인 없이 팀 소유자가 직접 봇 추가 가능

### 1.3 Non-Goals (Out of Scope)

- 캘린더 연동 (Outlook/Google Calendar)
- 다른 건물/지점 예약
- 반복 예약 (매주 월요일 등)
- 음성 인식 (STT)
- 세미나실 대관 (별도 프로세스)
- 1층 팀메이킹룸 예약 (별도 시스템)

### 1.4 Scope

| 포함 | 제외 |
|------|------|
| 자연어 → 예약 파라미터 추출 (NLU) | 캘린더 자동 동기화 |
| 스마트 기본값 (7층 우선, 30분 기본) | 다국어 지원 (한국어만) |
| 대화 컨텍스트 유지 (멀티턴) | 참석자 자동 초대 |
| 그룹 채팅 예약 의도 감지 | 회의실 추천 ML 모델 |
| 일일 3시간 제한 검증 + 경고 | 세미나실/팀메이킹룸 대관 |
| 사용 가능 층 제한 (7층+2층만) | 타 층 예약 |
| 비공개 예약 방지 | - |
| 오늘 누적 사용시간 조회 | - |
| Outgoing Webhook 엔드포인트 | Bot Framework 제거 (당분간 병행) |
| 기존 기능 유지 (카드 기반 예약) | 기존 카드 UI 제거 |

## 2. User Stories

### 2.1 1:1 채팅 자연어 예약

As a 사무실 직원, I want to "내일 2시에 회의실 잡아줘"라고 말하면 봇이 알아서 예약해주길 원한다, so that 6단계 폼 입력 없이 한 문장으로 예약할 수 있다.

**Acceptance Criteria (Gherkin)**:

```gherkin
Scenario: 자연어 한 문장으로 예약
  Given 사용자가 봇에게 1:1 채팅으로 메시지를 보낸다
  When "내일 오후 3시에 미팅룸 잡아줘"라고 입력한다
  Then 봇이 날짜(내일), 시간(15:00), 기본 종료시간(15:30), 층(7층)을 추출한다
  And 7층 빈 회의실을 조회한다
  And "내일(4/2) 15:00~15:30, 7층 회의실③ 예약할까요?"라고 추천한다
  When 사용자가 "응"이라고 답한다
  Then 예약이 실행되고 확인 메시지가 표시된다

Scenario: 정보 부족 시 추가 질문
  Given 사용자가 "회의실 잡아줘"라고만 입력한다
  When 날짜와 시간 정보가 없다
  Then 봇이 "언제로 잡을까요? (예: 내일 3시, 4/5 10시)"라고 질문한다

Scenario: 모호한 시간 표현 처리
  Given 사용자가 "오늘 오후에 한시간 잡아줘"라고 입력한다
  When "오후"는 13:00~18:00 범위이다
  Then 봇이 현재 시각 이후 가장 빠른 빈 시간대를 찾아 추천한다
```

### 2.2 그룹 채팅 예약 감지

As a 팀원, I want to 팀 채팅에서 "내일 회의 하자"라고 말하면 봇이 자동으로 회의실 예약을 제안해주길 원한다, so that 별도로 봇에게 1:1로 가서 예약하지 않아도 된다.

**Acceptance Criteria**:

```gherkin
Scenario: 그룹 채팅에서 예약 의도 감지
  Given 봇이 팀 채널/그룹 채팅에 추가되어 있다
  When 누군가 "내일 3시에 미팅 합시다"라고 입력한다
  Then 봇이 "회의실 예약해드릴까요? 내일(4/2) 15:00~15:30"이라고 제안한다
  And 제안 메시지에 "예약" / "괜찮아요" 버튼이 있다

Scenario: 일반 대화에는 반응하지 않음
  Given 팀 채팅에서 대화가 진행 중이다
  When "내일 점심 뭐 먹지?"라고 입력한다
  Then 봇이 반응하지 않는다
```

### 2.3 일일 3시간 제한 자동 관리

As a 직원, I want to 예약할 때 봇이 오늘 내 누적 사용 시간을 자동으로 확인하고 3시간 초과 시 경고해주길 원한다, so that 규정 위반으로 예약이 삭제되는 일을 방지할 수 있다.

**Acceptance Criteria**:

```gherkin
Scenario: 3시간 초과 예약 방지
  Given 사용자가 오늘 이미 2시간 30분 예약이 있다
  When "오늘 2시에 1시간 잡아줘"라고 입력한다
  Then 봇이 "오늘 이미 2시간 30분 사용 중이에요. 30분만 더 가능합니다. 14:00~14:30으로 잡을까요?"라고 제안한다

Scenario: 누적 사용시간 조회
  Given 사용자가 오늘 1시간 예약이 있다
  When "오늘 얼마나 썼어?" 또는 "남은 시간"이라고 입력한다
  Then 봇이 "오늘 사용: 1시간 / 남은 시간: 2시간"이라고 응답한다

Scenario: 여러 층 합산 체크
  Given 사용자가 7층에 1시간, 2층에 1시간 30분 예약이 있다
  When 추가 예약을 시도한다
  Then 봇이 전체 합산(2시간 30분) 기준으로 남은 시간(30분)을 계산한다
```

### 2.4 사용 가능 층 제한

As a 직원, I want to 예약 불가능한 층(3,4,5,6,8층)을 요청하면 봇이 안내해주길 원한다.

**Acceptance Criteria**:

```gherkin
Scenario: 8층 예약 시도 차단
  Given 사용자가 "8층 회의실 잡아줘"라고 입력한다
  Then 봇이 "우리 회사는 7층과 2층(공용) 회의실만 사용 가능해요. 7층으로 잡을까요?"라고 안내한다
```

### 2.5 Outgoing Webhook으로 봇 연결

As a 팀 소유자, I want to 관리자 앱 승인 없이 팀 채널에 봇을 추가하고 싶다, so that IT 관리자 의존 없이 바로 사용할 수 있다.

**Acceptance Criteria**:

```gherkin
Scenario: Outgoing Webhook으로 봇 추가
  Given 팀 소유자가 Teams 채널 설정에서 Outgoing Webhook을 생성한다
  When 콜백 URL을 봇 서버 주소로 설정한다
  Then 채널에서 @봇이름 + 메시지를 보내면 봇이 응답한다
  And 관리자 앱 승인이 필요 없다
```

### 2.6 예약 변경/취소 자연어

As a 직원, I want to "3시 회의 30분 늦춰줘" 또는 "내일 회의 취소해줘"라고 말하면 봇이 처리해주길 원한다.

**Acceptance Criteria**:

```gherkin
Scenario: 자연어 취소
  Given 사용자가 내일 15:00 예약이 있다
  When "내일 회의 취소해줘"라고 입력한다
  Then 봇이 해당 예약을 찾아 "내일 15:00~15:30 회의실③ 예약을 취소할까요?"라고 확인한다
  When "응"이라고 답한다
  Then 예약이 취소된다
```

## 3. Functional Requirements

| ID | Requirement | Priority | Dependencies |
|----|------------|----------|--------------|
| FR-001 | 자연어 메시지에서 예약 의도(intent) 감지 | P0 (Must) | Claude API |
| FR-002 | 날짜/시간/장소 엔티티 추출 (NER) | P0 (Must) | FR-001 |
| FR-003 | 미입력 항목에 대한 스마트 기본값 적용 | P0 (Must) | FR-002 |
| FR-004 | 추출된 파라미터로 공실 조회 → 추천 메시지 생성 | P0 (Must) | FR-002, 기존 scraper |
| FR-005 | 확인 응답("응", "네", "ㅇ") 인식 → 예약 실행 | P0 (Must) | FR-004 |
| FR-006 | 정보 부족 시 추가 질문 (멀티턴 대화) | P0 (Must) | FR-001 |
| FR-007 | 대화 상태 관리 (컨텍스트 유지, 타임아웃) | P0 (Must) | - |
| FR-008 | 일일 3시간 제한 검증 — 예약 전 누적 시간 체크, 초과 시 차단+대안 제시 | P0 (Must) | 기존 DB |
| FR-009 | 누적 사용시간 조회 ("오늘 얼마나 썼어?") | P0 (Must) | FR-008 |
| FR-010 | 사용 가능 층 제한 — 7층+2층만 허용, 타 층 요청 시 안내 | P0 (Must) | FR-002 |
| FR-011 | 비공개 예약 방지 — 스크래퍼에서 항상 공개 설정으로 예약 | P0 (Must) | 기존 scraper |
| FR-012 | Outgoing Webhook 엔드포인트 — 관리자 승인 없이 봇 연결 | P0 (Must) | - |
| FR-013 | 그룹 채팅에서 예약 의도 감지 + 제안 | P1 (Should) | FR-001 |
| FR-014 | 자연어 취소 ("내일 회의 취소해줘") | P1 (Should) | FR-001, 기존 scraper |
| FR-015 | 기존 카드 기반 예약 플로우 유지 (fallback) | P1 (Should) | - |
| FR-016 | "오후에 한시간" 등 모호한 시간 → 최적 시간대 추천 | P1 (Should) | FR-002 |
| FR-017 | 3시간 초과 시 세미나실 대관/팀메이킹룸 안내 메시지 | P2 (Could) | FR-008 |
| FR-018 | 사용자별 선호 층/회의실 학습 | P2 (Could) | FR-003 |

## 4. Non-Functional Requirements

### 4.0 Scale Grade

**Hobby** — 사내 도구, 사용자 10명 이하, 일일 예약 수십 건

### 4.1 Performance SLA

| 지표 | 목표값 |
|------|--------|
| 자연어 파싱 응답 (Claude API) | < 3초 |
| 공실 조회 + 추천 메시지 | < 10초 (스크래핑 포함) |
| 전체 예약 플로우 (자연어 → 예약 완료) | < 20초 |

### 4.2 Availability SLA

| 등급 | Uptime | 허용 다운타임(월) |
|------|--------|-----------------|
| Hobby | 95% | 36시간 |

PC 기반 운영이므로 PC 꺼짐/재부팅 시 다운타임 발생 허용.

### 4.3 Data Requirements

| 항목 | 값 |
|------|-----|
| 현재 데이터량 | < 10MB (SQLite) |
| 월간 증가율 | 미미 |
| 대화 컨텍스트 보존 | 메모리 (5분 TTL) |

### 4.4 Security

- Claude API 키는 환경변수로 관리 (.env)
- 사용자 메시지는 Claude API로 전송되므로 민감 정보 주의
- API 키 로테이션: 필요 시 수동

### 4.5 Cost

| 항목 | 예상 비용 |
|------|----------|
| Claude API (Haiku) | ~$1-5/월 (일 수십 건 기준) |
| Claude API (Sonnet) | ~$5-20/월 |
| 기타 인프라 | $0 (로컬 PC + Cloudflare Tunnel) |

**권장**: Claude Haiku로 시작, 정확도 부족 시 Sonnet으로 업그레이드

## 5. Technical Design

### 5.1 Architecture

```
사용자 메시지
    ↓
BookingBot.onMessage()
    ↓
┌─────────────────────────────────┐
│  NLU Layer (신규)                │
│                                 │
│  1. Intent Detection            │
│     - booking (예약)            │
│     - cancel (취소)             │
│     - query (조회)              │
│     - confirm (확인/승인)       │
│     - chitchat (일반 대화)      │
│                                 │
│  2. Entity Extraction           │
│     - date: "내일" → 2026-04-02 │
│     - time: "3시" → 15:00       │
│     - duration: "한시간" → 60m  │
│     - floor: "7층" → 7          │
│     - room: "회의실③" → name    │
│                                 │
│  3. Smart Defaults              │
│     - floor: 7 (우리 회사 층)   │
│     - duration: 30분            │
│     - date: 오늘 (업무시간 내)  │
│       또는 내일 (업무시간 후)   │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│  Conversation Manager (신규)    │
│                                 │
│  - 대화 상태 (in-memory Map)    │
│  - 5분 TTL (타임아웃)           │
│  - 상태: idle → collecting →    │
│          confirming → executing │
└─────────────────────────────────┘
    ↓
기존 Scraper / DB (변경 없음)
```

### 5.2 Claude API 연동

**모델**: `claude-haiku-4-5-20251001` (비용 최적화, 간단한 NLU에 충분)

**System Prompt 설계**:

```
당신은 회의실 예약 어시스턴트입니다.
사용자 메시지에서 다음을 추출하세요:

1. intent: "book" | "cancel" | "query" | "confirm" | "reject" | "none"
2. entities:
   - date: ISO 형식 (YYYY-MM-DD) 또는 null
   - startTime: HH:mm 형식 또는 null
   - endTime: HH:mm 형식 또는 null
   - duration: 분 단위 숫자 또는 null
   - floor: 숫자 또는 null
   - room: 회의실 이름 또는 null
   - memo: 회의 목적/메모 또는 null

오늘 날짜: {today}
현재 시각: {now}

"내일" = {tomorrow}, "모레" = {dayAfter}
"오후 3시" = 15:00, "오전 10시" = 10:00
"한시간" = duration 60, "30분" = duration 30

JSON으로만 응답하세요.
```

**응답 형식**:

```json
{
  "intent": "book",
  "entities": {
    "date": "2026-04-02",
    "startTime": "15:00",
    "endTime": null,
    "duration": null,
    "floor": null,
    "room": null,
    "memo": "미팅"
  },
  "confidence": 0.95
}
```

### 5.3 Smart Defaults 로직

```typescript
function applyDefaults(entities: Entities): BookingParams {
  // 날짜: 없으면 오늘(업무시간 내) 또는 내일(업무시간 후)
  if (!entities.date) {
    entities.date = isBusinessHours() ? today() : tomorrow();
  }

  // 층: 없으면 7층 (우리 회사 층). 허용 층: 2, 7만
  if (!entities.floor) {
    entities.floor = 7;
  } else if (![2, 7].includes(entities.floor)) {
    throw new FloorRestrictionError(entities.floor);
  }

  // 종료시간: startTime + duration 또는 + 30분
  if (entities.startTime && !entities.endTime) {
    const duration = entities.duration || 30;
    entities.endTime = addMinutes(entities.startTime, duration);
  }

  return entities;
}
```

### 5.3.1 일일 3시간 제한 검증

```typescript
interface DailyUsage {
  totalMinutes: number;      // 오늘 누적 사용 분
  remainingMinutes: number;  // 남은 사용 가능 분
  bookings: BookingWithRoom[]; // 오늘 예약 목록
}

const DAILY_LIMIT_MINUTES = 180; // 3시간

async function checkDailyLimit(userId: string, date: string): Promise<DailyUsage> {
  // DB에서 해당 날짜의 confirmed/pending 예약 조회 (전체 층 합산)
  const bookings = await bookingRepo.findByUserIdAndDate(userId, date);
  const totalMinutes = bookings.reduce((sum, b) => {
    return sum + diffMinutes(b.startTime, b.endTime);
  }, 0);

  return {
    totalMinutes,
    remainingMinutes: Math.max(0, DAILY_LIMIT_MINUTES - totalMinutes),
    bookings,
  };
}

// 예약 전 검증:
// 1. 요청 시간이 remainingMinutes 이내인지 확인
// 2. 초과 시 → 가능한 시간만큼 축소 제안
// 3. 이미 3시간 꽉 찬 경우 → 세미나실/팀메이킹룸 안내
```

### 5.3.2 Outgoing Webhook 엔드포인트

```
기존 아키텍처:
  Teams → Azure Bot Service → CloudAdapter → /api/messages

추가 (Outgoing Webhook):
  Teams 채널 → @봇이름 메시지 → POST /api/webhook → HMAC 검증 → 응답

차이점:
  - Bot Framework SDK 불필요 (순수 HTTP POST/Response)
  - 관리자 앱 승인 불필요 (팀 소유자가 직접 추가)
  - @멘션 필수 (그룹 채팅에서)
  - Adaptive Card 사용 불가 → 텍스트 + HTML 응답
  - 1:1 채팅 불가 → 채널/그룹 채팅만
```

```typescript
// Express 엔드포인트 추가
app.post('/api/webhook', async (req, res) => {
  // 1. HMAC-SHA256 검증 (Teams가 보내는 Authorization 헤더)
  if (!verifyWebhookHMAC(req)) {
    return res.status(401).send('Unauthorized');
  }

  // 2. 메시지에서 @봇이름 제거 후 순수 텍스트 추출
  const text = stripMention(req.body.text);
  const userId = req.body.from.id;
  const userName = req.body.from.name;

  // 3. NLU 파싱 → 예약 플로우 (동일 로직)
  const result = await processMessage(text, userId, userName);

  // 4. 응답 (Outgoing Webhook은 JSON 형식)
  res.json({ type: 'message', text: result.message });
});
```

### 5.4 Conversation State

```typescript
interface ConversationState {
  userId: string;
  step: 'idle' | 'collecting' | 'confirming' | 'executing';
  entities: Partial<Entities>;    // 지금까지 수집된 정보
  recommendedRoom?: RoomInfo;     // 추천된 회의실
  pendingBookingId?: string;      // 확인 대기 중인 예약
  lastActivity: number;           // 타임아웃용 타임스탬프
}

// In-memory store (Map<userId, ConversationState>)
// TTL: 5분 (마지막 활동 후)
```

### 5.5 메시지 처리 플로우

```
메시지 수신
    ↓
[1] 대화 상태 확인 (기존 컨텍스트 있는지)
    ↓
[2] 상태가 'confirming'이면 → 확인/거절 응답 처리
    - "응/네/ㅇ/좋아" → 예약 실행
    - "아니/ㄴ/다른거" → 대안 제시 또는 리셋
    ↓
[3] Claude API로 intent + entity 추출
    ↓
[4] intent별 분기:
    - book → 필수 정보 체크 → 부족하면 질문, 충분하면 공실 조회 → 추천
    - cancel → 사용자 예약 조회 → 매칭 → 확인 질문
    - query → 공실 조회 → 결과 표시
    - confirm → 현재 상태에 따라 처리
    - none → 기존 카드 UI fallback 또는 도움말
```

### 5.6 파일 구조 (신규/변경)

```
src/
├── ai/
│   ├── ClaudeClient.ts          # Claude API 래퍼
│   ├── NLUParser.ts             # 자연어 → intent + entities
│   └── prompts.ts               # 시스템 프롬프트 템플릿
├── bot/
│   ├── BookingBot.ts            # 변경: 메시지 핸들러에 NLU 분기 추가
│   ├── ConversationManager.ts   # 신규: 대화 상태 관리
│   ├── MessageBuilder.ts        # 신규: 자연어 응답 생성
│   └── WebhookHandler.ts        # 신규: Outgoing Webhook 처리
├── rules/
│   └── BookingPolicy.ts         # 신규: 3시간 제한, 층 제한, 비공개 방지
├── config.ts                    # 변경: Claude API 키, 정책 상수 추가
```

### 5.7 Config 추가

```typescript
// config.ts에 추가
ai: {
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001',
  maxTokens: 256,
  temperature: 0,
}
```

## 6. Implementation Phases

### Phase 1: 정책 엔진 + Outgoing Webhook

- [ ] `src/rules/BookingPolicy.ts` — 3시간 제한, 층 제한(7+2층), 비공개 방지
- [ ] `BookingRepository` 확장 — `findByUserIdAndDate()` 메서드 (누적 시간 조회)
- [ ] `src/bot/WebhookHandler.ts` — Outgoing Webhook 엔드포인트 (`/api/webhook`)
- [ ] HMAC-SHA256 검증, @멘션 파싱
- [ ] Express에 `/api/webhook` 라우트 추가
- [ ] 기존 스크래퍼 층 필터 수정 (8층 제거, 7+2층만)

**Deliverable**: 관리자 승인 없이 Teams에서 봇 사용 가능 + 정책 준수

### Phase 2: NLU Core

- [ ] `@anthropic-ai/sdk` 패키지 설치
- [ ] `src/ai/ClaudeClient.ts` — Claude API 래퍼 (Haiku, JSON mode)
- [ ] `src/ai/prompts.ts` — 시스템 프롬프트 (intent + entity 추출)
- [ ] `src/ai/NLUParser.ts` — 자연어 → `{intent, entities}` 파싱
- [ ] Smart Defaults 로직 (7층 기본, 30분 기본, 날짜 추론)
- [ ] `src/config.ts` 수정 — `ai` 섹션 + `policy` 섹션 추가
- [ ] 단위 테스트 — 자연어 입력 10개 이상 파싱 검증

**Deliverable**: 자연어 → 구조화된 예약 파라미터 변환 모듈

### Phase 3: Conversation Flow

- [ ] `src/bot/ConversationManager.ts` — 대화 상태 관리 (Map + TTL 5분)
- [ ] `src/bot/MessageBuilder.ts` — 자연어 응답 생성 (추천, 확인, 에러, 누적시간)
- [ ] `src/bot/BookingBot.ts` 리팩토링 — NLU 분기 추가
- [ ] Webhook에도 동일 NLU 플로우 연결
- [ ] 멀티턴 대화 — 정보 부족 시 추가 질문 → 엔티티 축적
- [ ] 확인 응답 처리 ("응"/"네"/"ㅇ" → 예약 실행)
- [ ] 3시간 제한 경고 통합 (예약 전 잔여 시간 표시)
- [ ] 기존 카드 기반 플로우 유지 (fallback)

**Deliverable**: 자연어로 예약 가능 + 정책 자동 검증

### Phase 4: Group Chat & Polish

- [ ] 그룹 채팅 예약 의도 감지 (@멘션 시)
- [ ] 자연어 취소 기능
- [ ] 에러 핸들링 개선 (Claude API 실패 시 카드 fallback)
- [ ] 엣지 케이스 처리 (과거 날짜, 업무시간 외, 주말)
- [ ] 3시간 초과 시 세미나실/팀메이킹룸 안내

**Deliverable**: 그룹 채팅 지원 + 안정화

### Phase 5: 선택적 개선

- [ ] 사용자별 선호도 학습 (자주 쓰는 층/회의실)
- [ ] 예약 충돌 시 대안 자동 제시
- [ ] 응답 품질 모니터링 + 프롬프트 튜닝

**Deliverable**: 개인화 + 품질 개선

## 7. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| 예약 완료까지 메시지 수 | ≤ 3턴 (현재 6+턴) | 대화 로그 |
| 자연어 파싱 정확도 | ≥ 90% | 테스트 케이스 |
| 사용자 만족도 | "기존보다 편하다" | 직접 피드백 |
| Claude API 비용 | < $5/월 | API 대시보드 |
| 평균 응답 시간 | < 5초 (NLU만) | 로그 |
