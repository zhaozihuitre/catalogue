# Catalogue · 藏册

私有化离线藏品 AI 档案系统。所有数据、档案文件、向量和 AI 模型都运行在客户自有的硬件上，不上传任何第三方云端。

> No cloud upload. Your collection stays yours.

产品需求见 [产品需求.md](产品需求.md)。

## 功能（V1.0 MVP）

- **藏品档案**：5 个预设类目（老酒、名表、书画、珠宝、文玩），每个类目有专属字段，也可以自定义类目和字段。
- **加密归档**：图片和 PDF 用 AES-256-GCM 加密落盘；数据库用 SQLCipher 整库加密。密钥由主口令派生，只存在于内存中。
- **本地 AI**：
  - 文本型 PDF 直接取文字，图片和扫描件走 PaddleOCR。
  - 文本切片后用 bge-small-zh 向量化，再由 Ollama + Qwen2.5 基于检索结果回答。
  - 找不到依据时只回答"无记录"；估值、行情、真伪类问题直接拦截。
- **到期提醒**：保险到期、保养到期、长期未盘点，支持站内通知和可选的邮件通知。
- **三级权限**：藏家本人 / 助理 / 只读访客，支持查看在线设备和强制下线。
- **导出**：藏品台账、保险清单、分类统计（Excel）。
- **审计日志**：登录、增删改、上传下载、AI 问答、导出全程留痕，日志只能追加。
- **网页访问**：电脑、手机、平板、电视都用浏览器打开同一个网址即可，手机上支持拍照建档，不缓存任何档案数据。

## 目录结构

```
apps/server/      后端 Fastify + TypeScript（一套 API 同时服务 Web 和移动端）
apps/web/         前端 Vue3 + Element Plus（响应式网页）
packages/shared/  前后端共用：权限矩阵、类目字段、类型定义
services/ocr/     本地 PaddleOCR 服务（Python）
deploy/           证书、模型下载、MacMini / Linux 部署脚本
docs/             操作手册、隐私安全说明书
```

## 本机开发

需要 Node 22.9 以上版本。

```bash
npm install
cp .env.example .env          # 默认开启 CATALOGUE_DEV_INSECURE=1：HTTP，只监听本机
npm run init                  # 设置主口令，创建藏家账号（注意是 npm run init，不是 npm init）
npm run dev                   # 后端 :8443，前端 :5173（自动代理 /api）
```

打开 http://127.0.0.1:5173 ，先输入主口令解锁，再登录。

没有安装 Ollama、OCR 服务和向量模型时，AI 功能会自动降级：

- 检索改为关键词匹配。
- 回答改为直接列出原文片段。
- 图片识别延后执行。

其他功能都能正常使用。服务就绪后，系统会在后台自动补齐向量和摘要。

## 测试

```bash
npm test             # 后端单元测试与接口测试（加密、权限矩阵、提醒、AI 约束、三种角色的主要流程）
npm run typecheck
```

## 部署

见 [deploy/README.md](deploy/README.md)。
