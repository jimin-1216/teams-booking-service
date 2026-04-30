# Teams SDK v2 마이그레이션 + 기능 추가 PRD

> **Version**: 1.0
> **Created**: 2026-04-30
> **Status**: In Progress
> **Scale Grade**: Hobby (사내 도구)

## 1. Overview

### 1.1 배경

현재 Bot Framework v4 기반으로 구현되어 있으나, 배포 과정에서 Azure AAD 수동 등록/매니페스트 작성/관리자 승인 등의 병목이 발생하고 있다. Microsoft Teams SDK v2 (`@microsoft/teams.apps` v2.0.8)가 안정화되면서 CLI 기반 자동화 배포가 가능해졌다.

동시에 창업센터 일일 3시간 제한 정책에 대한 사용자 편의 기능을 추가한다.

### 1.2 Goals

1. **Teams SDK v2 마이그레이션**: Bot Framework v4 → Teams SDK v2로 전환하여 배포 프로세스 단순화
2. **일일 사용량 사전 안내**: 예약 전 3시간 제한 현황을 항상 표시
3. **얍삽이 모드**: 3시간 초과 시 팀원 이름으로 예약 분할하여 회의실 점유 유지

### 1.3 변경 범위

| 구분 | 변경 대상 | 변경 내용 |
|------|-----------|-----------|
| 마이그레이션 | `index.ts` | Bot Framework Adapter → Teams SDK ExpressAdapter |
| 마이그레이션 | `BookingBot.ts` | TeamsActivityHandler 클래스 → 이벤트 리스너 함수 |
| 마이그레이션 | `package.json` | `botbuilder` 제거, `@microsoft/teams.apps` 추가 |
| 마이그레이션 | 배포 | Azure Portal 수동 → `teams app create` CLI |
| 기능 추가 | `MessageBuilder.ts` | `buildDailyUsageWarning()` 사전 안내 메시지 |
| 기능 추가 | `NLUHandler.ts` | 예약 추천 시 사용량 현황 포함 |
| 기능 추가 | `BookingSplitter.ts` (신규) | 얍삽이 모드 예약 분할 로직 |
| 기능 추가 | `config.ts` | `sneakyMode` 설정 블록 |
| 기능 추가 | `ConversationManager.ts` | `sneakySplit` 상태 필드 |

### 1.4 변경하지 않는 것 (보존)

- `NLUHandler.ts` — processNaturalLanguage() 인터페이스 유지
- `BookingPolicy.ts` — 정책 검증 로직 그대로
- `BookingExecutor.ts` — 스크래퍼 실행 로직 그대로
- `RoomScraper.ts` — 공실 조회 로직 그대로
- `WebhookHandler.ts` — Outgoing Webhook 엔드포인트 유지
- `WorkflowHandler.ts` — Power Automate 엔드포인트 유지

## 2. 아키텍처 비교

### 2.1 현재 (Bot Framework v4)

```
Teams → Azure Bot Service → POST /api/messages
  → CloudAdapter → ConfigurationBotFrameworkAuthentication
    → BookingBot (TeamsActivityHandler)
      → handleMessage() → TurnContext 의존
        → processNaturalLanguage()
```

배포 프로세스:
1. Azure Portal에서 AAD 앱 등록 (수동)
2. 클라이언트 시크릿 생성 (수동)
3. Bot Channel Registration (수동)
4. 매니페스트 JSON 작성 (수동)
5. Teams 관리자 승인 요청 (대기)
6. 사이드로드 or 조직 앱 스토어 게시

### 2.2 마이그레이션 후 (Teams SDK v2)

```
Teams → POST /api/messages (SDK가 자동 등록)
  → ExpressAdapter → TeamsApp
    → on('message') 이벤트 핸들러
      → processNaturalLanguage()
```

배포 프로세스:
1. `teams login` (CLI)
2. `teams app create --name "호비" --endpoint https://url/api/messages --env .env` (자동)
3. Teams에 사이드로드

## 3. 얍삽이 모드 상세

### 3.1 동작 원리

창업센터 일일 3시간 제한을 우회하기 위해, 초과 시간을 팀원 이름으로 분할 예약한다.

```
요청: 13:00~17:00 (4시간, 본인 잔여 1시간)

분할 결과:
  👤 13:00~14:00 — 본인 (잔여 한도 소진)
  🔄 14:00~17:00 — 팀원A (대리 예약)
```

### 3.2 설정

```env
SNEAKY_MODE=true
SNEAKY_MEMBERS=홍길동,김철수,이영희
SNEAKY_SPLIT_UNIT=30   # 분할 단위 (분), 기본 30
```

### 3.3 제약 사항

- 팀원 이름은 메모에만 기입됨 (마일 사이트 계정은 공용 1개 사용)
- 대리 예약분은 내부 DB에 본인 userId로 기록하지 않음 (한도 소진 방지)
- 팀원 수 × 3시간이 분할 가능한 최대 시간

## 4. 일일 사용량 사전 안내

### 4.1 표시 조건

- 해당 날짜에 기존 예약이 1건 이상 있을 때 자동 표시
- 예약 추천 메시지 상단에 배치

### 4.2 메시지 형태

```
⚠️ 창업센터 일일 3시간 제한 현황
• 오늘 누적: 2시간 / 잔여: 1시간
• 이 예약 후 잔여: 30분
⚡ 한도가 거의 다 찼습니다. 추가 예약이 어려울 수 있어요.
```
