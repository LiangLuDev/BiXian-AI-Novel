#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
PORT_SCAN_LIMIT="${PORT_SCAN_LIMIT:-50}"
WORKSPACE_DIR="${WORKSPACE_DIR:-$ROOT_DIR/.runtime}"
OPEN_BROWSER="${OPEN_BROWSER:-1}"
INSTALL_DEPS="${INSTALL_DEPS:-auto}"
BUILD_STATIC="${BUILD_STATIC:-auto}"

mkdir -p "$WORKSPACE_DIR"

is_truthy() { [[ "$1" == "1" || "$1" == "true" || "$1" == "yes" ]]; }

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm is required" >&2
  exit 1
fi

port_is_available() {
  local host="$1"
  local port="$2"
  node -e 'const net=require("node:net"); const host=process.argv[1]; const port=Number(process.argv[2]); const s=net.createServer(); s.once("error",()=>process.exit(1)); s.once("listening",()=>s.close(()=>process.exit(0))); s.listen(port, host);' "$host" "$port"
}

pick_port() {
  local host="$1"
  local preferred_port="$2"
  local scan_limit="$3"
  if [[ ! "$preferred_port" =~ ^[0-9]+$ ]] || (( preferred_port < 1 || preferred_port > 65535 )); then
    echo "error: invalid PORT '$preferred_port'" >&2
    exit 1
  fi
  for ((offset = 0; offset <= scan_limit; offset += 1)); do
    local candidate=$((preferred_port + offset))
    (( candidate > 65535 )) && break
    if port_is_available "$host" "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done
  echo "error: no available port found in range ${preferred_port}-$((preferred_port + scan_limit))" >&2
  exit 1
}

if is_truthy "$INSTALL_DEPS" || { [[ "$INSTALL_DEPS" == "auto" ]] && [[ ! -d "$ROOT_DIR/node_modules" ]]; }; then
  echo "Installing Node dependencies..."
  if [[ -f "$ROOT_DIR/package-lock.json" ]]; then
    npm ci >/dev/null
  else
    npm install >/dev/null
  fi
else
  echo "Skipping dependency install (set INSTALL_DEPS=1 to reinstall)."
fi

ensure_vendor_asset() {
  local file="$1"
  local url="$2"
  if [[ -f "$file" ]]; then return; fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "error: missing $file and curl is not available to download it" >&2
    exit 1
  fi
  echo "Downloading $(basename "$file")..."
  mkdir -p "$(dirname "$file")"
  curl -L -sS "$url" -o "$file"
}

ensure_vendor_asset "$ROOT_DIR/bixian/static/vendor/react.production.min.js" "https://unpkg.com/react@18.3.1/umd/react.production.min.js"
ensure_vendor_asset "$ROOT_DIR/bixian/static/vendor/react-dom.production.min.js" "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"

STATIC_BUNDLE="$ROOT_DIR/bixian/static/dist/app.js"
NEEDS_STATIC_BUILD=0
if is_truthy "$BUILD_STATIC"; then
  NEEDS_STATIC_BUILD=1
elif [[ "$BUILD_STATIC" == "auto" && ! -f "$STATIC_BUNDLE" ]]; then
  NEEDS_STATIC_BUILD=1
fi
if [[ "$NEEDS_STATIC_BUILD" == "1" ]]; then
  echo "Building static dashboard bundle..."
  npm run build:static >/dev/null
else
  echo "Static dashboard bundle is up to date."
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "warning: codex CLI not found on PATH. Generation will fail until codex is installed and logged in." >&2
fi

REQUESTED_PORT="$PORT"
PORT="$(pick_port "$HOST" "$PORT" "$PORT_SCAN_LIMIT")"
if [[ "$PORT" != "$REQUESTED_PORT" ]]; then
  echo "Port $REQUESTED_PORT is busy; using $PORT instead."
fi

URL="http://$HOST:$PORT"
echo "Starting 笔仙助手"
echo "Workspace: $WORKSPACE_DIR"
echo "URL: $URL"

if [[ "$OPEN_BROWSER" == "1" ]]; then
  if command -v open >/dev/null 2>&1; then
    (for _ in {1..30}; do curl -fsS "$URL" >/dev/null 2>&1 && break; sleep 0.2; done; open "$URL") >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    (for _ in {1..30}; do curl -fsS "$URL" >/dev/null 2>&1 && break; sleep 0.2; done; xdg-open "$URL") >/dev/null 2>&1 &
  fi
fi

exec node src/cli.mjs serve "$WORKSPACE_DIR" --host "$HOST" --port "$PORT"
