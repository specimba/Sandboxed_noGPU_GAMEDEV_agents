/**
 * HOLLOW SUN — deployment trust chain (sprint 17).
 * Every ship states its sprint tag, the commit it descends from, and its
 * build timestamp — and the game PRINTS it on the title and death screens so
 * "which build am I playing" is answerable by looking at the screen.
 * Updated by hand at ship time; the report cites the resolvable hash.
 */
export const BUILD = {
  tag: 'SPRINT 17 — PROOF OF LIFE',
  base: '52f67c0', // inherited-tree baseline this sprint diffs against
  at: '2026-09-09T05:52Z', // stamped at ship
} as const;

export const buildStamp = `BUILD ${BUILD.tag} · BASE ${BUILD.base}`;
