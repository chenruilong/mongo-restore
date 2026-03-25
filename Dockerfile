# Stage 1: Build
FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN bun install --frozen-lockfile

COPY . .
RUN cd packages/web && bun run build

# Stage 2: Runtime
FROM ubuntu:24.04
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive

# Switch to USTC mirror for faster downloads in China
RUN sed -i 's|http://archive.ubuntu.com|http://mirrors.ustc.edu.cn|g; s|http://security.ubuntu.com|http://mirrors.ustc.edu.cn|g; s|http://ports.ubuntu.com|http://mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || \
    sed -i 's|http://archive.ubuntu.com|http://mirrors.ustc.edu.cn|g; s|http://security.ubuntu.com|http://mirrors.ustc.edu.cn|g; s|http://ports.ubuntu.com|http://mirrors.ustc.edu.cn|g' /etc/apt/sources.list 2>/dev/null || true

# Install base tools
RUN apt-get update && apt-get install -y \
    curl wget gnupg ca-certificates software-properties-common unzip tar gzip \
    && rm -rf /var/lib/apt/lists/*

# Install MongoDB Database Tools
RUN wget -qO - https://www.mongodb.org/static/pgp/server-8.0.asc | \
    gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg && \
    echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | \
    tee /etc/apt/sources.list.d/mongodb-org-8.0.list && \
    apt-get update && \
    apt-get install -y mongodb-database-tools && \
    rm -rf /var/lib/apt/lists/*

# Install Percona XtraBackup 8.0 (xbstream with --decompress, from Ubuntu universe)
RUN add-apt-repository universe && \
    apt-get update && \
    apt-get install -y percona-xtrabackup && \
    rm -rf /var/lib/apt/lists/*

# Install legacy OpenSSL runtime needed by MongoDB 4.2-5.0
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) libssl_url='http://mirrors.ustc.edu.cn/ubuntu/pool/main/o/openssl/libssl1.1_1.1.1f-1ubuntu2.24_amd64.deb'; mongo_arch='x86_64' ;; \
      arm64) libssl_url='http://mirrors.ustc.edu.cn/ubuntu-ports/pool/main/o/openssl/libssl1.1_1.1.1f-1ubuntu2.24_arm64.deb'; mongo_arch='aarch64' ;; \
      *) echo "Unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    wget -qO /tmp/libssl1.1.deb "$libssl_url"; \
    apt-get update; \
    apt-get install -y /tmp/libssl1.1.deb; \
    rm -f /tmp/libssl1.1.deb; \
    rm -rf /var/lib/apt/lists/*

# Install real multi-version mongod binaries
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) mongo_arch='x86_64' ;; \
      arm64) mongo_arch='aarch64' ;; \
      *) echo "Unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    install_mongod() { \
      major="$1"; full="$2"; distro="$3"; \
      url="https://fastdl.mongodb.org/linux/mongodb-linux-${mongo_arch}-${distro}-${full}.tgz"; \
      wget -qO /tmp/mongodb.tgz "$url"; \
      tar -xzf /tmp/mongodb.tgz -C /tmp; \
      extracted_dir="/tmp/mongodb-linux-${mongo_arch}-${distro}-${full}"; \
      mkdir -p "/opt/mongodb/${major}"; \
      cp -R "${extracted_dir}/bin" "/opt/mongodb/${major}/"; \
      rm -rf "$extracted_dir" /tmp/mongodb.tgz; \
    }; \
    install_mongod '4.2' '4.2.25' 'ubuntu1804'; \
    install_mongod '4.4' '4.4.29' 'ubuntu2004'; \
    install_mongod '5.0' '5.0.31' 'ubuntu2004'; \
    install_mongod '6.0' '6.0.18' 'ubuntu2204'; \
    install_mongod '7.0' '7.0.17' 'ubuntu2204'; \
    install_mongod '8.0' '8.0.5' 'ubuntu2404'

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

ENV MONGOD_4_2=/opt/mongodb/4.2/bin/mongod
ENV MONGOD_4_4=/opt/mongodb/4.4/bin/mongod
ENV MONGOD_5_0=/opt/mongodb/5.0/bin/mongod
ENV MONGOD_6_0=/opt/mongodb/6.0/bin/mongod
ENV MONGOD_7_0=/opt/mongodb/7.0/bin/mongod
ENV MONGOD_8_0=/opt/mongodb/8.0/bin/mongod

WORKDIR /app

# Copy built app
COPY --from=builder /app/packages/server ./packages/server
COPY --from=builder /app/packages/web/dist ./packages/web/dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Temp directories
RUN mkdir -p /tmp/backups /tmp/backup-data

EXPOSE 3456

CMD ["bun", "run", "packages/server/src/index.ts"]
