import type { AxiosProgressEvent } from 'axios';
import { get, post, upload } from '@/api/client';
import type { FeedbackDetail, FeedbackListItem, FeedbackType, UploadImageResult } from './types';

// 注意：httpClient.baseURL 已是 '/data'，故下方路径不再带 '/data' 前缀（与现有 rag/agent api 一致）。
export const feedbackApi = {
  /** 单图上传，透传 onUploadProgress 给 AntD Upload 驱动单图进度条。 */
  uploadImage: (file: File, onProgress?: (e: AxiosProgressEvent) => void) =>
    upload<UploadImageResult>('/feedback/images', file, 'file', undefined, {
      onUploadProgress: onProgress,
    }),

  submit: (data: { feedbackType: FeedbackType; content: string; imageIds: number[] }) =>
    post<number>('/feedback', data),

  listMine: () => get<FeedbackListItem[]>('/feedback'),

  detail: (id: number) => get<FeedbackDetail>(`/feedback/${id}`),

  /** 图片字节端点路径（需鉴权头，用 httpClient blob 拉取；baseURL 会补 '/data'）。 */
  imageUrl: (imageId: number) => `/feedback/images/${imageId}`,
};
