import path from 'path';
import os from 'os';

// 테스트용 임시 DB 파일 (인메모리 대신 — path.resolve가 :memory:를 절대경로로 변환하므로)
process.env.DB_PATH = path.join(os.tmpdir(), `booking-test-${process.pid}.db`);
// 스크래퍼 관련 env (테스트에서 실제 사용 안 함)
process.env.MILE_USERNAME = 'test@test.com';
process.env.MILE_PASSWORD = 'testpass';
process.env.MICROSOFT_APP_ID = 'test-app-id';
process.env.MICROSOFT_APP_PASSWORD = 'test-app-password';
