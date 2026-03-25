# mongo-restore

一个全栈 Web 应用，用于 MongoDB 备份文件的解析、浏览和恢复。支持物理备份（xbstream、tar.gz）和逻辑备份（mongodump archive/directory），提供可视化界面进行选择性恢复。

## 功能特性

- **多格式支持** — 物理备份（xbstream、tar.gz）和逻辑备份（mongodump archive、mongodump directory）
- **自动格式检测** — 上传后自动识别备份类型和格式
- **多版本 MongoDB** — 支持 MongoDB 4.2 / 8.0
- **可视化浏览** — 树形结构展示数据库、集合、文档数量
- **选择性恢复** — 按数据库/集合粒度选择恢复内容
- **多种恢复目标** — 恢复到远程 MongoDB 实例，或下载为 gzip/BSON/JSON 格式
- **实时进度** — 任务进度跟踪与实时日志展示

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Bun |
| 后端 | Hono、MongoDB Driver |
| 前端 | React 19、Vite、TypeScript、Tailwind CSS |
| 工具链 | mongorestore、mongodump、xbstream、tar |
| 部署 | Docker、Docker Compose |

## 项目结构

```
├── packages/
│   ├── server/          # 后端 API (Hono + Bun)
│   │   ├── src/
│   │   │   ├── routes/      # API 路由 (upload, backup, restore, download, tasks)
│   │   │   ├── services/    # 业务逻辑 (task-manager, restore, parser)
│   │   │   └── lib/         # 工具库 (mongod-manager, archive, utils)
│   │   └── index.ts
│   └── web/             # 前端 React SPA (Vite + Tailwind)
│       └── src/
│           ├── components/  # UI 组件 (FileUpload, BackupTree, RestorePanel...)
│           └── lib/         # API 客户端
├── Dockerfile           # 生产环境多阶段构建
├── Dockerfile.dev       # 开发环境（热重载）
├── docker-compose.yml
└── docker-compose.dev.yml
```

## 快速开始

### 一键部署

无需手动安装任何依赖，脚本会自动检测并安装 Docker，然后构建启动服务：

```bash
bash start.sh
```

脚本会自动完成：检测操作系统 → 检测/安装 Docker → 检测/启动 Docker 服务 → 识别 CPU 架构 → 构建并启动项目。

> 支持 Linux、macOS，Windows 请在 WSL2 中运行。

### Docker 手动部署

```bash
# 生产环境
docker compose up --build

# 开发环境（热重载）
docker compose -f docker-compose.dev.yml up --build
```

### 使用已构建镜像部署

适用于将镜像分发到其他机器，无需源码即可运行。

**构建机器上导出镜像：**

```bash
# 1. 构建镜像并打标签
docker compose build
docker tag mongo-restore-app mongo-restore:latest

# 2. 导出为文件（约 2-3GB）
docker save mongo-restore:latest -o mongo-restore.tar

# 3.（可选）压缩后更小
docker save mongo-restore:latest | gzip > mongo-restore.tar.gz
```

**目标机器上导入并运行：**

```bash
# 1. 导入镜像
docker load -i mongo-restore.tar
# 或导入压缩版
gunzip -c mongo-restore.tar.gz | docker load

# 2. 使用 docker-compose.prod.yml 启动（只需要这一个文件）
docker compose -f docker-compose.prod.yml up -d

# 3. 访问 http://localhost:3456
```

> 目标机器只需安装 Docker，不需要源码和构建环境。将 `docker-compose.prod.yml` 和 `mongo-restore.tar` 复制过去即可。

### 发布镜像到 Docker Registry

将镜像推送到镜像仓库（Docker Hub、阿里云 ACR、Harbor 等），其他机器直接 `docker pull` 即可使用。

**推送到 Docker Hub：**

```bash
# 1. 登录 Docker Hub
docker login

# 2. 构建并打标签（将 <username> 替换为你的 Docker Hub 用户名）
docker compose build
docker tag mongo-restore-app <username>/mongo-restore:latest

# 3. 推送
docker push <username>/mongo-restore:latest
```

**推送到阿里云 ACR：**

```bash
# 1. 登录阿里云容器镜像服务
docker login --username=<阿里云账号> registry.cn-hangzhou.aliyuncs.com

# 2. 打标签
docker tag mongo-restore-app registry.cn-hangzhou.aliyuncs.com/<命名空间>/mongo-restore:latest

# 3. 推送
docker push registry.cn-hangzhou.aliyuncs.com/<命名空间>/mongo-restore:latest
```

**其他机器拉取并运行：**

```bash
# 1. 拉取镜像（以 Docker Hub 为例）
docker pull <username>/mongo-restore:latest
docker tag <username>/mongo-restore:latest mongo-restore:latest

# 2. 启动服务
docker compose -f docker-compose.prod.yml up -d
```

> 也可以直接修改 `docker-compose.prod.yml` 中的 `image` 字段为完整镜像地址，省去手动 tag 步骤。

### 本地开发

前置要求：Bun、MongoDB Database Tools、Percona XtraBackup（物理备份需要）

```bash
bun install

# 同时启动前后端（开发模式）
bun run dev

# 或分别启动
bun run dev:server    # 后端
bun run dev:web       # 前端
```

## 使用流程

1. **上传** — 选择 MongoDB 备份文件（支持最大 10GB）
2. **配置** — 物理备份需选择 MongoDB 版本
3. **浏览** — 树形结构查看数据库和集合
4. **恢复** — 选择目标（远程 MongoDB 或下载）
5. **监控** — 实时查看恢复进度和日志

## 从零开始部署教程

### 方式一：Docker 部署（推荐）

Docker 方式无需手动安装任何依赖，镜像内已包含所有 MongoDB 版本和工具链。

#### 1. 安装 Docker

确保已安装 Docker 和 Docker Compose。

```bash
# windows/macOS：安装 Docker Desktop
# https://www.docker.com/products/docker-desktop/

# Linux（Ubuntu/Debian）：
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# 重新登录后生效
```

#### 2. 克隆项目

```bash
git clone <仓库地址>
cd mongo-restore
```

#### 3. 构建并启动

```bash
# 构建镜像并启动（首次构建约 10-15 分钟，需下载多版本 MongoDB）
docker compose up --build

# 或后台运行
docker compose up --build -d
```

#### 4. 访问服务

浏览器打开 http://localhost:3456 即可使用。

#### 5. 停止服务

```bash
docker compose down

# 如需同时清除备份数据卷
docker compose down -v
```

---

### 方式二：本地开发部署

适用于需要修改代码或调试的场景。需要在本机安装依赖工具。

#### 1. 安装 Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

安装完成后重启终端，验证：

```bash
bun --version
```

#### 2. 安装 MongoDB Database Tools

```bash
# macOS
brew tap mongodb/brew
brew install mongodb-database-tools

# Ubuntu/Debian
wget -qO - https://www.mongodb.org/static/pgp/server-8.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt-get update && sudo apt-get install -y mongodb-database-tools
```

验证安装：

```bash
mongorestore --version
mongodump --version
```

#### 3. 安装 Percona XtraBackup（物理备份需要）

如果只处理逻辑备份（mongodump 格式），可跳过此步。

```bash
# Ubuntu/Debian
sudo add-apt-repository universe
sudo apt-get update && sudo apt-get install -y percona-xtrabackup
```

#### 4. 安装 MongoDB Server（物理备份需要）

物理备份需要启动临时 mongod 实例。需要安装对应版本的 MongoDB Server，并通过环境变量指定路径：

```bash
# 例如安装 MongoDB 7.0（macOS）
brew tap mongodb/brew
brew install mongodb-community@7.0

# 设置环境变量（添加到 ~/.zshrc 或 ~/.bashrc）
export MONGOD_7_0=/usr/local/opt/mongodb-community@7.0/bin/mongod
```

#### 5. 克隆项目并安装依赖

```bash
git clone <仓库地址>
cd mongo-restore
bun install
```

#### 6. 启动开发服务

```bash
# 同时启动前后端（推荐）
bun run dev

# 或分别启动
bun run dev:server    # 后端 http://localhost:3456
bun run dev:web       # 前端 http://localhost:5173
```

#### 7. 构建生产版本

```bash
bun run build    # 构建前端
bun start        # 以生产模式启动服务
```

---

### 方式三：Docker 开发模式

兼顾 Docker 环境完整性与本地代码热重载。

```bash
# 启动（代码修改后自动重载）
docker compose -f docker-compose.dev.yml up --build

# 前端：http://localhost:5173
# 后端：http://localhost:3456
```

源码目录通过 volume 挂载，修改 `packages/server/src/` 或 `packages/web/src/` 下的文件会自动生效。

---

### 使用示例

启动服务后，通过浏览器操作：

1. **上传备份文件** — 在首页点击上传区域，选择 MongoDB 备份文件（支持 xbstream、tar.gz、mongodump archive 等格式，最大 10GB）
2. **选择 MongoDB 版本**（仅物理备份）— 选择与备份对应的 MongoDB 版本，点击启动临时实例
3. **浏览备份内容** — 展开树形结构，查看数据库、集合及文档数量
4. **选择恢复目标** — 勾选需要恢复的数据库/集合，选择恢复方式：
   - **远程 MongoDB**：填写连接地址（如 `mongodb://user:pass@host:27017`），数据直接恢复到目标实例
   - **下载**：选择导出格式（gzip / BSON / JSON），下载到本地
5. **查看进度** — 恢复过程中可实时查看进度条和日志输出

### 卸载与清理

#### 停止并删除容器

```bash
# 停止服务并删除容器
docker compose down

# 停止服务并同时删除数据卷（上传的备份文件和临时数据）
docker compose down -v
```

#### 删除构建的镜像

```bash
# 查看项目相关镜像
docker images | grep mongo-restore

# 删除镜像（镜像名根据实际目录名可能不同）
docker rmi mongo-restore-app
```

#### 完全清理（释放磁盘空间）

```bash
# 删除容器 + 数据卷 + 镜像，一步到位
docker compose down -v --rmi all

# 如果还想清理 Docker 构建缓存（会影响其他项目）
docker builder prune -f
```

#### 验证已清理干净

```bash
# 确认无残留容器
docker ps -a | grep mongo-restore

# 确认无残留镜像
docker images | grep mongo-restore

# 确认无残留数据卷
docker volume ls | grep mongo-restore
```

---

### 常见问题

**Q: 首次构建 Docker 镜像很慢？**
A: 首次构建需要下载 6 个版本的 MongoDB 二进制文件（约 2GB），后续构建会使用缓存。

**Q: 物理备份恢复提示版本不匹配？**
A: 物理备份必须使用与原始 MongoDB 相同主版本的 mongod 启动。请在版本选择步骤中选择正确的版本。

**Q: 上传大文件超时？**
A: 服务端支持最大 10GB 文件，请检查网络连接和反向代理（如 Nginx）的 `client_max_body_size` 配置。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/upload` | 上传备份文件 |
| GET | `/api/backups/:id` | 获取备份元数据 |
| GET | `/api/backups/:id/tree` | 获取备份结构树 |
| POST | `/api/backups/:id/start-mongod` | 启动临时 MongoDB 实例 |
| GET | `/api/backups/config/mongo-versions` | 获取可用 MongoDB 版本 |
| POST | `/api/restore` | 创建恢复任务 |
| GET | `/api/tasks/:id` | 查询任务状态 |
| GET | `/api/download/:taskId` | 下载恢复数据 |
| GET | `/api/health` | 健康检查 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3456` | 服务端口 |
| `UPLOAD_DIR` | `/tmp/backups` | 备份文件上传目录 |
| `DATA_DIR` | `/tmp/backup-data` | 临时数据目录 |

## Scripts

```bash
bun run dev          # 开发模式（前后端）
bun run build        # 构建前端
bun start            # 生产模式启动
bun run docker:dev   # Docker 开发环境
bun run docker:build # Docker 构建
bun run docker:up    # Docker 启动
```
