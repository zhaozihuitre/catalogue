# 本地 OCR 服务

藏册用它识别图片证书和扫描版 PDF。服务只监听 `127.0.0.1:8866`，不联网，也不写临时文件。

## 安装（部署时联网执行一次）

```bash
cd services/ocr
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# 首次启动会下载 PaddleOCR 中文模型到 ~/.paddleocr，之后可断网运行
python app.py
```

## 验证

```bash
curl http://127.0.0.1:8866/health
curl -X POST -H 'Content-Type: image/jpeg' --data-binary @证书.jpg http://127.0.0.1:8866/ocr
```

## 说明

- 文本型 PDF 由藏册后端直接提取文字，不经过 OCR；只有图片和扫描件才会发到这里。
- OCR 服务没启动时，藏册会把识别任务延后，服务就绪后自动补做，其他功能不受影响。
- `requirements.txt` 锁定在 PaddleOCR 2.x，因为 `app.py` 用的是 2.x 的 `ocr.ocr()` 接口。升级到 3.x 前需要改代码。
- 这部分代码还没有在真实部署机上跑过，交付前需要在目标 MacMini 或 NAS 上验证一遍。
