import { Game } from "@/frontier/game/Game";

/** Boot entry — STEEL FRONTIER. WebGPU-first, async, zero React in the loop. */
export async function boot(canvas: HTMLCanvasElement): Promise<() => void> {
  const game = await Game.create(canvas);
  (window as unknown as { __FRONTIER: Game }).__FRONTIER = game;
  game.start();
  return () => {
    delete (window as unknown as { __FRONTIER?: Game }).__FRONTIER;
    game.dispose();
  };
}
