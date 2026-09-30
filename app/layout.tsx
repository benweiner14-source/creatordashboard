import type { Metadata } from 'next';
import { Rajdhani, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const rajdhani = Rajdhani({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-rajdhani',
});
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
});

export const metadata: Metadata = {
  title: 'Creator Dashboard',
  description: 'Plain-English analytics and content coaching for new creators.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${rajdhani.variable} ${plexSans.variable} ${plexMono.variable}`}>
      {/* Spec §8: soft indigo page wash (flat colour + a radial gradient
          overlay composited on top), replacing the previous flat white. */}
      <body className="min-h-screen bg-[#e7e2f6] bg-[radial-gradient(1100px_480px_at_12%_-10%,#ece7fa,transparent_60%)] font-sans text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
