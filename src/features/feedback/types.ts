export type FeedbackType = 1 | 2; // 1=问题反馈 2=功能建议

export interface FeedbackImage {
  imageId: number;
  contentType: string;
  sortOrder: number;
}

export interface FeedbackListItem {
  id: number;
  tenantId: string;
  tenantName: string | null;
  feedbackType: FeedbackType;
  content: string;
  imageCount: number;
  createTime: string;
}

export interface FeedbackDetail {
  id: number;
  tenantId: string;
  tenantName: string | null;
  feedbackType: FeedbackType;
  content: string;
  createTime: string;
  images: FeedbackImage[];
}

export interface UploadImageResult {
  imageId: number;
  contentType: string;
}
