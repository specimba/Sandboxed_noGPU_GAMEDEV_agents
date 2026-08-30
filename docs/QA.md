# NEXUS ARMOR — QA Checklist (manual + automated-assisted)

Automated: `bun run lint` (ESLint/TS), dev-server console clean, agent-browser E2E pass. No unit-test framework per environment policy; sim is kept pure so a harness can be added later.

## Kernel (hard gates)
- [ ] Fresh load → boot screen → click START → main menu (no blank/spinner/white screen, console clean)
- [ ] New player can reach firing a shot in <30 s (menu → mission 1 → WASD+mouse)
- [ ] Keyboard input never scrolls page during battle; buttons show press states
- [ ] Win and lose paths both reachable; results → restart without page refresh
- [ ] Pause (Esc) freezes sim, particles, timers, audio; resume continues exactly; Esc in menus doesn't leak
- [ ] Progress survives reload; corrupt-save handled (fresh profile, no crash); Reset behind confirmation
- [ ] Restart mid-battle fully resets sim/scene/HUD state
- [ ] Resize & orientation mid-battle keep layout/HUD correct
- [ ] Tab blur mid-battle auto-pauses; return doesn't fast-forward sim
- [ ] No backend required for play; with server absent, sync fails silently

## Combat & AI
- [ ] Front/side/rear hits give different damage numbers (verify via damage floats)
- [ ] Ricochet occurs on steep front hits (ping SFX + spark, 0 dmg); TD railgun never bounces
- [ ] Cover blocks shells + LOS; hull-down works; splash damages around cover edges
- [ ] Sniper shows red aim line before firing; breaking LOS cancels shot
- [ ] Rushers attempt flanks; Brutes push; low-HP enemies retreat
- [ ] Difficulty 1 vs 10 missions feel distinct (aim error/reaction/composition)

## Economy & meta
- [ ] Win pays > loss (40% rule); first-clear bonus applied once
- [ ] Credits buy hulls/upgrades; prices match config; purchases persist
- [ ] XP/level increases after battle; stats (kills/accuracy) update
- [ ] Mission unlock chain enforced; locked missions unclickable with reason

## Performance
- [ ] StatsOverlay (F3): ≥55 FPS desktop with 8+ enemies; draw calls < 100 on High
- [ ] Auto quality steps down under sustained load and recovers
- [ ] No memory climb over 5 consecutive battles (pools recycle)

## Accessibility & UX
- [ ] Reduced-motion disables shake/hit-stop; damage numbers toggleable
- [ ] Audio mute + volume slider effective; audio failure doesn't block play
- [ ] Touch controls appear on touch devices; buttons ≥44 px
- [ ] Keyboard-only menu navigation with visible focus
