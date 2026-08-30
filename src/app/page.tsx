'use client';

import dynamic from 'next/dynamic';
import Hud from '@/components/game/Hud';
import TitleScreen from '@/components/game/TitleScreen';
import Overlays from '@/components/game/Overlays';
import TouchControls from '@/components/game/TouchControls';

const GameCanvas = dynamic(() => import('@/components/game/GameCanvas'), { ssr: false });

export default function Home() {
  return (
    <main
      className="fixed inset-0 select-none overflow-hidden bg-black text-white"
      style={{ touchAction: 'none' }}
    >
      <GameCanvas />
      <Hud />
      <TitleScreen />
      <Overlays />
      <TouchControls />
    </main>
  );
}
