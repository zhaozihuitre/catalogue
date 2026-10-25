#!/usr/bin/env bash
# 部署时联网执行一次，把本地 AI 所需的模型下载到本机。下载完成后系统可以完全断网运行。
#   1. Ollama 大模型 qwen2.5:7b-instruct（4bit 量化，约 4.7GB）
#   2. 向量模型 bge-small-zh-v1.5 的 ONNX 版本（约 100MB），放到 models/ 目录
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="${CATALOGUE_MODEL_DIR:-$ROOT/models}"
LLM="${CATALOGUE_LLM_MODEL:-qwen2.5:7b-instruct-q4_K_M}"
EMBED="${CATALOGUE_EMBED_MODEL:-Xenova/bge-small-zh-v1.5}"

echo "== 1/2 拉取 Ollama 模型 $LLM"
if ! command -v ollama >/dev/null; then
  echo "未找到 ollama，请先安装：https://ollama.com/download" >&2
  exit 1
fi
ollama pull "$LLM"

echo "== 2/2 下载向量模型 $EMBED 到 $MODEL_DIR/$EMBED"
DEST="$MODEL_DIR/$EMBED"
mkdir -p "$DEST/onnx"
BASE="https://huggingface.co/$EMBED/resolve/main"
for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json vocab.txt onnx/model.onnx; do
  echo "  - $f"
  curl -fL --retry 3 -o "$DEST/$f" "$BASE/$f"
done

echo
echo "完成。重启藏册服务后，在【系统设置 → 本地 AI 服务状态】确认三项均为“就绪”。"
