/**
 * 外部连接：技能调用外部系统的连接注册表。全超管可见可管。
 * 后端 Long / 数值字段按字符串下发，故 id / encryptionVersion 用 string。
 * 读接口永不回传凭据（credential）。
 */
export type ConnAuthScheme = 'bearer' | 'api-key';
export type ConnStatus = 'ACTIVE' | 'DISABLED';

export interface Connection {
  id: string;
  name: string;
  displayName?: string | null;
  baseUrl: string;
  authScheme: ConnAuthScheme;
  /** 逗号分隔的允许方法串，如 "GET,POST"。 */
  allowMethods?: string | null;
  /** JSON 数组字符串，如 ["/v1/**"]；可能为 null（等价全部）。 */
  allowPaths?: string | null;
  transport?: string | null;
  status: ConnStatus;
  encryptionVersion?: string | number | null;
  createTime?: string | null;
}

/** 录入/编辑载荷。credential 只写不读：新建必填、编辑留空表示不改动凭据。 */
export interface ConnectionUpsert {
  name: string;
  displayName?: string;
  baseUrl: string;
  authScheme?: ConnAuthScheme;
  credential?: string;
  /** 默认 ["GET"]。 */
  allowMethods?: string[];
  /** 每项以 / 开头；留空等价全部。 */
  allowPaths?: string[];
}
