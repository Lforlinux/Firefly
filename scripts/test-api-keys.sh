#!/usr/bin/env bash
# Test Twelve Data and Alpha Vantage API keys with curl.
# Uses same symbols as the app: AAPL (NASDAQ), EQQQ/EIMI (LSE).
# Run from project root: ./scripts/test-api-keys.sh

set -e
cd "$(dirname "$0")/.."

# Load .env if present
if [ -f .env ]; then
  while IFS= read -r line; do
    case "$line" in
      VITE_TWELVEDATA_KEY=*) export VITE_TWELVEDATA_KEY="${line#*=}";;
      VITE_ALPHA_VANTAGE_KEY=*) export VITE_ALPHA_VANTAGE_KEY="${line#*=}";;
    esac
  done < .env
fi
TD_KEY="${TWELVEDATA_KEY:-$VITE_TWELVEDATA_KEY}"
AV_KEY="${ALPHA_VANTAGE_KEY:-$VITE_ALPHA_VANTAGE_KEY}"

# Curl helper: URL -> print body + "HTTP_CODE"
curl_td() {
  local url="$1"
  local resp code body
  resp=$(curl -s -w "\n%{http_code}" "$url")
  body=$(echo "$resp" | sed '$d')
  code=$(echo "$resp" | tail -1)
  echo "$body"
  echo "HTTP:$code"
}

echo "=== Twelve Data (key check: AAPL NASDAQ) ==="
if [ -z "$TD_KEY" ]; then
  echo "No key. Set VITE_TWELVEDATA_KEY in .env or TWELVEDATA_KEY=xxx"
  exit 1
fi
OUT=$(curl_td "https://api.twelvedata.com/quote?symbol=AAPL&exchange=NASDAQ&apikey=$TD_KEY")
BODY=$(echo "$OUT" | sed '$d')
CODE=$(echo "$OUT" | tail -1 | sed 's/HTTP://')
if [ "$CODE" = "200" ] && echo "$BODY" | grep -q '"close"'; then
  PRICE=$(echo "$BODY" | grep -o '"close":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "OK. Twelve Data key works. AAPL close: $PRICE"
else
  echo "Twelve Data key check failed ($CODE)"
  echo "$BODY" | head -3
fi

echo ""
echo "=== Twelve Data LSE ETFs (EQQQ, EIMI) — free tier often 404 / Grow plan ==="
for SYM in EQQQ EIMI; do
  OUT=$(curl_td "https://api.twelvedata.com/quote?symbol=$SYM&exchange=LSE&apikey=$TD_KEY")
  BODY=$(echo "$OUT" | sed '$d')
  CODE=$(echo "$OUT" | tail -1 | sed 's/HTTP://')
  if [ "$CODE" = "200" ] && echo "$BODY" | grep -q '"close"'; then
    PRICE=$(echo "$BODY" | grep -o '"close":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "  $SYM LSE: OK, close: $PRICE"
  else
    MSG=$(echo "$BODY" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "  $SYM LSE: $CODE — ${MSG:-$BODY}"
  fi
done

echo ""
echo "=== Alpha Vantage (fallback for LSE ETFs: EQQQ.L) ==="
if [ -z "$AV_KEY" ]; then
  echo "No key. Set VITE_ALPHA_VANTAGE_KEY in .env for LSE ETF fallback."
  exit 0
fi
OUT_AV=$(curl_td "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=EQQQ.L&apikey=$AV_KEY")
BODY_AV=$(echo "$OUT_AV" | sed '$d')
CODE_AV=$(echo "$OUT_AV" | tail -1 | sed 's/HTTP://')
if [ "$CODE_AV" = "200" ] && echo "$BODY_AV" | grep -q 'Global Quote'; then
  echo "OK. Alpha Vantage key works; EQQQ.L (LSE) will be used when Twelve Data has no quote."
else
  echo "Alpha Vantage check failed ($CODE_AV). LSE ETFs need AV key as fallback."
  echo "$BODY_AV" | head -3
fi
