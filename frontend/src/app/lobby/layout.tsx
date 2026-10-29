import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '마이티 (Mighty) - 로비',
};

export default function LobbyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
