/**
 * 文本字节解码：严格 UTF-8 优先，非法序列再退 GBK（兼容 Excel/Windows 导出的 GBK 文件），
 * 与后端 CSV 解析器「UTF-8→GBK」探测一致，避免中文乱码。
 *
 * 用于 CSV/TSV、纯文本等「裸文本字节」的前端预览：这类内容不像 xlsx 那样自带编码信息，
 * 直接按 Latin-1/默认编码解会把中文解成乱码（如「年龄」→「å¹´é¾」）。
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gbk').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes); // 兜底：非严格 UTF-8
    }
  }
}
