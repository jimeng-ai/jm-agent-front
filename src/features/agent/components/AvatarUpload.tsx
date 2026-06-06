import { useState } from 'react';
import { App, Avatar, Button, Space, Upload, type UploadProps } from 'antd';
import { DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { fileToAvatarDataUrl } from '@/utils/image';
import { glyphColor } from '@/utils/glyph';

interface Props {
  /** 当前头像（data URL 或外链）。由 Form.Item 注入。 */
  value?: string;
  onChange?: (v?: string) => void;
  /** 无头像时用于生成首字占位的名称。 */
  name?: string;
}

/**
 * 头像上传：选一张图片即可，浏览器内压缩成 data URL 写回表单（不调后端上传接口）。
 * 作为受控组件供 Form.Item 包裹。
 */
export default function AvatarUpload({ value, onChange, name }: Props) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const color = glyphColor(name);

  const beforeUpload: UploadProps['beforeUpload'] = async (file) => {
    if (!file.type.startsWith('image/')) {
      message.error('请选择图片文件');
      return Upload.LIST_IGNORE;
    }
    if (file.size > 5 * 1024 * 1024) {
      message.error('图片不要超过 5MB');
      return Upload.LIST_IGNORE;
    }
    setBusy(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      onChange?.(dataUrl);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '图片处理失败');
    } finally {
      setBusy(false);
    }
    // 返回 false：阻止 antd 自己发起上传，文件已在本地处理完。
    return false;
  };

  return (
    <Space size={16} align="center">
      <Avatar
        size={64}
        shape="square"
        src={value || undefined}
        style={{
          borderRadius: 14,
          ...(value ? {} : { background: color.bg, color: color.fg, fontSize: 28 }),
        }}
      >
        {!value && (name?.slice(0, 1) || 'A')}
      </Avatar>
      <Space direction="vertical" size={4}>
        <Space>
          <Upload accept="image/*" showUploadList={false} beforeUpload={beforeUpload}>
            <Button icon={<UploadOutlined />} loading={busy}>
              {value ? '更换头像' : '上传头像'}
            </Button>
          </Upload>
          {value && (
            <Button icon={<DeleteOutlined />} onClick={() => onChange?.(undefined)}>
              移除
            </Button>
          )}
        </Space>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          支持 JPG/PNG，自动压缩；留空则用名称首字作头像
        </span>
      </Space>
    </Space>
  );
}
