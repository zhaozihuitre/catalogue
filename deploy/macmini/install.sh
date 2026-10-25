#!/usr/bin/env bash
# MacMini 主推版：注册开机自启的藏册服务与 OCR 服务（launchd，当前用户登录后启动）。
# 前置：已安装 Node 22.9+、Python 3.10+、Ollama；已在仓库根目录执行 npm ci、npm run build、npm run init；
#       已用 deploy/gen-certs.sh 生成证书并写入 .env。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/Catalogue"
NODE="$(command -v node)"
mkdir -p "$AGENTS" "$LOGS"

if [ ! -f "$ROOT/.env" ]; then
  echo "缺少 $ROOT/.env，请先根据 .env.example 创建" >&2
  exit 1
fi
if grep -q '^CATALOGUE_DEV_INSECURE=1' "$ROOT/.env"; then
  echo "生产环境不能开启 CATALOGUE_DEV_INSECURE（会放宽密码要求）。内网 HTTP 请改用 CATALOGUE_ALLOW_HTTP=1" >&2
  exit 1
fi

echo "== 安装 OCR 服务依赖"
python3 -m venv "$ROOT/services/ocr/.venv"
"$ROOT/services/ocr/.venv/bin/pip" install -q -r "$ROOT/services/ocr/requirements.txt"

render() {
  sed -e "s#__ROOT__#$ROOT#g" -e "s#__NODE__#$NODE#g" -e "s#__LOGS__#$LOGS#g" "$1" > "$2"
}
render "$ROOT/deploy/macmini/com.catalogue.server.plist" "$AGENTS/com.catalogue.server.plist"
render "$ROOT/deploy/macmini/com.catalogue.ocr.plist" "$AGENTS/com.catalogue.ocr.plist"

for svc in com.catalogue.ocr com.catalogue.server; do
  launchctl bootout "gui/$(id -u)/$svc" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$svc.plist"
done

echo
echo "已启动。日志目录：$LOGS"
echo "系统启动后处于锁定状态，请在浏览器打开 http(s)://<本机内网IP>:<端口> 输入主口令解锁。"
echo "建议：系统设置 → 节能，关闭自动睡眠，并开启“断电后自动启动”。"
