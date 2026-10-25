"""
藏册本地 OCR 服务（PaddleOCR）。

只监听 127.0.0.1，由藏册后端调用：
  GET  /health  -> 200 表示模型已加载
  POST /ocr     -> 请求体为图片或 PDF 原始字节，Content-Type 为其 MIME 类型
                   返回 {"pages": ["第一页文本", ...]}

识别过程完全在本机完成，不写入任何临时文件，不联网。
"""

import io
import os

import fitz  # PyMuPDF
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from paddleocr import PaddleOCR
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

# iPhone 拍摄的 HEIC 照片
register_heif_opener()

MAX_BYTES = 100 * 1024 * 1024
MAX_PDF_PAGES = int(os.environ.get("CATALOGUE_OCR_MAX_PAGES", "50"))
PDF_DPI = int(os.environ.get("CATALOGUE_OCR_DPI", "200"))

app = FastAPI(title="Catalogue OCR", docs_url=None, redoc_url=None, openapi_url=None)
ocr = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)


def recognize(img: Image.Image) -> str:
    arr = np.array(ImageOps.exif_transpose(img).convert("RGB"))
    result = ocr.ocr(arr, cls=True)
    lines = []
    for page in result or []:
        for box, (text, score) in page or []:
            if score >= 0.5:
                # 按文本框左上角坐标排序，尽量还原阅读顺序
                lines.append((round(box[0][1] / 12), box[0][0], text))
    lines.sort()
    return "\n".join(t for _, _, t in lines)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/ocr")
async def run_ocr(request: Request):
    data = await request.body()
    if not data:
        raise HTTPException(400, "empty body")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "file too large")

    mime = request.headers.get("content-type", "")
    pages: list[str] = []
    if mime == "application/pdf":
        with fitz.open(stream=data, filetype="pdf") as doc:
            for i, page in enumerate(doc):
                if i >= MAX_PDF_PAGES:
                    break
                pix = page.get_pixmap(dpi=PDF_DPI)
                pages.append(recognize(Image.open(io.BytesIO(pix.tobytes("png")))))
    elif mime.startswith("image/"):
        try:
            pages.append(recognize(Image.open(io.BytesIO(data))))
        except Exception as e:  # noqa: BLE001
            raise HTTPException(415, f"cannot decode image: {e}") from e
    else:
        raise HTTPException(415, "unsupported content type")
    return {"pages": pages}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("CATALOGUE_OCR_PORT", "8866")), access_log=False)
