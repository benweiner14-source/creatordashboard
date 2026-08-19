import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Creator Dashboard',
  description: 'Plain-English analytics and content coaching for new creators.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Spec §8: soft indigo page wash (flat colour + a radial gradient
          overlay composited on top), replacing the previous flat white. */}
      <body className="min-h-screen bg-[#e7e2f6] bg-[radial-gradient(1100px_480px_at_12%_-10%,#ece7fa,transparent_60%)] text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
