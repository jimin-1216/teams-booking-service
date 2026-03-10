# Teams 회의실 예약 챗봇 PRD

> **Version**: 1.1
> **Created**: 2026-03-10
> **Updated**: 2026-03-10
> **Status**: Draft (Reviewed)
> **Scale Grade**: Hobby (사내 도구)

## 1. Overview

### 1.1 Problem Statement
현재 회의실 예약을 위해 직원이 매번 외부 센터 예약 사이트에 직접 접속하여 로그인 후 수동으로 예약해야 한다. 이 과정은 번거롭고 시간이 소요되며, 예약 가능 현황 파악이 즉시 되지 않아 업무 효율이 떨어진다.

### 1.2 Goals
- Teams 채팅에서 대화형으로 회의실 조회/예약/취소를 수행할 수 있게 한다
- Playwright를 활용하여 외부 센터 예약 사이트를 자동화한다
- 직원들의 회의실 예약 소요 시간을 90% 이상 단축한다

### 1.3 Non-Goals (Out of Scope)
- 센터 예약 사이트 자체를 대체하는 것 (기존 사이트를 자동화하는 것이 목적)
- 다른 센터/빌딩의 회의실 예약
- 회의실 사용 현황 실시간 모니터링 (IoT 센서 등)
- 결제/과금 기능
- 자연어 처리(NLP) — 키워드 명령어 + Adaptive Card 폼 방식으로 입력 처리
- 예약 수정(변경) 기능 — 취소 후 재예약으로 대체

### 1.4 Scope
| 포함 | 제외 |
|------|------|
| 2층, 7층, 8층 회의실 예약 (약 15개실) | 다른 층/건물 회의실 |
| Teams 챗봇을 통한 조회/예약/취소 | 웹 대시보드 UI |
| Playwright 기반 센터 예약 사이트 자동화 | 센터 예약 사이트 API 직접 연동 |
| Adaptive Card 기반 예약 UI | 자연어 처리(NLP) |
| 예약 알림/리마인더 | 캘린더 자동 동기화 |

## 2. User Stories

### 2.1 회의실 조회
As a 직원, I want to Teams 채팅에서 특정 날짜/시간의 빈 회의실을 조회하고 싶다 so that 빠르게 사용 가능한 회의실을 찾을 수 있다.

### 2.2 회의실 예약
As a 직원, I want to Teams 챗봇에게 회의실 예약을 요청하면 자동으로 센터 예약 사이트에서 예약이 완료되길 원한다 so that 직접 사이트에 로그인할 필요가 없다.

### 2.3 예약 취소
As a 직원, I want to 기존 예약을 Teams에서 간편하게 취소하고 싶다 so that 불필요한 예약을 빠르게 해제할 수 있다.

### 2.4 내 예약 조회
As a 직원, I want to 내가 예약한 회의실 목록을 확인하고 싶다 so that 일정을 관리할 수 있다.

### 2.5 Acceptance Criteria (Gherkin)

```gherkin
Scenario: 빈 회의실 조회
  Given 직원이 Teams 챗봇에 "예약 조회" 명령어를 입력
  When 챗봇이 날짜/시간/층 선택 Adaptive Card 폼을 표시하고 직원이 입력 후 제출
  And 챗봇이 센터 예약 사이트에서 해당 시간의 예약 현황을 스크래핑
  Then 2층, 7층, 8층의 사용 가능한 회의실 목록을 Adaptive Card로 표시

Scenario: 회의실 예약
  Given 직원이 조회된 회의실 중 하나를 선택하고 예약 버튼 클릭
  When 챗봇이 Playwright로 센터 예약 사이트에 로그인하여 예약 진행
  Then 예약 성공 메시지와 예약 상세 정보를 Adaptive Card로 표시
  And 예약 정보가 로컬 DB에 저장

Scenario: 예약 실패 처리
  Given 직원이 회의실 예약을 요청했으나
  When 이미 다른 사람이 해당 시간을 선점한 경우
  Then "이미 예약된 시간입니다" 메시지와 대체 시간 제안

Scenario: 예약 취소
  Given 직원이 "내 예약 목록"을 조회
  When 특정 예약의 "취소" 버튼을 클릭
  Then 챗봇이 센터 예약 사이트에서 해당 예약을 취소하고 결과를 표시
```

## 3. Functional Requirements

| ID | Requirement | Priority | Dependencies |
|----|------------|----------|--------------|
| FR-001 | Playwright로 센터 예약 사이트 로그인 자동화 | P0 (Must) | - |
| FR-002 | 센터 예약 사이트에서 회의실 예약 현황 스크래핑 | P0 (Must) | FR-001 |
| FR-003 | 센터 예약 사이트에서 회의실 예약 실행 자동화 | P0 (Must) | FR-001 |
| FR-004 | 센터 예약 사이트에서 예약 취소 자동화 | P0 (Must) | FR-001 |
| FR-005 | Teams Bot Framework SDK 기반 챗봇 구현 | P0 (Must) | - |
| FR-006 | Adaptive Card를 활용한 회의실 목록/예약 UI | P0 (Must) | FR-005 |
| FR-007 | 날짜/시간/층 기반 회의실 조회 명령어 | P0 (Must) | FR-002, FR-005 |
| FR-008 | 내 예약 목록 조회 기능 | P1 (Should) | FR-005 |
| FR-009 | 예약 알림/리마인더 (예약 30분 전) | P1 (Should) | FR-005 |
| FR-010 | 센터 예약 사이트 공용 계정 자격증명을 환경변수로 안전 저장/관리 | P0 (Must) | - |
| FR-011 | 동시 예약 요청 시 인메모리 큐(p-queue) 기반 순차 처리 | P0 (Must) | FR-003 |
| FR-012 | 회의실 정보 캐싱 (층별, 수용인원 등) | P2 (Could) | FR-002 |
| FR-013 | 예약 상태 머신 (pending → confirmed/failed) 및 정합성 보장 | P0 (Must) | FR-003 |
| FR-014 | 스크래퍼 장애 시 사용자 폴백 메시지 및 관리자 알림 | P1 (Should) | FR-001 |
| FR-015 | 스크래핑 실행 로그 (소요시간, 성공/실패, 실패 시 스크린샷 캡처) | P1 (Should) | FR-001 |

### 3.1 자격증명 모델 (C-1 해결)

- **방식**: 센터 예약 사이트(https://app.mile.im/login) **공용 계정 1개** 사용
- **목적**: 직원들이 공용 아이디/비밀번호를 직접 알 필요 없이, 챗봇이 대신 로그인하여 예약
- **저장**: 환경변수 `MILE_USERNAME`, `MILE_PASSWORD`로 저장 (하드코딩 절대 금지)
- **예약자 구분**: 예약 시 비고란/메모란에 Teams 사용자 이름을 자동 기입하여 누가 예약했는지 식별
- **세션 관리**: SiteAuthenticator가 단일 브라우저 세션을 관리, 세션 만료 시 자동 재로그인

### 3.2 데이터 정합성 전략 (C-3 해결)

예약/취소 과정의 2단계(센터 예약 사이트 실행 + 로컬 DB 기록) 정합성 보장:

```
예약 요청 → DB에 pending 상태로 저장
         → Playwright로 센터 예약 사이트에서 예약 실행
         → 성공 시: DB를 confirmed로 업데이트
         → 실패 시: DB를 failed로 업데이트 + 사용자에게 실패 알림
         → 타임아웃 시: DB를 failed로 업데이트 + "확인 필요" 메시지
```

- **Reconciliation (정기 동기화)**: 매일 09:00에 센터 예약 사이트의 실제 예약 현황과 로컬 DB를 비교하여 불일치 감지 시 관리자에게 Teams 알림
- **타임아웃**: 스크래핑 작업 30초 초과 시 실패 처리

### 3.3 예약 비즈니스 규칙 (M-3 해결)

| 규칙 | 값 | 비고 |
|------|-----|------|
| 예약 시간 단위 | 센터 예약 사이트 기준에 따름 | Phase 1에서 사이트 분석 후 확정 |
| 예약 가능 시간대 | 센터 예약 사이트 기준에 따름 | Phase 1에서 사이트 분석 후 확정 |
| 1인당 최대 예약 건수 | 제한 없음 (센터 예약 사이트 정책 따름) | |
| 사전 예약 가능 일수 | 센터 예약 사이트 기준에 따름 | Phase 1에서 사이트 분석 후 확정 |
| 최소/최대 예약 시간 | 센터 예약 사이트 기준에 따름 | Phase 1에서 사이트 분석 후 확정 |

> 센터 예약 사이트의 실제 제약조건을 Phase 1 사이트 분석에서 파악 후 이 테이블을 업데이트합니다.

## 4. Non-Functional Requirements

### 4.0 Scale Grade

| 항목 | 값 |
|------|-----|
| Scale Grade | **Hobby (사내 도구)** |
| 예상 DAU | < 100 (사내 직원) |
| 동시접속 | < 10 |
| 데이터량 | < 100MB |

### 4.1 Performance SLA

| 지표 | 목표값 |
|------|--------|
| 회의실 조회 응답 시간 | < 10초 (스크래핑 포함) |
| 예약 실행 시간 | < 15초 (스크래핑 포함) |
| 챗봇 응답 (비스크래핑) | < 2초 |

> Playwright 스크래핑 특성상 일반 API 호출보다 응답이 느릴 수 있음

### 4.2 Availability SLA

| 등급 | Uptime | 허용 다운타임(월) |
|------|--------|-----------------|
| Hobby | 95% | 36시간 |

> 근무 시간(평일 09:00-18:00)에만 안정적으로 동작하면 충분

### 4.3 Data Requirements

| 항목 | 값 |
|------|-----|
| 현재 데이터량 | 0 (신규) |
| 월간 증가율 | 미미 (예약 기록) |
| 데이터 보존 기간 | 6개월 |

### 4.4 Recovery

| 항목 | 값 |
|------|-----|
| RTO (복구 시간) | 24시간 |
| RPO (복구 시점) | 24시간 |

### 4.5 Security
- **센터 예약 사이트 자격증명**: 환경변수(`MILE_USERNAME`, `MILE_PASSWORD`)로 저장. 코드/로그/응답에 절대 노출 금지
- **Teams Bot 인증**: Azure Bot Service 기반 인증
- **Data encryption**: In transit (HTTPS)
- **접근 제어**: 사내 Teams 테넌트 내 사용자만 접근 가능
- **로그 보안**: 스크래핑 로그에 자격증명, 세션 토큰 등 민감 정보 마스킹

### 4.6 환경변수 관리 전략

**관리 대상 환경변수**:

| 변수명 | 용도 | 민감도 |
|--------|------|--------|
| `MILE_USERNAME` | 센터 예약 사이트 공용 계정 아이디 | Secret |
| `MILE_PASSWORD` | 센터 예약 사이트 공용 계정 비밀번호 | Secret |
| `MICROSOFT_APP_ID` | Azure Bot Service 앱 ID | Secret |
| `MICROSOFT_APP_PASSWORD` | Azure Bot Service 앱 비밀번호 | Secret |
| `NODE_ENV` | 실행 환경 (development / production) | Normal |
| `LOG_LEVEL` | 로그 레벨 (debug / info) | Normal |

**환경별 관리 방식**:

| 환경 | 방식 | 비고 |
|------|------|------|
| 로컬 개발 | `.env` 파일 | `.gitignore`에 반드시 추가, 커밋 금지 |
| Azure 배포 | Container Apps Secrets | 무료, Azure Portal에서 마스킹 표시 |

**Azure Container Apps Secrets 적용 방법**:

```bash
# 1. 시크릿 등록
az containerapp secret set \
  --name teams-booking-bot \
  --resource-group rg-booking \
  --secrets \
    mile-username="실제아이디" \
    mile-password="실제비밀번호" \
    ms-app-id="앱ID" \
    ms-app-password="앱비밀번호"

# 2. 시크릿을 환경변수로 매핑
az containerapp update \
  --name teams-booking-bot \
  --resource-group rg-booking \
  --set-env-vars \
    MILE_USERNAME=secretref:mile-username \
    MILE_PASSWORD=secretref:mile-password \
    MICROSOFT_APP_ID=secretref:ms-app-id \
    MICROSOFT_APP_PASSWORD=secretref:ms-app-password \
    NODE_ENV=production \
    LOG_LEVEL=info
```

**Container Apps Secrets 특성**:
- Azure Portal에서 값이 마스킹 처리되어 표시
- 컨테이너 내부에서만 환경변수로 접근 가능
- 로그/API 응답에 노출되지 않음
- Azure Key Vault(유료) 없이도 Hobby 규모에 충분한 보안 수준

**`.env.example` 템플릿** (프로젝트 루트에 커밋):

```env
# 센터 예약 사이트 (https://app.mile.im)
MILE_USERNAME=
MILE_PASSWORD=

# Azure Bot Service
MICROSOFT_APP_ID=
MICROSOFT_APP_PASSWORD=

# App Config
NODE_ENV=development
LOG_LEVEL=debug
```

> `.env` 파일은 절대 커밋하지 않으며, `.env.example`만 커밋하여 필요한 변수 목록을 공유합니다.

## 5. Technical Design

### 5.1 Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   MS Teams      │────▶│  Bot Service     │────▶│  Booking Engine     │
│   (사용자)       │◀────│  (Bot Framework) │◀────│  (Playwright)       │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
                              │                         │
                              ▼                         ▼
                        ┌──────────┐            ┌───────────────┐
                        │ SQLite   │            │ 외부 센터      │
                        │ (예약DB) │            │ 예약 사이트     │
                        └──────────┘            └───────────────┘
```

### 5.2 Technology Stack

| 영역 | 기술 | 이유 |
|------|------|------|
| Runtime | Node.js 20+ (TypeScript) | Bot Framework SDK 네이티브, Playwright 1급 지원 |
| Bot Framework | botbuilder v4 | Teams 공식 SDK, Adaptive Card 지원 |
| 스크래핑 | Playwright | 동적 사이트 자동화, headless 브라우저 |
| DB | SQLite (better-sqlite3) | Hobby 규모에 적합, 설정 불필요 |
| 작업 큐 | p-queue (인메모리) | Hobby 규모에 적합, Redis 불필요 |
| 스케줄러 | node-cron | 리마인더, 정기 동기화(reconciliation) |
| 배포 | Azure Container Apps (무료 티어) | Playwright Docker 실행 가능, 월 무료 크레딧 포함 |
| 컨테이너 | Docker (Playwright 포함) | headless 브라우저 실행 환경 보장 |

### 5.3 Core Components

#### 5.3.1 Scraper Module (`src/scraper/`)
- `SiteAuthenticator` - 센터 예약 사이트 로그인/세션 관리 (공용 계정)
- `RoomScraper` - 회의실 현황 스크래핑
- `BookingExecutor` - 예약/취소 실행
- `BrowserPool` - Playwright 브라우저 인스턴스 관리 (최대 1~2개, 인메모리 큐로 순차 처리)
- `SelectorConfig` - CSS 셀렉터 외부 설정 파일 (사이트 변경 시 코드 수정 없이 업데이트)

#### 5.3.2 Bot Module (`src/bot/`)
- `BookingBot` - 메인 봇 로직 (ActivityHandler)
- `DialogManager` - 대화 흐름 관리
- `CardBuilder` - Adaptive Card 생성

#### 5.3.3 Data Module (`src/data/`)
- `BookingRepository` - 예약 데이터 CRUD
- `RoomRepository` - 회의실 정보 관리

### 5.4 Database Schema

```sql
-- 회의실 정보 (캐싱)
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  floor INTEGER NOT NULL,          -- 2, 7, 8
  capacity INTEGER,
  external_id TEXT NOT NULL,       -- 센터 예약 사이트에서의 식별자
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 예약 기록
CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  user_id TEXT NOT NULL,           -- Teams 사용자 ID
  user_name TEXT NOT NULL,
  date TEXT NOT NULL,              -- YYYY-MM-DD
  start_time TEXT NOT NULL,        -- HH:mm
  end_time TEXT NOT NULL,          -- HH:mm
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, confirmed, cancelled, failed
  external_booking_id TEXT,        -- 센터 예약 사이트 예약 ID
  error_message TEXT,              -- 실패 시 에러 메시지
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_bookings_user ON bookings(user_id, status);
CREATE INDEX idx_bookings_date_room ON bookings(date, room_id, status);
```

### 5.5 Bot Commands & Flows

| 명령어 | 설명 | 예시 입력 |
|--------|------|----------|
| `예약 조회` | 특정 날짜/시간 빈 회의실 조회 | "예약 조회" → Adaptive Card 폼 표시 |
| `예약` | 회의실 예약 | Adaptive Card 버튼 클릭 |
| `취소` | 예약 취소 | "내 예약" → 취소 버튼 |
| `내 예약` | 내 예약 목록 조회 | "내 예약 목록" |
| `도움말` | 사용법 안내 | "도움말" |

### 5.6 Adaptive Card Flows

**1. 조회 요청 Card**
```
┌──────────────────────────────┐
│  🏢 회의실 예약 조회          │
│                              │
│  📅 날짜: [날짜 선택기]      │
│  ⏰ 시작: [시간 선택]        │
│  ⏰ 종료: [시간 선택]        │
│  🏗️ 층:  [2층/7층/8층/전체] │
│                              │
│  [조회하기]                  │
└──────────────────────────────┘
```

**2. 조회 결과 Card**
```
┌──────────────────────────────┐
│  📋 3/15(금) 14:00-15:00     │
│  빈 회의실 5개               │
│                              │
│  2층                         │
│  ├ 회의실 A (4인) [예약]     │
│  └ 회의실 B (8인) [예약]     │
│                              │
│  7층                         │
│  ├ 세미나실 (20인) [예약]    │
│  └ 소회의실 (4인) [예약]     │
│                              │
│  8층                         │
│  └ 대회의실 (30인) [예약]    │
└──────────────────────────────┘
```

**3. 예약 확인 Card**
```
┌──────────────────────────────┐
│  ✅ 예약 완료!               │
│                              │
│  📍 7층 세미나실             │
│  📅 2026-03-15 (금)          │
│  ⏰ 14:00 - 15:00            │
│  👤 홍길동                    │
│                              │
│  [취소하기]                  │
└──────────────────────────────┘
```

### 5.7 API Specification (Internal)

#### `POST /api/bookings/search`

**Description**: 빈 회의실 조회 (Bot → Booking Engine 내부 호출)

**Request Body**:
```json
{
  "date": "string (required) - YYYY-MM-DD 형식",
  "startTime": "string (required) - HH:mm 형식",
  "endTime": "string (required) - HH:mm 형식",
  "floor": "number (optional) - 2, 7, 8 중 택1. 미지정 시 전체"
}
```

**Response 200 OK**:
```json
{
  "success": true,
  "data": {
    "date": "2026-03-15",
    "startTime": "14:00",
    "endTime": "15:00",
    "availableRooms": [
      {
        "id": "room_2f_a",
        "name": "회의실 A",
        "floor": 2,
        "capacity": 4,
        "available": true
      }
    ]
  }
}
```

#### `POST /api/bookings`

**Description**: 회의실 예약 실행

**Request Body**:
```json
{
  "roomId": "string (required) - 회의실 ID",
  "date": "string (required) - YYYY-MM-DD",
  "startTime": "string (required) - HH:mm",
  "endTime": "string (required) - HH:mm",
  "userId": "string (required) - Teams 사용자 ID",
  "userName": "string (required) - 사용자 표시 이름"
}
```

**Response 200 OK**:
```json
{
  "success": true,
  "data": {
    "bookingId": "bk_abc123",
    "room": {
      "id": "room_2f_a",
      "name": "회의실 A",
      "floor": 2
    },
    "date": "2026-03-15",
    "startTime": "14:00",
    "endTime": "15:00",
    "status": "confirmed"
  }
}
```

**Error Responses**:
| Status | Code | Message |
|--------|------|---------|
| 400 | INVALID_INPUT | 잘못된 요청 파라미터 |
| 409 | ALREADY_BOOKED | 이미 예약된 시간입니다 |
| 500 | SCRAPER_ERROR | 센터 예약 사이트 접근 실패 |
| 503 | SITE_UNAVAILABLE | 센터 예약 사이트 점검 중 |

#### `DELETE /api/bookings/:id`

**Description**: 예약 취소

**Response 200 OK**:
```json
{
  "success": true,
  "data": {
    "bookingId": "bk_abc123",
    "status": "cancelled"
  }
}
```

#### `GET /api/bookings/me?userId={userId}`

**Description**: 내 예약 목록 조회

**Response 200 OK**:
```json
{
  "success": true,
  "data": {
    "bookings": [
      {
        "bookingId": "bk_abc123",
        "room": { "id": "room_2f_a", "name": "회의실 A", "floor": 2 },
        "date": "2026-03-15",
        "startTime": "14:00",
        "endTime": "15:00",
        "status": "confirmed"
      }
    ]
  }
}
```

### 5.8 배포 아키텍처 (C-2 해결)

**확정 환경**: Azure Container Apps (무료 티어)

```
┌─────────────────────────────────────────────────────────┐
│  Azure Container Apps (무료 티어)                        │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Docker Container                               │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │    │
│  │  │ Bot API  │  │ Scraper  │  │ Chromium     │  │    │
│  │  │ (Express)│──│ Engine   │──│ (headless)   │  │    │
│  │  └──────────┘  └──────────┘  └──────────────┘  │    │
│  │  ┌──────────┐                                   │    │
│  │  │ SQLite   │ (컨테이너 내 볼륨)                │    │
│  │  └──────────┘                                   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  환경변수: MILE_USERNAME, MILE_PASSWORD,                │
│           MICROSOFT_APP_ID, MICROSOFT_APP_PASSWORD      │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│ Azure Bot       │ ← Teams 채널 연결 (무료)
│ Service (F0)    │
└─────────────────┘
```

**무료 티어 제약 및 대응**:
| 항목 | Azure Container Apps 무료 티어 | 대응 |
|------|-------------------------------|------|
| vCPU | 월 180,000 vCPU-초 | Hobby 규모 충분 |
| 메모리 | 월 360,000 GiB-초 | Playwright 1인스턴스 기준 적합 |
| 요청 수 | 월 200만 건 | DAU < 100 충분 |
| 스케일 다운 | 0으로 축소 가능 | 콜드 스타트 시 첫 응답 10~15초 소요 |

**Dockerfile 요구사항**:
- Base: `mcr.microsoft.com/playwright:v1.x-jammy`
- Chromium만 설치 (Firefox/WebKit 제외로 이미지 경량화)
- 멀티스테이지 빌드로 최종 이미지 최소화

**Phase 1 PoC 항목**: Azure Container Apps에서 Playwright headless 실행 검증을 Phase 1 첫 번째 태스크로 수행

### 5.9 장애 대응 전략 (M-2, M-6 해결)

**스크래퍼 장애 감지 및 대응**:

| 상황 | 감지 | 사용자 메시지 | 관리자 알림 |
|------|------|-------------|------------|
| 센터 예약 사이트 접속 불가 | 연결 타임아웃 | "센터 예약 사이트에 접속할 수 없습니다. 잠시 후 다시 시도해주세요." | 연속 3회 실패 시 Teams 채널 알림 |
| 로그인 실패 | 로그인 후 URL/DOM 검증 | "예약 시스템 인증에 문제가 있습니다. 관리자에게 문의해주세요." | 즉시 알림 |
| 셀렉터 불일치 (사이트 변경) | 필수 요소 미발견 | "예약 사이트 구조가 변경되었습니다. 직접 사이트를 이용해주세요: https://app.mile.im/login" | 즉시 알림 |
| 스크래핑 타임아웃 | 30초 초과 | "요청 처리 시간이 초과되었습니다. 다시 시도해주세요." | 연속 3회 시 알림 |

**브라우저 인스턴스 관리 (M-1 해결)**:
- 최대 동시 브라우저 인스턴스: **1개** (메모리 절약)
- 큐 최대 대기: **5건** (초과 시 "잠시 후 다시 시도" 메시지)
- 큐 대기 타임아웃: **60초** (초과 시 자동 취소)
- 브라우저 재시작: **매 10회 작업** 또는 **메모리 500MB 초과** 시

**로깅 요구사항**:
- 로그 레벨: `info` (운영), `debug` (개발)
- 로그 포맷: JSON (timestamp, level, module, message, duration_ms)
- 스크래핑 실행 로그: 소요시간, 성공/실패, 대상 URL
- 실패 시: 스크린샷 캡처 저장 (`/logs/screenshots/`)
- 민감정보 마스킹: 자격증명, 세션 토큰 등 로그 출력 금지

### 5.10 테스트 전략 (M-5 해결)

| 영역 | 방법 | 도구 |
|------|------|------|
| Scraper 단위 테스트 | 센터 예약 사이트 HTML 스냅샷 기반 mock 테스트 | Vitest + Playwright mock |
| Bot 단위 테스트 | Bot Framework Testing 유틸리티 | botbuilder-testing |
| 통합 테스트 | Scraper ↔ Bot 연동 테스트 (mock 사이트) | Vitest |
| E2E 테스트 | 스테이징 환경에서 수동 테스트 | 수동 체크리스트 |

> 실제 센터 예약 사이트에 테스트 예약을 할 수 없으므로, HTML 스냅샷 기반 mock 테스트가 핵심 테스트 전략입니다.

## 6. Implementation Phases

### Phase 1: 환경 설정 & 사이트 분석
- [ ] **[PoC] Azure Container Apps에서 Playwright headless 실행 검증**
- [ ] 프로젝트 초기화 (TypeScript, ESLint, Prettier)
- [ ] Dockerfile 작성 (Playwright + Node.js)
- [ ] Playwright 설치 및 센터 예약 사이트(https://app.mile.im/login) 구조 분석
- [ ] 사이트 로그인 플로우 파악 및 자동화 프로토타입
- [ ] 회의실 목록/ID 매핑 정보 수집
- [ ] 예약 비즈니스 규칙(시간 단위, 가능 시간대 등) 파악 후 PRD 업데이트

**Deliverable**: Playwright PoC 성공 + 센터 예약 사이트 스크래핑 프로토타입 + 사이트 구조 분석 문서

### Phase 2: Scraper 엔진 구현
- [ ] SiteAuthenticator 구현 (로그인/세션 유지)
- [ ] RoomScraper 구현 (회의실 현황 조회)
- [ ] BookingExecutor 구현 (예약/취소 실행)
- [ ] BrowserPool 구현 (브라우저 인스턴스 관리)
- [ ] 에러 핸들링 및 재시도 로직

**Deliverable**: 독립 실행 가능한 스크래핑 엔진

### Phase 3: Teams Bot 구현
- [ ] Bot Framework SDK 설정 및 Azure Bot 등록
- [ ] BookingBot ActivityHandler 구현
- [ ] 대화 흐름 (Dialog) 구현
- [ ] Adaptive Card 디자인 및 구현
- [ ] Bot ↔ Scraper 연동

**Deliverable**: Teams에서 동작하는 예약 챗봇

### Phase 4: DB & 안정화
- [ ] SQLite DB 스키마 생성 및 Repository 구현
- [ ] 예약 기록 저장/조회 기능
- [ ] 동시 요청 큐 처리
- [ ] 에러 핸들링 강화
- [ ] 통합 테스트

**Deliverable**: 안정적으로 동작하는 전체 시스템

### Phase 5: 배포 & 운영
- [ ] Azure Container Apps 배포 설정
- [ ] Azure Bot Service (F0 무료) 등록 및 Teams 채널 연결
- [ ] 환경변수/시크릿 관리 (.env 템플릿 + Container Apps 환경변수)
- [ ] JSON 로깅 설정
- [ ] 사용자 가이드 작성

**Deliverable**: 운영 환경 배포 완료

## 7. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| 예약 소요 시간 | 기존 대비 90% 단축 (수동 5분 → 자동 30초) | 예약 실행 시간 로그 |
| 예약 성공률 | 95% 이상 | 성공/실패 로그 비율 |
| 사용자 채택률 | 전 직원의 50% 이상 | 월간 활성 사용자 수 |
| 챗봇 응답 시간 | 스크래핑 포함 < 15초 | 응답 시간 로그 |

## 8. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| 센터 예약 사이트 UI 변경 시 스크래퍼 깨짐 | High | Medium | CSS 셀렉터 외부 설정 파일 분리, 연속 3회 실패 시 관리자 알림, 폴백 메시지로 직접 사이트 URL 안내 |
| 센터 예약 사이트 접속 차단 (봇 탐지) | High | Low | 적절한 요청 간격, User-Agent 설정 |
| Playwright 메모리 사용량 과다 | Medium | Medium | 인스턴스 1개 제한, 10회 작업마다 또는 500MB 초과 시 브라우저 재시작 |
| 센터 예약 사이트 로그인 정책 변경 (MFA 등) | High | Low | 자격증명 관리 추상화, MFA 대응 준비 |
| Azure 무료 티어 콜드 스타트 | Low | High | 첫 응답 지연(10~15초) 안내 메시지, 필요 시 최소 인스턴스 1로 설정 |
| 센터 예약 사이트 예약 성공 후 DB 기록 실패 | High | Low | pending 상태 선행 기록 + 매일 09:00 reconciliation 배치 |

## 9. 용어 정의

| 용어 | 정의 |
|------|------|
| 센터 예약 사이트 | 입주 센터에서 제공하는 회의실 예약 웹사이트 (https://app.mile.im) |
| 공용 계정 | 회사 전체가 공유하는 센터 예약 사이트 1개 계정 |
| 스크래퍼 | Playwright를 이용하여 센터 예약 사이트를 자동 조작하는 모듈 |
| Reconciliation | 센터 예약 사이트의 실제 예약 현황과 로컬 DB를 비교하여 불일치를 감지하는 정기 동기화 작업 |
