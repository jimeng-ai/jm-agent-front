import { useMemo, useState } from 'react';
import { Input, Typography, Alert, Space } from 'antd';
import { JSONPath } from 'jsonpath-plus';

const SAMPLE = `{
  "code": 0,
  "data": {
    "items": [
      { "id": 1, "name": "Alice" },
      { "id": 2, "name": "Bob" }
    ]
  }
}`;

export default function JsonPathPreview() {
  const [sample, setSample] = useState(SAMPLE);
  const [expr, setExpr] = useState('$.data.items[*].name');

  const result = useMemo(() => {
    if (!sample.trim() || !expr.trim()) return { ok: true, value: null };
    let json: object;
    try {
      json = JSON.parse(sample) as object;
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    try {
      const v = JSONPath({ path: expr, json });
      return { ok: true, value: v };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, [sample, expr]);

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text type="secondary">粘贴样例响应，输入 JSONPath，实时预览命中</Typography.Text>
      <Input.TextArea
        rows={6}
        value={sample}
        onChange={(e) => setSample(e.target.value)}
        placeholder="样例 JSON 响应"
      />
      <Input
        prefix="JSONPath:"
        value={expr}
        onChange={(e) => setExpr(e.target.value)}
        placeholder="如 $.data.items[*].name"
      />
      {!result.ok ? (
        <Alert type="error" message={result.error} />
      ) : (
        <pre
          style={{
            background: '#fafafa',
            border: '1px solid #f0f0f0',
            borderRadius: 4,
            padding: 8,
            maxHeight: 180,
            overflow: 'auto',
            margin: 0,
          }}
        >
          {JSON.stringify(result.value, null, 2)}
        </pre>
      )}
    </Space>
  );
}
