import { Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { fetchFeed } from '../lib/api';

export function Layout() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    fetchFeed({ limit: 1 })
      .then((res) => setUnreadCount(res.unread))
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar unreadCount={unreadCount} />
      <main className="flex-1 overflow-y-auto bg-[#0d1117]">
        <div className="mx-auto max-w-5xl p-6">
          <Outlet context={{ unreadCount, setUnreadCount }} />
        </div>
      </main>
    </div>
  );
}
