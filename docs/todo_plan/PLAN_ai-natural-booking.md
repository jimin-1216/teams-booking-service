# Task Plan: AI 자연어 회의실 예약

> **Generated from**: docs/prd/PRD_ai-natural-booking.md
> **Created**: 2026-04-01
> **Updated**: 2026-04-03
> **Status**: in_progress

## Execution Config

| Option | Value | Description |
|--------|-------|-------------|
| `auto_commit` | true | 완료 시 자동 커밋 |
| `commit_per_phase` | true | Phase별 중간 커밋 |
| `quality_gate` | true | /auto-commit 품질 검사 |

## Phases

### Phase 1: 정책 엔진 + Outgoing Webhook
- [x] `src/rules/BookingPolicy.ts` — 3시간 제한, 층 제한(7+2층), 비공개 방지
- [x] `BookingRepository` 확장 — `findByUserIdAndDate()` (누적 시간 조회)
- [x] `src/bot/WebhookHandler.ts` — Outgoing Webhook 엔드포인트
- [x] HMAC-SHA256 검증 + @멘션 파싱
- [x] Express에 `/api/webhook` 라우트 추가
- [ ] 기존 스크래퍼 층 필터 수정 (8층 제거, 7+2층만) — 스크래퍼 호출 시 policy로 검증

### Phase 2: NLU Core
- [x] `@anthropic-ai/sdk` 패키지 설치
- [x] `src/ai/ClaudeClient.ts` — Claude API 래퍼
- [x] `src/ai/prompts.ts` — 시스템 프롬프트
- [x] `src/ai/NLUParser.ts` — 자연어 → intent + entities 파싱
- [x] Smart Defaults 로직 (7층 기본, 30분 기본)
- [x] `src/config.ts` — ai + policy + webhook 섹션 추가
- [ ] 단위 테스트 (10개+ 입력 검증) — 실 서비스 테스트로 대체

### Phase 3: Conversation Flow
- [x] `src/bot/ConversationManager.ts` — 상태 관리 + TTL 5분
- [x] `src/bot/MessageBuilder.ts` — 자연어 응답 생성
- [x] `src/bot/NLUHandler.ts` — 공통 NLU 처리 로직 (Bot + Webhook 공유)
- [x] `BookingBot.ts` 리팩토링 — NLU 분기 추가
- [x] Webhook에 NLU 플로우 연결
- [x] 멀티턴 대화 (정보 축적)
- [x] 확인 응답 처리 ("응"/"네"/"ㅇ")
- [x] 3시간 제한 경고 통합
- [x] 기존 카드 UI 유지 (fallback)

### Phase 4: Group Chat & Polish
- [ ] 그룹 채팅 예약 의도 감지
- [ ] 자연어 취소
- [ ] Claude API 실패 시 fallback
- [ ] 엣지 케이스 (과거 날짜, 주말, 업무시간 외)
- [ ] 3시간 초과 시 세미나실/팀메이킹룸 안내

### Phase 5: 선택적 개선
- [ ] 사용자별 선호도 저장
- [ ] 예약 충돌 시 대안 자동 제시
- [ ] 프롬프트 튜닝 + 정확도 모니터링

## Progress

| Metric | Value |
|--------|-------|
| Total Tasks | 18/25 |
| Current Phase | Phase 3 완료 |
| Status | in_progress |

## Execution Log

| Timestamp | Phase | Task | Status |
|-----------|-------|------|--------|
| 2026-04-03 | Phase 1 | BookingPolicy.ts | completed |
| 2026-04-03 | Phase 1 | BookingRepository 확장 | completed |
| 2026-04-03 | Phase 1 | WebhookHandler.ts | completed |
| 2026-04-03 | Phase 1 | HMAC + 멘션 파싱 | completed |
| 2026-04-03 | Phase 1 | /api/webhook 라우트 | completed |
| 2026-04-03 | Phase 2 | @anthropic-ai/sdk 설치 | completed |
| 2026-04-03 | Phase 2 | ClaudeClient.ts | completed |
| 2026-04-03 | Phase 2 | prompts.ts | completed |
| 2026-04-03 | Phase 2 | NLUParser.ts | completed |
| 2026-04-03 | Phase 2 | Smart Defaults | completed |
| 2026-04-03 | Phase 2 | config.ts 업데이트 | completed |
| 2026-04-03 | Phase 3 | ConversationManager.ts | completed |
| 2026-04-03 | Phase 3 | MessageBuilder.ts | completed |
| 2026-04-03 | Phase 3 | NLUHandler.ts | completed |
| 2026-04-03 | Phase 3 | BookingBot.ts 리팩토링 | completed |
| 2026-04-03 | Phase 3 | Webhook NLU 연결 | completed |
| 2026-04-03 | Phase 3 | 멀티턴 + 확인 응답 | completed |
| 2026-04-03 | Phase 3 | 타입체크 + 빌드 | passed |
