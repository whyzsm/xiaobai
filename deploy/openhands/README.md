# Xiaobai on OpenHands / 在 OpenHands 中运行小白

## 中文

### 目标

这个目录把小白、小能和 Obsidian 记忆接入固定版本的 OpenHands Agent Canvas。它不修改 OpenHands 源码，不合并小白和小能仓库，也不包含七个 T-MAX 业务代码仓。

运行边界：

- 小白：`/projects/xiaobai`，读写，使用独立 runtime Git 工作副本。
- 小能：`/opt/xiaoneng`，只读，固定为 `versions.lock` 中的提交。
- Obsidian：`/memory/obsidian`，读写，保存接收方自己的持久记忆。
- OpenHands 状态：`/home/openhands/.openhands`，持久化到 runtime 私有目录。

### 前置条件

- Docker Desktop 或 Docker Engine。
- Docker Compose v2。
- Git。
- 可访问已配置模型的网络和 API Key。

源代码仓不要求宿主机安装 Node.js；工作区初始化在固定的 OpenHands 容器中执行。

### 配置

```bash
cp deploy/openhands/.env.example deploy/openhands/.env
```

至少填写：

```dotenv
LLM_API_KEY=your-key
LLM_MODEL=provider/model
```

真实 Key 只能留在 ignored 的 `.env` 或进程环境中。不要把它写入 `compose.yaml`、`versions.lock`、Git bundle 或文档。

`OBSIDIAN_VAULT_PATH` 留空时使用 runtime 下的新空 Vault。若指定已有 Vault，启动器只在以下项目目录中初始化缺失文件，不覆盖已有内容：

```text
88-学习/xiaobai/10-项目记忆/xbaiProjectCode
```

### 从源码生成分发包

小白 `OpenHands` 和小能 `xiaoneng2.0` 必须都处于干净、已提交状态：

```bash
./deploy/openhands/package.sh --xiaoneng /path/to/xiaoneng
```

脚本在 ignored 的 `dist/` 下生成：

```text
xiaobai-openhands-<commit>/
├── artifacts/
│   ├── xiaobai.bundle
│   └── xiaoneng.bundle
├── deploy/openhands/
├── SHA256SUMS
└── runtime/                 # 首次启动时创建
```

同时生成同名 `.tar.gz`。包中只包含已提交状态；任何未提交改动都会阻断打包。

两个 Git bundle 都是无历史的分发快照。resolved `versions.lock` 同时记录来源仓提交和快照提交；小白现有 `workspace/memory/loops/**`、本机路径报告和个人 Obsidian Vault 不进入快照。

### 启动与停止

接收方解压后执行：

```bash
cp deploy/openhands/.env.example deploy/openhands/.env
./deploy/openhands/run.sh
```

访问：`http://localhost:8000/canvas`。

停止但保留工作区、OpenHands 状态和 Obsidian 记忆：

```bash
./deploy/openhands/stop.sh
```

### 体检

```bash
./deploy/openhands/doctor.sh
```

体检覆盖固定镜像、Git 版本、三类挂载、容器记忆路径、`t-max -> xiaoneng` 路由、凭据/个人路径扫描、包校验和和运行时只读验证。

同一个 Obsidian 项目目录只允许一个 OpenHands 写入实例。`run.sh` 使用 `.xiaobai-writer.lock` 阻止并发写入；正常停止会释放锁，记忆文件不会删除。

### 更新边界

- 更新小白：在 `OpenHands` 分支完成并提交，再重新打包。
- 更新小能：先在小能仓提交并验证，再更新 `versions.lock` 的 `XIAONENG_COMMIT`。
- 更新 OpenHands：只在验证兼容后同时更新 `OPENHANDS_VERSION`、`OPENHANDS_IMAGE` 和 `OPENHANDS_SOURCE_COMMIT`。
- 默认包不携带个人 Vault、模型密钥、SSH 配置、本机软链接或七个 T-MAX 业务仓。

## English

### Purpose

This directory connects Xiaobai, Xiaoneng, and Obsidian memory to a pinned OpenHands Agent Canvas release. It does not modify OpenHands source, merge the Xiaobai and Xiaoneng repositories, or include the seven T-MAX business repositories.

Runtime boundaries:

- Xiaobai: `/projects/xiaobai`, writable, using an isolated runtime Git checkout.
- Xiaoneng: `/opt/xiaoneng`, read-only, pinned to the commit in `versions.lock`.
- Obsidian: `/memory/obsidian`, writable, storing the recipient's persistent memory.
- OpenHands state: `/home/openhands/.openhands`, persisted in a private runtime directory.

### Prerequisites

- Docker Desktop or Docker Engine.
- Docker Compose v2.
- Git.
- Network access and an API key for the selected model.

The host does not need Node.js. Workspace initialization runs inside the pinned OpenHands container.

### Configuration

```bash
cp deploy/openhands/.env.example deploy/openhands/.env
```

Set at least:

```dotenv
LLM_API_KEY=your-key
LLM_MODEL=provider/model
```

Real keys belong only in the ignored `.env` or process environment. Never put them in `compose.yaml`, `versions.lock`, Git bundles, or documentation.

When `OBSIDIAN_VAULT_PATH` is empty, the launcher creates an isolated empty vault under runtime. When an existing vault is selected, setup initializes only missing files under this project directory and never overwrites existing content:

```text
88-学习/xiaobai/10-项目记忆/xbaiProjectCode
```

### Build a Distribution from Source

Both Xiaobai `OpenHands` and Xiaoneng `xiaoneng2.0` must be clean and committed:

```bash
./deploy/openhands/package.sh --xiaoneng /path/to/xiaoneng
```

The script creates an ignored `dist/` output containing:

```text
xiaobai-openhands-<commit>/
├── artifacts/
│   ├── xiaobai.bundle
│   └── xiaoneng.bundle
├── deploy/openhands/
├── SHA256SUMS
└── runtime/                 # created on first start
```

A matching `.tar.gz` is created as well. Only committed state is packaged; any uncommitted change blocks packaging.

Both Git bundles are history-free distribution snapshots. The resolved `versions.lock` records both source and snapshot commits. Existing Xiaobai `workspace/memory/loops/**`, machine-path reports, and personal Obsidian vault content are excluded from the snapshot.

### Start and Stop

After extracting the package:

```bash
cp deploy/openhands/.env.example deploy/openhands/.env
./deploy/openhands/run.sh
```

Open `http://localhost:8000/canvas`.

Stop while preserving workspaces, OpenHands state, and Obsidian memory:

```bash
./deploy/openhands/stop.sh
```

### Doctor

```bash
./deploy/openhands/doctor.sh
```

The doctor checks the pinned image, Git versions, all three mounts, container-only memory paths, `t-max -> xiaoneng` routing, credential and personal-path scans, package checksums, and live read-only enforcement.

Only one OpenHands writer may use an Obsidian project directory at a time. `run.sh` creates `.xiaobai-writer.lock` to prevent concurrent writes. A normal stop releases the lock without deleting memory.

### Update Boundary

- Update Xiaobai on the `OpenHands` branch, commit it, and package again.
- Update Xiaoneng in its own repository, verify the commit, then update `XIAONENG_COMMIT` in `versions.lock`.
- Update OpenHands only after compatibility verification, changing `OPENHANDS_VERSION`, `OPENHANDS_IMAGE`, and `OPENHANDS_SOURCE_COMMIT` together.
- The default package excludes personal vaults, model keys, SSH configuration, machine symlinks, and the seven T-MAX business repositories.
