import type { Metadata } from 'next';
import './globals.css';
import { SocketProvider } from '@/components/SocketProvider';

export const metadata: Metadata = {
  title: '마이티 (Mighty)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <SocketProvider>{children}</SocketProvider>
      </body>
    </html>
  );
}
