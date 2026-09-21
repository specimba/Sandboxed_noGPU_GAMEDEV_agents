// NEXUS ARMOR — tiny holder so inner overlay components can reach the engine instance
// (audio unlock / UI clicks) without threading refs through every component.
import type { Game } from '@/game/game'

export const gameRefHolder: { game: Game | null } = { game: null }
