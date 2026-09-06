'use client';

import dynamic from 'next/dynamic';
import { useSyncExternalStore } from 'react';
import AfterglowDeathOverlay from '@/components/afterglow/DeathOverlay';
import AfterglowDraftOverlay from '@/components/afterglow/DraftOverlay';
import AfterglowHud from '@/components/afterglow/Hud';
import AfterglowTitleScreen from '@/components/afterglow/TitleScreen';
import AfterglowTouchControls from '@/components/afterglow/TouchControls';
import Hud from '@/components/game/Hud';
import Overlays from '@/components/game/Overlays';
import TitleScreen from '@/components/game/TitleScreen';
import TouchControls from '@/components/game/TouchControls';

/**
 * Host: default mounts AFTERGLOW (the pivot); `/?legacy=1` mounts the
 * EMBER RITE storyboard stack, unmodified and self-managed, reachable from
 * the AFTERGLOW title screen. Legacy components import @/game/engine at
 * module scope (proven SSR-safe — the old page did the same); the canvas
 * components stay dynamic/ssr:false like before.
 */

const AfterglowCanvas = dynamic(() => import('@/components/afterglow/AfterglowCanvas'), { ssr: false });
const LegacyGameCanvas = dynamic(() => import('@/components/game/GameCanvas'), { ssr: false });

type Stack = 'boot' | 'afterglow' | 'legacy';

/** read the stack choice from the URL without an effect / CSR bailout */
function subscribeStack(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}
function getStackSnapshot(): Stack {
  return new URLSearchParams(window.location.search).get('legacy') === '1' ? 'legacy' : 'afterglow';
}
function getStackServerSnapshot(): Stack {
  return 'boot';
}

export default function Home() {
  const stack = useSyncExternalStore(subscribeStack, getStackSnapshot, getStackServerSnapshot);

  return (
    <main
      className="fixed inset-0 select-none overflow-hidden bg-black text-white"
      style={{ touchAction: 'none' }}
    >
      {stack === 'afterglow' && (
        <>
          <AfterglowCanvas />
          <AfterglowHud />
          <AfterglowTitleScreen />
          <AfterglowDraftOverlay />
          <AfterglowDeathOverlay />
          <AfterglowTouchControls />
        </>
      )}

      {stack === 'legacy' && (
        <>
          <LegacyGameCanvas />
          <Hud />
          <TitleScreen />
          <Overlays />
          <TouchControls />
        </>
      )}

      {stack === 'boot' && <div className="absolute inset-0 bg-black" aria-hidden="true" />}
    </main>
  );
}
