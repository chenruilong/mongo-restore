#!/usr/bin/env bash
set -e

# ============================================================
# mongo-restore 一键部署脚本
# 自动检测并安装 Docker，构建并启动服务
# 用法: bash start.sh
# ============================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ------ 1. 检测操作系统 ------
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux*)  OS_TYPE="linux" ;;
  Darwin*) OS_TYPE="macos" ;;
  MINGW*|MSYS*|CYGWIN*)
    error "Windows 原生环境不支持，请在 WSL2 中运行此脚本。
  安装 WSL: https://learn.microsoft.com/zh-cn/windows/wsl/install" ;;
  *) error "不支持的操作系统: $OS" ;;
esac

info "操作系统: $OS_TYPE ($ARCH)"

# ------ 2. 检测并安装 Docker ------
install_docker_linux() {
  info "正在安装 Docker..."
  curl -fsSL https://get.docker.com | sh
  # 将当前用户加入 docker 组（避免每次 sudo）
  if [ "$(id -u)" -ne 0 ]; then
    sudo usermod -aG docker "$USER"
    warn "已将用户 $USER 加入 docker 组，如果后续命令提示权限不足，请重新登录终端后再运行此脚本。"
  fi
}

install_docker_macos() {
  if command -v brew &>/dev/null; then
    info "正在通过 Homebrew 安装 Docker Desktop..."
    brew install --cask docker
    info "Docker Desktop 已安装，请从应用程序中打开 Docker Desktop 并等待其启动完成，然后重新运行此脚本。"
    exit 0
  else
    error "未检测到 Docker，请手动安装 Docker Desktop:
  下载地址: https://www.docker.com/products/docker-desktop/
  安装完成并启动 Docker Desktop 后，重新运行此脚本。"
  fi
}

if command -v docker &>/dev/null; then
  info "Docker 已安装: $(docker --version)"
else
  warn "未检测到 Docker，开始安装..."
  case "$OS_TYPE" in
    linux) install_docker_linux ;;
    macos) install_docker_macos ;;
  esac
fi

# ------ 3. 检测 Docker 是否正在运行 ------
if ! docker info &>/dev/null; then
  if [ "$OS_TYPE" = "macos" ]; then
    warn "Docker 未运行，正在尝试启动 Docker Desktop..."
    open -a Docker
    echo -n "等待 Docker 启动"
    for i in $(seq 1 30); do
      if docker info &>/dev/null; then
        echo ""
        info "Docker 已启动。"
        break
      fi
      echo -n "."
      sleep 2
    done
    if ! docker info &>/dev/null; then
      echo ""
      error "Docker 启动超时，请手动打开 Docker Desktop 并等待其完全启动后，重新运行此脚本。"
    fi
  else
    # Linux: 尝试启动 docker 服务
    warn "Docker 未运行，正在尝试启动..."
    sudo systemctl start docker 2>/dev/null || sudo service docker start 2>/dev/null || true
    sleep 2
    if ! docker info &>/dev/null; then
      error "无法启动 Docker 服务，请手动启动后重新运行此脚本。"
    fi
    info "Docker 已启动。"
  fi
fi

# ------ 4. 检测 Docker Compose ------
if docker compose version &>/dev/null; then
  info "Docker Compose 可用: $(docker compose version --short 2>/dev/null || echo '已安装')"
else
  error "未检测到 Docker Compose，请确保 Docker 版本 >= 20.10 或手动安装 docker-compose-plugin。"
fi

# ------ 5. 检测镜像是否存在，决定是否需要构建 ------
IMAGE_NAME="$(basename "$(pwd)")-app"

if docker images --format '{{.Repository}}' | grep -q "^${IMAGE_NAME}$"; then
  info "镜像 ${IMAGE_NAME} 已存在，直接启动..."
  docker compose up -d
else
  info "镜像不存在，开始构建并启动（首次构建约 10-15 分钟）..."
  docker compose up --build -d
fi

echo ""
info "============================================"
info "  mongo-restore 已启动！"
info "  访问地址: http://localhost:3456"
info "============================================"
echo ""
info "常用命令："
info "  查看日志:   docker compose logs -f"
info "  停止服务:   docker compose down"
info "  重新构建:   docker compose up --build -d"
