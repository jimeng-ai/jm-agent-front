import { Suspense } from 'react';
import { Spin } from 'antd';
import { Outlet } from 'react-router-dom';

export default function RouteBoundary() {
  return (
    <Suspense
      fallback={
        <div className="app-loading">
          <Spin />
        </div>
      }
    >
      <Outlet />
    </Suspense>
  );
}
