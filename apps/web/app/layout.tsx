import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    template: '%s | DailyStar',
    default: 'DailyStar — Your Trusted News Source',
  },
  description:
    'DailyStar is a modern digital news portal delivering accurate, well-researched reporting ' +
    'with an AI-assisted editorial workflow.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-gray-900 antialiased">{children}</body>
    </html>
  );
}
