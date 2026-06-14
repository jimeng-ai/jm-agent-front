import type { AxiosProgressEvent } from 'axios';
import { get, post, upload } from '@/api/client';
import type { FeedbackDetail, FeedbackListItem, FeedbackType, UploadImageResult } from './types';

export const feedbackApi = {
  /** 单图上传，透传 onUploadProgress 给 AntD Upload 驱动单图进度条。 */
  uploadImage: (file: File, onProgress?: (e: AxiosProgressEvent) => void) =>
    upload<UploadImageResult>('/data/feedback/images', file, 'file', undefined, {
      onUploadProgress: onProgress,
    }),

  submit: (data: { feedbackType: FeedbackType; content: string; imageIds: number[] }) =>
    post<number>('/data/feedback', data),

  listMine: () => get<FeedbackListItem[]>('/data/feedback'),

  detail: (id: number) => get<FeedbackDetail>(`/data/feedback/${id}`),

  /** 图片字节端点路径（需鉴权头，用 httpClient blob 拉取）。 */
  imageUrl: (imageId: number) => `/data/feedback/images/${imageId}`,
};
