#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[ArcFlow]${NC} $*"; }
warn() { echo -e "${YELLOW}[ArcFlow]${NC} $*"; }
err()  { echo -e "${RED}[ArcFlow]${NC} $*" >&2; }

# 检查前置条件
check_deps() {
  for cmd in docker; do
    if ! command -v "$cmd" &>/dev/null; then
      err "需要安装 $cmd"
      exit 1
    fi
  done

  if ! docker compose version &>/dev/null; then
    err "需要 Docker Compose V2（docker compose）"
    exit 1
  fi
}

# 初始化 .env
init_env() {
  if [ ! -f .env ]; then
    warn ".env 不存在，从 .env.example 复制..."
    cp .env.example .env
    warn "请编辑 setup/.env 填写必要配置后重新运行"
    exit 1
  fi
}

# 主流程
main() {
  local action="${1:-up}"

  check_deps

  case "$action" in
    up)
      init_env
      log "启动所有服务..."
      docker compose up -d --build
      log "等待服务就绪..."
      sleep 5
      docker compose ps
      log "部署完成！"
      log "  Gateway:  http://localhost:${GATEWAY_PORT:-3100}/health"
      log "  Plane:    http://localhost:${PLANE_PORT:-8082}"
      log "  Dify:     http://localhost:${DIFY_WEB_PORT:-3001}"
      log "  Weaviate: http://localhost:${WEAVIATE_PORT:-8080}"
      ;;
    down)
      log "停止所有服务..."
      docker compose down
      ;;
    restart)
      log "重启所有服务..."
      docker compose restart
      ;;
    logs)
      docker compose logs -f "${2:-}"
      ;;
    status)
      docker compose ps
      ;;
    *)
      echo "用法: $0 {up|down|restart|logs [service]|status}"
      exit 1
      ;;
  esac
}

main "$@"
