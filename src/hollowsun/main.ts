/**
 * HOLLOW SUN — entry point. Boots renderer + world + post + game FSM.
 */
import { createFXState } from "./types";
import { WorldView } from "./world/WorldView";
import { PostStack } from "./fx/PostStack";
import { Game } from "./game/Game";

export async function boot(container: HTMLElement): Promise<void> {
  const fx = createFXState();
  const world = await WorldView.create(container, fx);
  const post = await PostStack.create(world.renderer, world.scene, world.camera);
  const game = new Game({ container, fx, world, post });
  game.start();

  // Remove the static "IGNITING…" placeholder now that the live scene is up.
  const loader = container.querySelector("[data-hs-loader]");
  if (loader) loader.remove();
}
