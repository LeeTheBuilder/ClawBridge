# ClawBridge

ClawBridge 是一个开源 CLI，用于基于你的工作空间上下文发现更相关的商务连接机会。

它的定位是**信号分享与流程自动化**，不是垃圾营销自动化。

---

## 一句话说明

- 连接你的 workspace profile
- 执行 `clawbridge run` 发现潜在人选/公司
- 本地输出结果（JSON + Markdown）
- 可选上传到 ClawBridge Vault
- 自动把已发现候选写入 `constraints.avoid_list`，下一轮更偏向新对象

---

## 前置条件

ClawBridge 依赖 OpenClaw 工作流环境。

- 先安装 OpenClaw
- 再安装并使用 ClawBridge

如果你还没接触 OpenClaw，建议先阅读 OpenClaw 官方文档。

---

## ClawBridge 实际在做什么

### 1）读取你的 profile 与约束
根据你配置的行业、目标画像、限制条件来做检索。

### 2）执行发现与排序
收集候选线索，并按相关性进行排序。

### 3）输出可直接使用的结果
每次运行都会在本地生成产物，可用于人工筛选或接入你自己的后续流程：

- `output/*.json`
- `output/*.md`

### 4）可选 Vault 同步
如果配置了 Vault，可以把结果上传用于集中管理。

### 5）避免重复推荐
发现完成后，可将候选标识追加到当前配置的 `constraints.avoid_list`（写入前会备份），让下一次运行优先发现新对象。

---

## 安装

### 方式 A：一键安装（推荐）

```bash
curl -fsSL https://clawbridge.cloud/install | bash
```

### 方式 B：源码安装

```bash
git clone https://github.com/LeeTheBuilder/ClawBridge.git
cd ClawBridge
npm install
npm run build
npm link
```

---

## 快速开始

1. 在 `clawbridge.cloud` 创建 workspace
2. 绑定 workspace：

```bash
clawbridge link CB-XXXXXX
```

3. 运行发现：

```bash
clawbridge run
```

---

## 常用命令

```bash
clawbridge run
clawbridge run --dry-run
clawbridge doctor
clawbridge validate
clawbridge schedule --cron "0 21 * * *"
```

---

## 配置文件

默认路径：

- `~/.clawbridge/config.yml`

如需指定配置：

```bash
clawbridge run -c /path/to/config.yml
```

---

## 安全建议

- 密钥请放环境变量
- 不要提交 `.env` 或私有配置
- 安全问题反馈见 `SECURITY.md`

## 贡献指南

见 `CONTRIBUTING.md` 与 `CODE_OF_CONDUCT.md`。

## License

MIT
