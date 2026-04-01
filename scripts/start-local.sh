#!/bin/bash
# =============================================================
# 로컬 봇 서버 + Cloudflare Tunnel 시작 스크립트
# 사용법: bash scripts/start-local.sh
# =============================================================

set -e

CLOUDFLARED="C:/Users/sokch/cloudflared.exe"
BOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$BOT_DIR/logs"

mkdir -p "$LOG_DIR"

echo "=========================================="
echo "  Teams Booking Bot - Local Server"
echo "=========================================="

# 1. 빌드
echo "[1/3] TypeScript 빌드..."
cd "$BOT_DIR"
npm run build
cp -r src/bot/cards dist/bot/cards 2>/dev/null || true
cp src/scraper/selectors.json dist/scraper/selectors.json 2>/dev/null || true

# 2. 봇 서버 시작
echo "[2/3] 봇 서버 시작 (port 3978)..."
node dist/index.js > "$LOG_DIR/server.log" 2>&1 &
BOT_PID=$!
echo "  Bot PID: $BOT_PID"
sleep 3

# health check
if curl -s http://localhost:3978/health > /dev/null 2>&1; then
  echo "  ✓ 봇 서버 정상 기동"
else
  echo "  ✗ 봇 서버 시작 실패. 로그 확인: $LOG_DIR/server.log"
  cat "$LOG_DIR/server.log"
  exit 1
fi

# 3. Cloudflare Tunnel 시작
echo "[3/3] Cloudflare Tunnel 시작..."
"$CLOUDFLARED" tunnel --url http://localhost:3978 2>&1 | tee "$LOG_DIR/tunnel.log" &
TUNNEL_PID=$!
echo "  Tunnel PID: $TUNNEL_PID"

sleep 6

# 터널 URL 추출
TUNNEL_URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | head -1)

echo ""
echo "=========================================="
echo "  서버 시작 완료!"
echo "=========================================="
echo ""
echo "  봇 서버:  http://localhost:3978"
echo "  터널 URL: $TUNNEL_URL"
echo ""
echo "  ※ Azure Bot Service → Settings → Messaging endpoint를"
echo "    아래 URL로 변경하세요:"
echo ""
echo "    ${TUNNEL_URL}/api/messages"
echo ""
echo "  종료: Ctrl+C"
echo "=========================================="

# 종료 핸들러
cleanup() {
  echo ""
  echo "종료 중..."
  kill $BOT_PID 2>/dev/null
  kill $TUNNEL_PID 2>/dev/null
  echo "완료."
  exit 0
}
trap cleanup SIGINT SIGTERM

# 프로세스 감시
wait $BOT_PID $TUNNEL_PID
