import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Montserrat } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono-face', display: 'swap' });
// Brand wordmark face (the "TRIGON" lockup).
const brand = Montserrat({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-brand-face', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Trigon', template: '%s · Trigon' },
  description: 'Collaborative knowledge platform — docs, spaces and files for your team.',
  applicationName: 'Trigon',
  appleWebApp: { capable: true, title: 'Trigon', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: {
    // src/app/favicon.ico (16–64px) is added automatically by Next.js; SVG stays sharp at any DPI.
    icon: [
      { url: '/icons/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Prevent iOS auto-zoom on input focus while keeping pinch-zoom available for accessibility.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F7F8' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

// Applies the saved theme before first paint to avoid a light/dark flash.
const themeScript = `try{var t=localStorage.getItem('trigon.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} ${brand.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div vaul-drawer-wrapper="" className="min-h-dvh bg-bg">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
