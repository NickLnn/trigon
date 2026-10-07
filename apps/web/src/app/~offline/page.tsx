import { WifiOff } from 'lucide-react';

export const metadata = { title: 'Offline' };

export default function Offline() {
  return (
    <main className="grid min-h-dvh place-items-center p-8 text-center">
      <div>
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-surface-2">
          <WifiOff className="size-7 text-ink-2" />
        </span>
        <h1 className="mt-5 text-title font-bold">You&apos;re offline</h1>
        <p className="mt-2 max-w-xs text-ink-2">Pages you&apos;ve opened recently are still available. Reconnect to see the latest changes.</p>
      </div>
    </main>
  );
}
