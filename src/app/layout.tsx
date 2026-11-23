import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'StrangerChat — Talk to Strangers',
  description: 'Anonymous text chat with random people. No names, no profiles — just conversations.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#050505] text-white antialiased">
        {children}
      </body>
    </html>
  );
}
