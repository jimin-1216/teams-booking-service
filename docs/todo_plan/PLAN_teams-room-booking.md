# Task Plan: Teams 회의실 예약 챗봇

> **Generated from**: docs/prd/PRD_teams-room-booking.md
> **Created**: 2026-03-10
> **Updated**: 2026-03-10
> **Status**: in_progress

## Execution Config

| Option | Value | Description |
|--------|-------|-------------|
| `auto_commit` | true | 완료 시 자동 커밋 |
| `commit_per_phase` | true | Phase별 중간 커밋 |
| `quality_gate` | true | /auto-commit 품질 검사 |

## Phases

### Phase 1: 환경 설정 & 프로젝트 초기화
- [ ] **[PoC] Azure Container Apps에서 Playwright headless 실행 검증** *(수동 작업 필요)*
- [x] Node.js TypeScript 프로젝트 초기화 (tsconfig, prettier)
- [x] Dockerfile 작성 (playwright:jammy 기반, Chromium only)
- [x] 핵심 의존성 설치 (botbuilder, playwright, better-sqlite3, p-queue, node-cron)
- [x] 프로젝트 폴더 구조 생성 (src/bot, src/scraper, src/data, src/utils)
- [x] .env.example, .gitignore 설정
- [ ] Playwright로 센터 예약 사이트(https://app.mile.im/login) 접속 및 구조 분석 *(수동 작업 필요)*
- [ ] 로그인 플로우 파악 및 자동화 테스트 *(수동 작업 필요)*
- [ ] 예약 비즈니스 규칙 파악 → PRD 업데이트 *(수동 작업 필요)*
- [ ] 회의실 목록/ID 매핑 정보 수집 *(수동 작업 필요)*

### Phase 2: Scraper 엔진 구현
- [x] SiteAuthenticator 클래스 구현 (공용 계정 로그인/세션 관리)
- [x] RoomScraper 클래스 구현 (회의실 현황 스크래핑)
- [x] BookingExecutor 클래스 구현 (예약/취소 자동화, 비고란에 사용자명 기입)
- [x] BrowserPool 클래스 구현 (인스턴스 1개, p-queue 순차 처리)
- [x] SelectorConfig 구현 (CSS 셀렉터 외부 설정 파일 selectors.json)
- [x] 에러 핸들링 및 재시도 로직 (실패 시 스크린샷 캡처)
- [ ] Scraper 단위 테스트 (HTML 스냅샷 기반 mock) *(사이트 분석 후)*

### Phase 3: Teams Bot 구현
- [x] Bot Framework SDK 설정
- [ ] Azure Bot Service (F0) 등록 및 Teams 앱 매니페스트 작성 *(수동 작업 필요)*
- [x] BookingBot ActivityHandler 구현
- [x] Adaptive Card 템플릿 디자인 (조회폼/결과/예약확인/내예약/도움말/에러)
- [x] CardBuilder 구현
- [x] Bot ↔ Scraper 연동
- [x] 장애 시 폴백 메시지 구현

### Phase 4: DB & 안정화
- [x] SQLite 스키마 생성 (rooms, bookings 테이블 + 인덱스)
- [x] BookingRepository 구현 (pending → confirmed/failed 상태 머신)
- [x] RoomRepository 구현
- [x] 예약 요청 인메모리 큐 처리 (p-queue, 대기 5건/타임아웃 60초)
- [ ] Reconciliation 배치 구현 (매일 09:00 동기화) *(사이트 분석 후)*
- [x] JSON 로깅 설정
- [ ] 통합 테스트 *(사이트 분석 후)*

### Phase 5: 배포 & 운영
- [x] Dockerfile 작성
- [ ] Azure Container Apps 배포 설정 *(수동 작업 필요)*
- [ ] Azure Bot Service (F0) 등록 및 Teams 채널 연결 *(수동 작업 필요)*
- [x] 환경변수/시크릿 관리 (.env.example 템플릿)
- [ ] 관리자 장애 알림 설정 *(사이트 분석 후)*
- [ ] 사용자 가이드 작성

## Progress

| Metric | Value |
|--------|-------|
| Total Tasks | 20/30 |
| Current Phase | Phase 1~5 병렬 진행 |
| Status | in_progress |
| Build | PASS |
| TypeCheck | PASS |

## 수동 작업 필요 항목

다음 항목들은 외부 서비스 접근이 필요하여 사용자가 직접 수행해야 합니다:

1. **센터 예약 사이트 분석**: Playwright로 https://app.mile.im/login 접속하여 실제 DOM 구조 파악 → `selectors.json` 업데이트
2. **Azure Bot Service 등록**: Azure Portal에서 Bot Service (F0 무료) 생성
3. **Azure Container Apps 배포**: Docker 이미지 빌드 및 배포
4. **회의실 목록 매핑**: 실제 회의실 15개의 이름/층/ID 정보 수집

## Execution Log

| Timestamp | Phase | Task | Status |
|-----------|-------|------|--------|
| 2026-03-10 | Phase 1 | 프로젝트 초기화 | completed |
| 2026-03-10 | Phase 1 | Dockerfile 작성 | completed |
| 2026-03-10 | Phase 1 | 의존성 설치 | completed |
| 2026-03-10 | Phase 2 | Scraper 엔진 전체 | completed |
| 2026-03-10 | Phase 3 | Teams Bot 전체 | completed |
| 2026-03-10 | Phase 4 | DB & 로깅 | completed |
| 2026-03-10 | - | TypeScript Build | PASS |
