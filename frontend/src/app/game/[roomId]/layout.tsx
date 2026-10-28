import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '마이티 (Mighty) - 게임',
};

export default function GameLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
