import { upload } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';

const baseURL = import.meta.env.VITE_API_BASE || '/data';

/** /data/agent/files 上传返回（后端 Long 因 numbers-as-strings 会序列化成字符串）。 */
export interface AgentFileView {
  fileId: string | number;
  objectName: string;
  bucket: string;
  filename: string;
  contentType?: string;
  sizeBytes?: string | number;
}

/** 上传一个输入文件给代码执行 Agent（存 MinIO，不入知识库），返回 fileId。 */
export function uploadAgentFile(file: File) {
  return upload<AgentFileView>('/agent/files', file);
}

/**
 * 下载产物。产物下载端点经网关，需要带 Authorization / X-Tenant-Id 头，
 * 所以不能用裸 <a href>，这里用 fetch 取 blob 再触发下载（与 sse.ts 同套鉴权）。
 */
export async function downloadArtifact(artifactId: string | number, filename?: string): Promise<void> {
  const { token, tenantId } = useAuthStore.getState();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = token;
  if (tenantId) headers['X-Tenant-Id'] = tenantId;
  const resp = await fetch(`${baseURL}/agent/artifacts/${artifactId}/download`, { headers });
  if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `artifact-${artifactId}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
