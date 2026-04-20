'use client';

import { useState } from 'react';
import { NiftyTab } from '@/components/india/NiftyTab';
import { cn } from '@/lib/utils';

export default function Page() {
  const [isLight, setIsLight] = useState(true);

  return (
    <main
      className={cn(
        'min-h-screen transition-colors',
        isLight ? 'bg-gray-50 text-gray-900' : 'bg-zinc-950 text-zinc-100'
      )}
    >
      <header
        className={cn(
          'flex items-center justify-between border-b px-4 py-3',
          isLight ? 'border-gray-200 bg-white' : 'border-zinc-800 bg-zinc-900'
        )}
      >
        <div>
          <h1 className="text-lg font-semibold leading-tight">Backtest Lab</h1>
          <p className={cn('text-xs', isLight ? 'text-gray-500' : 'text-zinc-400')}>
            Block-based strategy tester for Indian equities
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsLight((v) => !v)}
          className={cn(
            'rounded-md border px-2.5 py-1 text-xs font-medium',
            isLight
              ? 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
              : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800'
          )}
        >
          {isLight ? 'Dark' : 'Light'}
        </button>
      </header>
      <div className="p-4">
        <NiftyTab isLight={isLight} />
      </div>
    </main>
  );
}
