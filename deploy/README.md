# 部署说明

三种版本使用同一套代码，区别只在部署载体和网络配置。

| 版本 | 载体 | 访问方式 | 服务管理 |
| --- | --- | --- | --- |
| 主推版 | MacMini（M2 Pro / M3 Pro，16G 起，推荐 32G） | 内网；可选配 Tailscale | `deploy/macmini/install.sh`（launchd） |
| 旗舰版 | 客户自有 NAS（Linux） | 纯内网，可永久断网 | `deploy/linux/catalogue.service`（systemd） |
| 标准版 | 客户名下云 ECS | HTTPS | `deploy/linux/catalogue.service`（systemd） |

## 访问方式

| 模式 | 配置 | 设备端 | 适用 |
| --- | --- | --- | --- |
| 内网 HTTP（MacMini / NAS 默认） | `.env` 中设置 `CATALOGUE_ALLOW_HTTP=1`，不配证书 | 电脑、手机、电视直接打开 `http://主机IP:端口`，无需安装任何东西 | 可信的家庭内网；远程访问走 Tailscale（自带加密） |
| HTTPS | 配置 `CATALOGUE_TLS_CERT` / `CATALOGUE_TLS_KEY` | 自签证书需在每台设备上安装并信任 CA；公网证书则无需操作 | 云 ECS（必须）；对内网安全要求更高的客户 |

内网 HTTP 模式下，请在路由器里为主机**固定 IP**（DHCP 静态分配），客户收藏的网址才不会失效。端口可以用 `CATALOGUE_PORT=80`，网址就能省掉端口号；在 Linux 上监听 80 端口需要额外授权。

> 这与 PRD 第 11 章"内网与远程访问全部强制 HTTPS"不一致，是为了让电视等设备免装证书而做的取舍。交付时须向客户说明，并写入《隐私安全说明书》（第 6 节第 7 条）。

## 通用步骤

部署工程师在客户现场执行。以下"联网"步骤完成后，系统可以断网运行。

```bash
# 1. 准备代码与依赖（联网）
git clone <仓库地址> /opt/catalogue && cd /opt/catalogue    # MacMini 可放在 ~/catalogue
npm ci
npm run build

# 2. 下载本地 AI 模型（联网）
bash deploy/fetch-models.sh

# 3.（仅 HTTPS 模式）生成证书（把主机的内网 IP / 主机名都写上）
bash deploy/gen-certs.sh 192.168.1.20 catalogue.local

# 4. 配置
cp .env.example .env
#    - 删除 CATALOGUE_DEV_INSECURE
#    - CATALOGUE_HOST 填主机内网 IP
#    - 内网 HTTP 模式：设置 CATALOGUE_ALLOW_HTTP=1
#    - HTTPS 模式：填写 CATALOGUE_TLS_CERT / CATALOGUE_TLS_KEY

# 5. 初始化：由客户本人在键盘前输入主口令，部署人员回避
npm run init

# 6. 安装为系统服务（见下文）
```

完成后（仅 HTTPS 自签证书模式需要）：

1. 把 `certs/ca.crt` 安装到客户的电脑和手机上，并设为信任。
2. 把 `certs/ca.key` 拷贝到离线介质交给客户保管，然后从主机上删除。

## MacMini（主推版）

```bash
bash deploy/macmini/install.sh
```

- 在系统设置中关闭自动睡眠，并开启"断电恢复后自动启动"。
- Ollama 在 Apple Silicon 上会自动使用 Metal 加速。若要使用 MLX 推理，可在本机运行兼容 Ollama API 的服务，再修改 `CATALOGUE_OLLAMA_URL` 指向它。
- **远程访问（增值选配）**：
  1. 安装 Tailscale，并开启 MagicDNS。
  2. 用 `gen-certs.sh` 生成证书时加上 `xxx.ts.net` 主机名。
  3. `CATALOGUE_HOST` 改为 `0.0.0.0`，并用 macOS 防火墙限制只允许内网和 Tailscale 网段访问。
- **禁止**在路由器上做端口映射。

## NAS（旗舰版）

- 要求 NAS 运行的是通用 Linux，能安装 Node 22.9+ 和 Python 3.10+。安装 systemd 服务的方法见 `deploy/linux/catalogue.service` 文件头部的说明。
- NAS 算力有限，7B 模型推理会比较慢。可以把 `CATALOGUE_LLM_MODEL` 改为 `qwen2.5:3b-instruct-q4_K_M`。
- 完成部署后可以拔掉外网，系统照常运行。
- 群晖、威联通等系统的 Docker 方案还未提供，需要另行适配。

## 云 ECS（标准版）

- ECS 必须在客户本人名下，并使用客户自己的 KMS 密钥做云盘加密。
- **关闭**自动快照和跨地域备份。
- 安全组只放行 HTTPS 端口，建议同时限制来源 IP。
- 公网访问需要正式证书：可以申请 Let's Encrypt 证书，再把路径填入 `CATALOGUE_TLS_CERT` / `CATALOGUE_TLS_KEY`。
- 云厂商可以看到内存，因此"服务商不持有密钥"只能防住磁盘层面，防不住运行时。这一点须在交付时向客户说明，对应 PRD 中"隐私要求中等"的定位。

## 启动后

- 服务启动后处于**锁定状态**。需要藏家在网页上输入主口令才能解锁。主机重启后同样需要重新解锁。
- 如果客户接受"主口令写入配置文件"带来的风险降低，可以在 `.env` 里设置 `CATALOGUE_PASSPHRASE`，启动时自动解锁。不建议这样做。

## 备份

数据目录（默认 `data/`）里的文件已经是加密状态，可以直接拷贝到客户自己的移动硬盘：

- `catalogue.db`、`catalogue.db-wal`：加密数据库。
- `files/`：加密档案文件。
- `keystore.json`：只含盐和 KDF 参数，不含密钥，但恢复时必须有它。

恢复时需要上述文件加上主口令。系统不做任何自动云备份。

## 尚未在真实环境验证的部分

以下内容在开发机（Windows）上无法验证，交付前需要在目标机器上逐项确认：

- `services/ocr`：PaddleOCR 服务。
- `deploy/macmini/install.sh` 与 launchd 配置。
- `deploy/linux/catalogue.service`。
- `deploy/fetch-models.sh` 的模型下载，以及 Ollama 实际问答效果。
