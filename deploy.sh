#!/usr/bin/env bash
set -euo pipefail

# ─── 配置 ────────────────────────────────────────────────────────
SERVER="arcflow-server"
DEPLOY_DIR="/data/project/arcflow"
BRANCH="${1:-main}"

echo "=== ArcFlow 部署脚本 ==="
echo "服务器: $SERVER"
echo "部署目录: $DEPLOY_DIR"
echo "分支: $BRANCH"
echo ""

# ─── 1. 同步代码 ─────────────────────────────────────────────────
echo ">>> 同步代码到服务器..."
ssh "$SERVER" "mkdir -p $DEPLOY_DIR"

# 如果目标目录没有 git 仓库，先 clone
ssh "$SERVER" "
  if [ ! -d '$DEPLOY_DIR/.git' ]; then
    git clone https://github.com/ssyamv/ArcFlow.git $DEPLOY_DIR
  fi
  cd $DEPLOY_DIR
  git fetch origin
  git checkout $BRANCH
  git pull origin $BRANCH
"

# ─── 2. 检查 .env 文件 ──────────────────────────────────────────
echo ""
echo ">>> 检查环境配置..."
ssh "$SERVER" "
  cd $DEPLOY_DIR
  if [ ! -f packages/gateway/.env ]; then
    echo '⚠️  packages/gateway/.env 不存在，从模板创建...'
    cp packages/gateway/.env.example packages/gateway/.env
    echo '请编辑 packages/gateway/.env 填写实际配置'
  fi
"

# ─── 3. 构建并启动核心服务 ──────────────────────────────────────
echo ""
echo ">>> 构建并启动核心服务（Gateway + Web）..."
ssh "$SERVER" "
  cd $DEPLOY_DIR
  docker compose build --no-cache
  docker compose up -d
"

# ─── 4. 等待健康检查 ────────────────────────────────────────────
echo ""
echo ">>> 等待服务启动..."
sleep 5

ssh "$SERVER" "
  echo '--- Gateway ---'
  curl -sf http://localhost:3100/health && echo ' ✅' || echo ' ❌ Gateway 未就绪'

  echo '--- Web ---'
  curl -sf http://localhost:80 > /dev/null && echo '✅ Web 已就绪' || echo '❌ Web 未就绪'
"

# ─── 5. 显示状态 ────────────────────────────────────────────────
echo ""
echo ">>> 容器状态："
ssh "$SERVER" "cd $DEPLOY_DIR && docker compose ps"

echo ""
echo "=== 部署完成 ==="
echo "Gateway: http://172.29.230.21:3100"
echo "Web:     http://172.29.230.21"
echo ""
echo "其他服务（按需启动）："
echo "  Plane:  cd $DEPLOY_DIR/setup/plane && docker compose up -d"
echo "  NanoClaw: pm2 restart arcflow-nanoclaw"
