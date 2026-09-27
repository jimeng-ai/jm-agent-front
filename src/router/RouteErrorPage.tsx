import { Button, Result, Space } from 'antd';
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom';

function routeErrorMessage(error: unknown) {
  if (isRouteErrorResponse(error)) {
    return error.status === 404 ? '请求的页面不存在。' : `页面请求失败（${error.status}）。`;
  }
  if (error instanceof Error && /dynamically imported module|failed to fetch/i.test(error.message)) {
    return '页面资源暂时没有加载成功，请检查网络后重新加载。';
  }
  return '页面渲染时遇到异常，请重新加载；若仍失败，请联系管理员。';
}

/** Data Router 路由级错误页，覆盖 render / loader / lazy chunk 异常。 */
export default function RouteErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate();

  console.error('[RouteError]', error);

  return (
    <main className="route-error-page" data-testid="route-error-page">
      <Result
        status="500"
        title="页面加载失败"
        subTitle={routeErrorMessage(error)}
        extra={
          <Space wrap>
            <Button onClick={() => navigate('/console/dashboard', { replace: true })}>
              返回工作台
            </Button>
            <Button type="primary" onClick={() => window.location.reload()}>
              重新加载页面
            </Button>
          </Space>
        }
      />
    </main>
  );
}
