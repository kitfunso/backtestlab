import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Backtest Lab — Indian Equities Strategy Tester',
  description:
    'Block-based strategy builder and portfolio optimizer for NSE-listed Indian stocks. Build, test, refine.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900 antialiased">
        {children}
        <footer className="mx-auto max-w-screen-xl px-4 py-3 text-center text-[10px] text-gray-500">
          Educational purposes only — not investment advice. Past performance does not predict future results.
        </footer>
      </body>
    </html>
  );
}
