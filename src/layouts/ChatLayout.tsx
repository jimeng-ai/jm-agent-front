import { Outlet } from 'react-router-dom';

export default function ChatLayout() {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <Outlet />
    </div>
  );
}
