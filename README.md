# Teams Booking Service

서울창업허브 공덕 회의실 예약 자동화 챗봇 — Microsoft Teams에서 대화로 회의실을 조회하고 예약합니다.

## 개요

입주사 직원이 Teams 채팅으로 회의실 예약을 요청하면, Playwright로 센터 예약 사이트([app.mile.im](https://app.mile.im))를 자동 조작하여 예약을 처리합니다.

**왜 필요한가?** 공용 계정 1개로 전 직원 예약을 대행하는 구조라, 매번 사이트에 로그인해서 수동으로 예약하는 번거로움을 없앱니다.

## 기능

- 날짜/층별 회의실 빈 시간 조회
- 원클릭 예약 (Adaptive Card UI)
- 예약 사유(메모) 입력
- 내 예약 목록 확인 및 취소
- 예약 가능 층: 2층, 7층, 8층

## 아키텍처

```
Teams 사용자
    ↓ (메시지)
Azure Bot Service
    ↓
Express (Bot Framework SDK v4)
    ├── BookingBot (대화 처리)
    ├── CardBuilder (Adaptive Card 생성)
    ├── BrowserPool + p-queue (동시성 제어)
    └── Scraper 엔진
         ├── SiteAuthenticator (로그인/세션)
         ├── RoomScraper (회의실 조회)
         ├── BookingExecutor (예약/취소)
         └── DateNavigator (날짜 이동)
              ↓ (Playwright)
         app.mile.im (예약 사이트)
```

## 기술 스택

| 구분 | 기술 |
|------|------|
| Runtime | Node.js 20+ / TypeScript |
| Bot | Bot Framework SDK v4 (botbuilder) |
| 브라우저 자동화 | Playwright (Chromium) |
| DB | SQLite (better-sqlite3) |
| 동시성 제어 | p-queue (동시 1, 대기 5) |
| 배포 | Azure Container Apps + GitHub Actions |

## 프로젝트 구조

```
src/
├── index.ts              # Express 서버 진입점
├── config.ts             # 환경변수 설정
├── bot/
│   ├── BookingBot.ts     # Teams 메시지/카드 핸들러
│   └── CardBuilder.ts    # Adaptive Card 생성
├── scraper/
│   ├── BrowserPool.ts    # Playwright 인스턴스 관리
│   ├── SiteAuthenticator.ts  # 로그인/세션 유지
│   ├── RoomScraper.ts    # 회의실 현황 스크래핑
│   ├── BookingExecutor.ts    # 예약/취소 실행
│   ├── DateNavigator.ts  # 날짜 네비게이션
│   └── selectors.json    # CSS 셀렉터 설정
├── data/
│   ├── database.ts       # SQLite 초기화/마이그레이션
│   ├── BookingRepository.ts  # 예약 CRUD
│   └── RoomRepository.ts    # 회의실 CRUD
└── utils/
    ├── logger.ts         # JSON 로깅
    └── queue.ts          # p-queue 설정
```

## 로컬 실행

```bash
# 의존성 설치
npm install

# Playwright 브라우저 설치
npx playwright install chromium

# 환경변수 설정
cp .env.example .env
# .env 파일에 값 채우기

# 개발 모드
npm run dev

# 빌드 & 실행
npm run build && npm start
```

## 테스트

```bash
# 단위 테스트 (37개)
npm test

# 타입 체크
npm run typecheck
```

## 환경변수

| 변수 | 설명 |
|------|------|
| `MILE_USERNAME` | 센터 예약 사이트 로그인 이메일 |
| `MILE_PASSWORD` | 센터 예약 사이트 비밀번호 |
| `MICROSOFT_APP_ID` | Azure Bot App ID |
| `MICROSOFT_APP_PASSWORD` | Azure Bot 클라이언트 비밀 |
| `MICROSOFT_APP_TENANT_ID` | Azure AD 테넌트 ID |
| `PORT` | 서버 포트 (기본: 3978) |

## 배포

main 브랜치에 push하면 GitHub Actions가 자동으로 Azure Container Apps에 배포합니다.

```
main push → Docker 빌드 → Azure Container Apps 배포
```
