/**
 * HOLLOW SUN — deployment trust chain (sprint 17).
 * Every ship states its sprint tag, the commit it descends from, and its
 * build timestamp — and the game PRINTS it on the title and death screens so
 * "which build am I playing" is answerable by looking at the screen.
 * Updated by hand at ship time; the report cites the resolvable hash.
 */
export const BUILD = {
  tag: 'SPRINT 19 — MANY SUNS',
  base: '779ca5d', // sprint-18 PALE CHOIR head (rollback tag: rollback/sprint18-pale-choir)
  at: '2026-09-15T13:51Z', // stamped at ship
} as const;

export const buildStamp = `BUILD ${BUILD.tag} · BASE ${BUILD.base}`;
