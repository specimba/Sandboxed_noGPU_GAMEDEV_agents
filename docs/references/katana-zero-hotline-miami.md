# Katana ZERO / Hotline Miami — tear-down

**What it is:** One-hit-kill, instant-restart score-attack action. All depth in
*read and react*: telegraphs, spacing, chain-of-mistakes. Restart cost ≈ zero,
so death teaches instead of punishing. Momentum = score multipliers.

**Why it works:** Fast loops make mastery the reward itself; one-hit lethality
makes every decision matter; instant restart removes the rage gap.

**Implementation likelihood:** death overlay with one-key retry; restart in
< 1 s (we already rekindle instantly); combo/multiplier meters.

**In HOLLOW SUN terms:** graze is our katana-dodge: near-death that pays. Chain
multiplier decay (3.2 s) is Hotline's combo timer — keep it hot. Death →
REKINDLE is already one key; run start must be equally instant (shrine is
optional, not blocking).

**We deliberately differ:** we keep 3 embers (readability + fairness for a
bullet-hell at our speed) instead of 1HP — but dash i-frames + graze preserve
the one-mistake-stings feel inside each ember.
