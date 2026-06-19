import { Modal, Form, Input, App } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { skillApi, type ImportGithubPayload } from '@/features/skill/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ImportSkillModal({ open, onClose }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<ImportGithubPayload>();

  const importMut = useMutation({
    mutationFn: skillApi.importGithub,
    onSuccess: (skill) => {
      const note =
        skill.skillType === 'DOER'
          ? '导入成功，DOER 类型需在沙箱运行后方可使用'
          : '导入成功，PROMPT 类型可立即使用';
      message.success(note);
      qc.invalidateQueries({ queryKey: ['skill', 'list'] });
      form.resetFields();
      onClose();
    },
    onError: (err: { message?: string }) => {
      message.error(err?.message || '导入失败');
    },
  });

  return (
    <Modal
      title="从 GitHub 导入 Skill"
      open={open}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      onOk={() => form.submit()}
      confirmLoading={importMut.isPending}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ ref: 'main' }}
        onFinish={(v) => importMut.mutate(v)}
      >
        <Form.Item
          label="仓库所有人 (owner)"
          name="owner"
          rules={[{ required: true, message: '请填写 owner' }]}
        >
          <Input placeholder="e.g. my-org" />
        </Form.Item>
        <Form.Item
          label="仓库名 (repo)"
          name="repo"
          rules={[{ required: true, message: '请填写 repo' }]}
        >
          <Input placeholder="e.g. my-skills" />
        </Form.Item>
        <Form.Item
          label="分支 / Tag (ref)"
          name="ref"
          rules={[{ required: true, message: '请填写 ref' }]}
        >
          <Input placeholder="main" />
        </Form.Item>
        <Form.Item label="文件路径 (path，可选)" name="path">
          <Input placeholder="skills/my-skill.md" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
