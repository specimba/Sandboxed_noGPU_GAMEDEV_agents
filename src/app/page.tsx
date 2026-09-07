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
 * Host: the 3D shooter roguelike (EMBER RITE / HOLLOW SUN line) IS the
 * product and owns the default route. The AFTERGLOW top-down survivor is a
 * SYSTEMS LAB (its deterministic sim, draft and feel-kit disciplines feed
 * the 3D line) — reachable at /?lab=afterglow. SPRINT 12 verdict: demoting
 * the 3D game to a "legacy" query param was a product regression; this
 * routing is the correction.
 */

const EmberCanvas = dynamic(() => import('@/components/game/GameCanvas'), { ssr: false });
const AfterglowCanvas = dynamic(() => import('@/components/afterglow/AfterglowCanvas'), { ssr: false });

type Stack = 'boot' | 'ember' | 'afterglow';

/** read the stack choice from the URL without an effect / CSR bailout */
function subscribeStack(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}
function getStackSnapshot(): Stack {
  return new URLSearchParams(window.location.search).get('lab') === 'afterglow'
    ? 'afterglow'
    : 'ember';
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
      {stack === 'ember' && (
        <>
          <EmberCanvas />
          <Hud />
          <TitleScreen />
          <Overlays />
          <TouchControls />
        </>
      )}

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

      {stack === 'boot' && <div className="absolute inset-0 bg-black" aria-hidden="true" />}
    </main>
  );
}
