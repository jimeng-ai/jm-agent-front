import { Button, Result } from 'antd';
import React from 'react';

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <Result
          status="500"
          title="页面出错了"
          subTitle={this.state.error.message}
          extra={
            <Button type="primary" onClick={() => location.reload()}>
              刷新页面
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
