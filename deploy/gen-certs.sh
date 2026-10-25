#!/usr/bin/env bash
# 生成内网 HTTPS 证书：一个自签 CA + 一张服务器证书。
# 用法：deploy/gen-certs.sh <主机名或IP> [更多主机名或IP...]
# 示例：deploy/gen-certs.sh 192.168.1.20 catalogue.local macmini.tailnet.ts.net
#
# 生成后把 certs/ca.crt 安装到每台访问设备上并设为信任（iPhone：设置 → 通用 → 关于本机 → 证书信任设置），
# 浏览器和 PWA 就不会再提示证书不受信任。ca.key 请离线保管，不要放在服务器上。
set -euo pipefail
# Windows Git Bash 下禁止把 "/CN=..." 当成路径转换；其他平台无影响
export MSYS_NO_PATHCONV=1

if [ $# -lt 1 ]; then
  echo "用法：$0 <主机名或IP> [更多主机名或IP...]" >&2
  exit 1
fi

OUT="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$OUT"
cd "$OUT"
umask 077

if [ ! -f ca.key ]; then
  openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes \
    -keyout ca.key -out ca.crt -subj "/CN=Catalogue Private CA"
  echo "已生成 CA：$OUT/ca.crt"
fi

SAN=""
for h in "$@"; do
  if [[ "$h" =~ ^[0-9.]+$ ]]; then SAN="${SAN}IP:${h},"; else SAN="${SAN}DNS:${h},"; fi
done
SAN="${SAN}DNS:localhost,IP:127.0.0.1"

openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=$1"
printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n" "$SAN" > server.ext
# iOS 要求服务器证书有效期不超过 825 天
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 825 -sha256 -extfile server.ext
rm -f server.csr server.ext

echo
echo "已生成服务器证书：$OUT/server.crt（$SAN）"
echo "在 .env 中设置："
echo "  CATALOGUE_TLS_CERT=$OUT/server.crt"
echo "  CATALOGUE_TLS_KEY=$OUT/server.key"
echo "并删除 CATALOGUE_DEV_INSECURE。"
