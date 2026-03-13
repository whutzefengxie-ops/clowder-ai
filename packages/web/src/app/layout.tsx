import type { Metadata, Viewport } from 'next';
import { BrakeModal } from '@/components/BrakeModal';
import { ToastContainer } from '@/components/ToastContainer';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#E29578',
};

export const metadata: Metadata = {
  title: 'Cat Cafe',
  description: '三只 AI 猫猫的协作空间',
  manifest: '/manifest.json',
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Cat Cafe',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">
        {children}
        <BrakeModal />
        <ToastContainer />
      </body>
    </html>
  );
}
