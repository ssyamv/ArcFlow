#!/usr/bin/env bash
set -euo pipefail

SERVER="${ARCLOW_DEPLOY_SERVER:-arcflow-server}"
ARCFLOW_DIR="${ARCFLOW_DEPLOY_DIR:-/data/project/arcflow}"
NANOCLAW_DIR="${NANOCLAW_DEPLOY_DIR:-/data/project/nanoclaw}"
NANOCLAW_PM2_APP="${NANOCLAW_PM2_APP:-arcflow-nanoclaw}"

usage() {
  cat >&2 <<EOF
用法:
  $0 sync [branch]
  $0 up [branch]
  $0 status
  $0 verify
  $0 drift
  $0 rollback <git-ref>

当前可信路径:
  ArcFlow:  ${ARCFLOW_DIR}
  NanoClaw: ${NANOCLAW_DIR}
EOF
}

log() {
  printf '=== %s ===\n' "$*"
}

remote() {
  ssh "$SERVER" "$1"
}

sync_repo() {
  local branch="${1:-main}"
  log "同步 ArcFlow 仓库到 ${SERVER}:${ARCFLOW_DIR} (${branch})"
  remote "mkdir -p ${ARCFLOW_DIR}"
  remote "
    if [ ! -d '${ARCFLOW_DIR}/.git' ]; then
      git clone https://github.com/ssyamv/ArcFlow.git ${ARCFLOW_DIR}
    fi
    cd ${ARCFLOW_DIR}
    git fetch origin
    git checkout ${branch}
    git pull origin ${branch}
  "
}

ensure_gateway_env() {
  log "检查 Gateway 环境文件"
  remote "
    cd ${ARCFLOW_DIR}
    if [ ! -f packages/gateway/.env ]; then
      echo '⚠️  packages/gateway/.env 不存在，从模板创建...'
      cp packages/gateway/.env.example packages/gateway/.env
      echo '请编辑 packages/gateway/.env 填写实际配置'
    fi
  "
}

bring_up() {
  log "构建并启动 ArcFlow 核心服务"
  remote "
    cd ${ARCFLOW_DIR}
    docker compose build --no-cache
    docker compose up -d
  "
}

show_status() {
  log "ArcFlow 容器状态"
  remote "cd ${ARCFLOW_DIR} && docker compose ps"
}

verify_stack() {
  log "验证当前生产拓扑"
  printf 'ArcFlow 可信路径: %s\n' "$ARCFLOW_DIR"
  printf 'NanoClaw 可信路径: %s\n' "$NANOCLAW_DIR"

  remote "cd ${ARCFLOW_DIR} && docker compose ps"
  remote "curl -sf http://127.0.0.1:3100/health"
  remote "curl -I -sf http://127.0.0.1"
  remote "pm2 describe ${NANOCLAW_PM2_APP}"
}

inspect_drift() {
  log "检查 ArcFlow / NanoClaw 运行漂移"
  remote "pm2 describe ${NANOCLAW_PM2_APP}"
  remote "cd ${ARCFLOW_DIR} && git rev-parse --is-inside-work-tree"
  remote "cd ${NANOCLAW_DIR} && git rev-parse --is-inside-work-tree || true"
  remote "if [ -d /data/project/nanoclaw-fork ]; then cd /data/project/nanoclaw-fork && git rev-parse --is-inside-work-tree && git status --short; else echo 'nanoclaw-fork missing'; fi"
}

rollback_repo() {
  local ref="${1:-}"
  if [ -z "$ref" ]; then
    usage
    exit 1
  fi

  log "回滚 ArcFlow 到 ${ref}"
  remote "
    cd ${ARCFLOW_DIR}
    git fetch --all --tags
    git checkout ${ref}
    docker compose build --no-cache
    docker compose up -d
  "
  verify_stack
}

main() {
  local command="${1:-up}"

  case "$command" in
    sync)
      sync_repo "${2:-main}"
      ;;
    up)
      sync_repo "${2:-main}"
      ensure_gateway_env
      bring_up
      verify_stack
      ;;
    status)
      show_status
      ;;
    verify)
      verify_stack
      ;;
    drift)
      inspect_drift
      ;;
    rollback)
      rollback_repo "${2:-}"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
