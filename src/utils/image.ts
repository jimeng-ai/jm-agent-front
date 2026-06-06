/**
 * 把用户选的图片在浏览器里等比缩放到最长边 ≤ maxSize，再导出成 JPEG data URL。
 *
 * 头像直接以 data URL 存进 agent.avatarUrl（mediumtext 列），各处用 <img src> / <Avatar src>
 * 即可渲染，免去「上传 MinIO → 取回需鉴权、不能裸 <img>」的麻烦。透明背景统一填白，避免
 * JPEG 黑底。256px @ q0.85 的头像通常只有几 KB ~ 十几 KB。
 */
export async function fileToAvatarDataUrl(
  file: File,
  maxSize = 256,
  quality = 0.85,
): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('图片解析失败'));
    el.src = dataUrl;
  });

  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}
