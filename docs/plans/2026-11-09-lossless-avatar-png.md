---
feature_ids: []
topics: [issue-1703, packaging, avatars, lossless]
doc_kind: implementation-plan
created: 2026-11-09
status: experimental
---

# 头像 PNG 压缩层无损实验

用户授权在保留功能的前提下尝试安装包瘦身。本实验独立于 PR #1722 的三项发布规则；基于该 PR 整合 next@2a653d3e6 的续作提交 5bed18bd650ff3dde6fbc5eef2122c60540e2041。

工位：`G:/AIwork/clowder-ai/worktrees/issue-1703-lossless-png-20261109`。证据：`G:/AIwork/clowder-ai/artifacts/issue-1703-next-20261109`。

## 具体变更

只在 `stageBuiltWeb` 已复制的 `public/avatars/**/*.png` 中尝试重新压缩 IDAT zlib 流。输入是源仓的发行资源，用户 uploads 不参与。只接受更小的输出；源文件保持原位、原字节。

`recompress-png.mjs` 保持解压后的扫描行逐字节一致，签名及全部非 IDAT 块原样保留，包括尺寸、位深、调色板、透明度、ICC、EXIF、DPI 与文字元数据。不改变 URL、文件格式、MIME、像素、动画或角色配置，不新增映射层或原生依赖。已有 .png URL 实为 JPEG 的两张资源原样保留，APNG 原样保留。

PWA 的源内容版本 token 与 sw.js 均保持原样。它仍随源图变化而变化；压缩前后相同版本的图像像素及元数据相同，可交换使用。实际交付字节和归档哈希由构建 manifest 记录，不把源版本 token 当作交付文件 SHA。

当前真实消费者包括 Web 静态头像、Host `publicParticipantAvatar` 的 48px 缩略图和 `host-media-paths` 出站资源路径。本方案不改变它们的物理路径；仍需实际布局与 HTTP/PWA 复验，不能由字节变小代偿。

## 已有验证

- 新增的生产 Web staging 测试先观察到“交付 PNG 未使用更强无损压缩”的精准 RED，再实现转绿。检查多 IDAT 块、CRC、解压扫描行、元数据块、原 URL、源图保全、伪 PNG 的 JPEG 保留以及 uploads 不改写。
- 原有 Web staging 检查继续覆盖生成 CSS、WASM、service worker 和运行期 cache 保留。
- 直接用生产函数处理全部 50 张当前头像，并用现有 sharp/libvips 独立解码：全部 RGBA、尺寸及除文件长度外的全部 decoder metadata 一致，源文件 SHA 未变。
- Node 24.16.0 生产实现输出：54,900,055 → 48,587,856 字节，少 6,312,199 字节。记录为 `png-production-verification.json`。这只是图片逻辑字节，尚非 EXE 收益。
- 独立 Python 原型因 zlib 实现不同得到少 6,057,932 字节；它不替代 Node 生产输出结果，不混加收益。

## 必须继续完成

1. 在完整产物中核对只有头像 PNG 压缩字节变化；对所有 PNG 独立验证 IDAT 解压值及非 IDAT 块，不能只有 RGBA 近似比较。
2. 复验 Host 头像投影、Web 原 URL/MIME、首次本地资源和已有 PWA 缓存消费；能力不等价即撤回本片。
3. 用同批 API/Web/依赖、Electron/Node/Redis、docs/直接资源生成实际 EXE 对照，分别报告原 #1722 和本片的边际收益；不继承旧工件数字。
4. 对最终实质 HEAD 做非作者审查；断公网首装、受支持升级及安装失败恢复按原交接分别验收，未测项保留为缺项。

源码回退只撤销这三个代码/测试文件后重建；没有用户状态或数据迁移。不采用有损 Q85、文档删减、视频 URL 改写或语音/ONNX 外置。
