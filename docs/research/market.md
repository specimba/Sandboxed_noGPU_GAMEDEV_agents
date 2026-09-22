# Market Research — NEXUS Armor (working title)

**Scope:** competitive/market research for an original-IP browser tank-combat game (WebGL/Three.js, PvE-first, PvP later).
**Method:** live web searches (z-ai web_search) + page fetches (z-ai page_reader) of SteamCharts, Metacritic, GameDiscoverCo, Deconstructor of Fun and community/press pages. All numbers below are point-in-time figures as retrieved during research (steamcharts.com/Metacritic change continuously); anything not directly source-backed is marked **(estimate)** or **(unverified)**.

---

## 1. Per-game breakdown

| Game | Platform | Core strengths | Retention hooks | Monetization | Criticisms |
|---|---|---|---|---|---|
| **World of Tanks** (Wargaming, 2010–) | PC (client), console, mobile spin-offs | Deep vehicle trees; recognizable brand; 16v15 team play (matches ~7–15 min, **estimate**) | Tech-tree progression, daily/mission grind, clan/social play, 16th anniversary events (worldoftanks.com shows anniversary promos) | F2P: premium account, premium tanks, premium ammo. Historically criticized as P2W; Wargaming publicly moved to "free-to-win" framing in 2013 (gamedeveloper.com) — but players still argue premium tanks/ammo create advantages (Steam community 2025: "Premium tanks are almost unilaterally better... Premium ammo makes the game...") | P2W perception; steep high-tier grind; punishing new-player experience **(community consensus, unverified quantitatively)** |
| **War Thunder** (Gaijin, 2012–) | PC, PS, Xbox | Combined-arms (tanks+planes+ships); detailed damage model; persistent progression | Huge tech trees; events; squad play; very high CCU (see §2) | F2P: premium account/vehicles; vehicle-pack sales; "Economy Update" nerfs sparked revolt | Economy/grind is the #1 complaint: Metacritic user score **4.1/10, 54% negative** (metacritic.com/game/war-thunder/user-reviews/); May 2023 review bombing ~50K negative Steam reviews in 5 days forced Gaijin to revert economy changes (resetera.com, pcgamer.com, mmorpg.com). Users: "the grind is a job"; ~150 hours to reach mid-tier BR (user review) |
| **World of Tanks Blitz** (Wargaming, 2014–) | Mobile + PC (Steam) + Win10 | Fast 7v7 (shorter matches, **estimate** 4–7 min); cross-platform; simplified controls | 10 years of seasonal events, missions; huge install base: **120M+ downloads at 5th anniversary** (wargaming.com), **180M registered players at 10 years** (gamespress.com, Jun 2024) | F2P: premium account/tanks, cosmetics | Same P2W/grind debates as WoT; Steam version is a small slice of audience (Steam CCU ~5.8K avg last 30 days, steamcharts.com/app/1407200) |
| **Crossout** (Targem/Gaijin, 2017–) | PC, PS, Xbox | Unique build-your-vehicle combat; craft/market economy | Crafting, clan wars, battle passes | F2P: crafting grinds, market, packs; long criticized for aggressive monetization (rockpapershotgun.com 2016: "Shame about the awful microtransactions") | Deliberately slow grind ("deliberately crazy slow by design" — r/Crossout; "most vile, disgustingly slow grind" — Steam top review); Metacritic user score **5.9/10** (Xbox listing); declining Steam CCU: last-30-day avg ~1,078 and falling (steamcharts.com/app/386180) |
| **Tanki Online / Tanki X** (AlternativaPlatform) | Browser (Flash→HTML5) | True browser tank PvP pioneer (2009); instant play, simple controls, clans | Ranks, hulls/turrets upgrades, clan battles | F2P: crystals/parts, premium, cosmetics | Graphics aging; Flash EOL forced HTML5 migration (tankiwiki); **Tanki X (standalone "successor") shut down early 2020** after failing to migrate the audience (en.wikipedia.org/wiki/Tanki_Online) — cautionary tale about restarting IP on a new client |
| **Gunner, HEAT, PC!** (GHPC, 2022– Early Access) | PC (Steam, paid $30) | Cold-War tank sim-lite; "Very Positive" Steam rating (91% of 4,873 reviews, store page); accessible-but-tactical controls | Single-player/PvE focus, mission editor, sim depth without hardcore overhead | **Premium one-time purchase** — no F2P monetization backlash | Early-access rough edges; audio/vehicle feel nits (Steam negative-review feed); runs "okay on 8GB RAM" — perf on weak hardware still a concern for players |
| **Steel Hunters** (Wargaming, 2025) | PC (Steam, F2P) | PvPvE mech hero-shooter; strong production values | Extraction/hero progression | F2P live service | **Shut down ~6 months after April 2, 2025 early-access launch**; announced July 2025, servers off ~Oct 8, 2025, citing "unsustainable costs and low player retention" (gamedeveloper.com, wccftech.com, mmorpg.com). Lesson: expensive live-service PvP needs a large audience fast |
| **Enlisted** (Darkflow/Gaijin, 2021–) | PC, console | WW2 squad shooter; broad appeal; runs on simple laptops (user review: "Small installation (54 gig) and runs on a simple laptop") | Squad progression trees, daily tasks, battle-pass seasons | F2P with premium squads/weapons; widely criticized cosmetic monetization ("one of the worst... cosmetic monetization systems I've ever seen" — forum.enlisted.net, Jan 2024) | Metacritic user score **5.9/10 (PC)**; P2W perception ("matches you against advanced players to force you to pay" — user review), AI squad quality, unbalanced teams (r/enlistedgame) |
| **MWT: Tank Battles** (My Games / Modern War series) | Mobile (iOS/Android) | Modern tank arcade PvP; adjustable graphics & controls (Google Play listing) | Missions, progression, seasonal events | F2P mobile IAP | Optimization/crash complaints (r/ModernWarships rant), PvP-first grind friction; App Store 4.8/5 but small review base vs. WoT Blitz |
| **Shell Shockers** (Blue Wizard, 2017–) | **Browser** (Babylon.js/HTML5) | Instant-play FPS; readable egg visuals; runs on Chromebooks; face-to-face school virality | Short rounds, cosmetics, friend groups playing together on school networks | **~80–90% ads**, IAP split ~50/50 cosmetics vs. VIP (ad-free + non-competitive bonuses); revenue "in the low seven figures annually"; DAU peaks 300–350K (GameDiscoverCo deep dive, Jan 2023) | None major; marketing is hard (no press/influencers) — virality had to be built into the product |
| **diep.io** (Matheus Valadares/Miniclip, 2016–) | Browser + mobile | Minimal 2D tank arena; instant restart loop; upgrade branching (level 45, class trees) | Fast self-paced progression each run; leaderboard chase | Ads on portals (CrazyGames); light IAP on mobile | Simple visuals divide opinion; balance swings as classes get added **(community sentiment, unverified)** |
| **Krunker.io** (Sidney de Vries, 2018–) | **Browser** (WebGL) | Smooth low-latency browser FPS; low-spec friendly; big esports-lite community; custom maps | Skill ceiling, trading/cosmetics, creator economy | Cosmetics + membership (KR) | WebGL dependency: if blocked/software-rendered, "gameplay can become unplayable" (community guides) — perf fallback matters |

---

## 2. Steam Charts evidence — demand for persistent-progression vehicle combat

Fetched from steamcharts.com at research time (figures are point-in-time; the site shows a rolling 30-day window):

- **War Thunder** ([steamcharts.com/app/236390](https://steamcharts.com/app/236390)): **65,938 playing** at fetch; **24-hour peak 85,653**; **all-time peak 125,317**; last-30-days average **50,638 (+2.14%)**. Steam alone sustaining ~50K CCU average for a 13-year-old F2P vehicle game ⇒ strong, durable demand for persistent-progression vehicle combat. (Steam is only part of the audience; Gaijin launcher/mobile users are not counted.)
- **World of Tanks Blitz (Steam version)** ([steamcharts.com/app/1407200](https://steamcharts.com/app/1407200)): 8,314 playing at fetch; 24-h peak 10,107; all-time peak 24,057; last-30-days avg **5,818 (+26.11%)**. Modest on Steam because the real audience is mobile (180M registered players, gamespress.com).
- **Crossout** ([steamcharts.com/app/386180](https://steamcharts.com/app/386180)): 24-h peak 1,780; all-time peak 12,115; last-30-days avg **1,078 (−2.71%)**, with consecutive monthly declines visible. Shows what happens when grind/monetization friction outlives a game's novelty.

**Implication:** the "big tank game" slot (WoT/War Thunder) demonstrably holds a large concurrent audience on PC; there is no established **browser-based** 3D tank game occupying that space at scale (Tanki Online is the closest historical example). A browser title that captures even a fraction of the WoT/WT audience on low-friction web distribution is a realistic niche.

---

## 3. Evidence-backed design principles

1. **Instant play is the browser superpower.** Shell Shockers built a seven-figure/yr business with zero installs, mostly on school Chromebooks (39% of player base, GameDiscoverCo). NEXUS Armor must go from URL click → firing in <60s including asset streaming. No launcher, no accounts required for first play.
2. **Design for the weakest GPU, not the strongest.** Shell Shockers' hardest engineering problem was framerate on "frankly very underpowered" Chromebooks (GameDiscoverCo); Krunker guides note WebGL-blocked/software-rendered browsers make gameplay "unplayable." Ship a scalable quality preset + detect software WebGL and degrade gracefully (lower draw distance, simpler shaders).
3. **PvE-first lowers the floor for new players.** WoT/War Thunder/Enlisted all catch flak for throwing new players against veterans/premium users (Metacritic user reviews; r/enlistedgame "too many matches where 1 team..."). A PvE-first campaign (GHPC-style "fun, not hardcore" tank fantasy — Steam 91% positive) gives players competence before PvP exposure.
4. **Session length: 5–15 minutes per battle.** WoT Blitz's short 7v7 supports a 180M-registration mobile business (gamespress.com); browser play rewards "one more round" loops (Shell Shockers school sessions between classes — GameDiscoverCo). Target ~5–8 min PvE missions and ~8–12 min PvP matches **(estimates)**.
5. **Never sell power.** The single loudest recurring criticism across WoT (premium ammo/tanks), War Thunder (premium vehicles), Enlisted (premium squads) is pay-to-win perception (see §4). Sell cosmetics, progression speed (careful: Crossout shows overdone grind-to-sell breeds revolt), battle passes, and QoL — never damage, armor or matchmaking advantage.
6. **The economy is the game — tune it like a live feature.** War Thunder lost ~50K Steam reviews in 5 days over one economy patch and had to revert (pcgamer.com, resetera.com, mmorpg.com). Budget for continuous economy telemetry, communicate changes early, and keep per-match income positive-feeling even on losses.
7. **Respect the grind budget.** Crossout's "deliberately crazy slow" grind (r/Crossout, Steam reviews) correlates with a 6× smaller Steam CCU than War Thunder. Keep horizontal (variety) progression fast and vertical (mastery) progression slower; daily play should visibly move a bar every session.
8. **Battle pass = retention tool first, revenue second.** Deconstructor of Fun: for most players "the Pass is primarily retention and an engagement mechanism"; a mis-designed pass can even reduce revenue (Clash Royale temporal correlation, deconstructoroffun.com). Design a short-season (~4–6 weeks, **estimate**) pass with free-track value, cosmetic paid track, and session-sized weekly goals.
9. **Daily missions sized to one or two battles.** Retention literature: D1 ~30–40% and D7 ~5–15% are realistic targets for F2P; median mobile games retain only ~1–4% by D30 (juegostudio.com, r/gamedev threads). Daily missions completable in ≤15 min drive the return visit without forcing marathon sessions.
10. **Readable, stylized visuals beat realism at browser scale.** diep.io and Shell Shockers win on instant readability, not fidelity; MWT: Tank Battles advertises adjustable graphics while users still complain about optimization (r/ModernWarships). Stylized original IP also sidesteps the licensing/realism arms race of WoT/WT.
11. **Front-load social/viral mechanics.** Shell Shockers grew via face-to-face school virality ("features that encourage face-to-face virality work best" — GameDiscoverCo). Add shareable match replays, party links that drop friends into the same lobby in one click, and simple co-op missions from day one.
12. **Meet players on portals; don't bet on web marketing.** "It's difficult to market or advertise web games effectively. There's no press, limited influencers" (GameDiscoverCo). CrazyGames alone reaches **50M+ monthly players** (docs.crazygames.com/faq). Distribution strategy: portal embeds + instant-play landing page, not ad spend.
13. **Persistence must survive platform shifts.** Tanki X (a client rewrite of Tanki Online) failed and was shut down in 2020, stranding player investment (en.wikipedia.org/wiki/Tanki_Online). NEXUS Armor's account/progression layer should be web-native and exportable so the game survives engine or portal changes.
14. **Cheap, forgiving hardware = bigger funnel.** Enlisted users praise that it "runs on a simple laptop"; GHPC players run it on 8GB RAM. Every graphical decision in a WebGL tank game should be judged by "does this still run on a 2018 Chromebook / integrated GPU?"
15. **Match length and lobby friction determine repeat play.** Browser .io titles win by minimizing menu → action latency (Krunker's promise: "No download required, works on any device" — krunker.io). Every extra click between battles measurably hurts the "one more match" loop **(design consensus, unverified quantitatively)**.

---

## 4. Recurring criticisms to avoid (with sources)

- **Pay-to-win perception / premium ammo & vehicles:** WoT Steam discussion "Very much so yes. Premium tanks are almost unilaterally better" (steamcommunity.com/app/1407200/discussions); Enlisted "pay to win" user reviews (metacritic.com/game/enlisted/user-reviews); historical WoT P2W era acknowledged by Wargaming itself (gamedeveloper.com "Wargaming kicks 'pay-to-win' monetization to the curb").
- **Predatory/punishing economy and grind:** War Thunder Metacritic user score 4.1/10 with "The game economy is predatory... progress" (metacritic.com); May 2023 review bombing → forced economy revert (pcgamer.com; mmorpg.com); Crossout "most vile, disgustingly slow grind" (steamcommunity.com/app/386180/reviews).
- **Matchmaking pain (constant uptiers, unbalanced teams):** War Thunder Trustpilot summary "terrible matchmaking, constant uptiers, severely unbalanced vehicles" (trustpilot.com/review/warthunder.net); Enlisted "too unbalanced... by design" (r/enlistedgame).
- **New-player experience & long time-to-fun:** War Thunder user: "super long grinds where it only feels like the game starts at 5.7... took me about 150 hours" (metacritic.com user review); Enlisted squad-AI "cannon fodder" (metacritic.com user review).
- **Monetized cosmetics gone wrong:** Enlisted "worst cosmetic monetization system I've ever seen" (forum.enlisted.net, Jan 2024); Crossout battle-pass value complaints "the battle passes are not worth it... the market is to[o] pricey" (metacritic.com/game/crossout/user-reviews).
- **Performance/optimization complaints:** MWT: Tank Battles "not optimized as it constantly crashes" (r/ModernWarships); GHPC "runs okay on 8gb ram, but..." (store.steampowered.com/app/1705180); browser WebGL-blocked = unplayable (community guides on Krunker).
- **UI clutter / complexity creep:** War Thunder user: "interface is better (not a billion buttons)" was praise for a *competitor* (metacritic.com user review, RU); general community sentiment that WT's UI/controls overwhelm newcomers **(unverified beyond anecdotes)**.
- **Aggressive live-service scaling without audience:** Steel Hunters shut down ~6 months post-launch for "unsustainable costs and low player retention" (gamedeveloper.com; wccftech.com) — don't build features that require a huge concurrent base before proving the core loop.

---

## 5. Browser-specific considerations

- **Performance envelope:** assume integrated GPUs, 2–8GB RAM, 60Hz Chromebook-class displays. Use Three.js with instanced/low-poly tanks, baked lighting or cheap probes, texture atlases, and a quality ladder (Krunker/Shell Shockers model). Detect software-rendered WebGL and warn/degrade (Krunker community guides).
- **Asset delivery:** stream maps progressively; target first-battle payload in the low MBs (Shell Shockers runs instantly on school networks) **(estimate — treat as design target, not sourced fact)**.
- **Networking:** Shell Shockers' backend "needs to handle 10,000+ simultaneous players" across servers (GameDiscoverCo) — plan stateless authoritative servers + regional matchmaking from the start; WebSocket transport is proven for .io titles.
- **Monetization mix on the web:** ads (interstitials between battles, optional rewarded video) historically carry 80–90% of browser-game revenue, with cosmetics/VIP making up the rest (Shell Shockers, GameDiscoverCo). Portals (CrazyGames — 50M+ monthly players) take revenue share in exchange for traffic; design the game to be embeddable and portal-friendly.
- **Audience reality check:** browser audiences skew young (Shell Shockers: 10–15 years old, US-heavy, 47.6% US traffic — GameDiscoverCo); school networks block URLs (hence mirror domains) — plan vanity/mirror URLs and school-friendly content ratings.
- **Desktop-first, mobile-later:** Shell Shockers: ~51% Windows + 39% Chromebook, mobile only ~10% — a twitchy tank game plays best with keyboard+mouse; treat touch as a later, separate control scheme (WoT Blitz proves mobile works, but as a dedicated build).
- **Session friction is the whole pitch:** the product IS the URL. Every design review should ask "what does this add between the click and the cannon?" (Krunker: "No download required, works on any device").

---

## 6. Sources

**Steam player data (fetched pages)**
- https://steamcharts.com/app/236390 — War Thunder
- https://steamcharts.com/app/1407200 — World of Tanks Blitz (Steam)
- https://steamcharts.com/app/386180 — Crossout

**Metacritic (fetched pages)**
- https://www.metacritic.com/game/war-thunder/user-reviews/ — user score 4.1/10, 54% negative
- https://www.metacritic.com/game/crossout/user-reviews/ — user score 5.9/10 (Xbox listing)
- https://www.metacritic.com/game/enlisted/user-reviews — user score 5.9/10 (PC)

**Deep dives / industry analysis (fetched pages)**
- https://newsletter.gamediscover.co/p/deep-dive-shell-shockers-multi-million — GameDiscoverCo Shell Shockers deep dive (Jan 30, 2023)
- https://www.deconstructoroffun.com/blog/2022/6/4/battle-passes-analysis — battle-pass design analysis (Jun 2022)

**News & press**
- https://www.gamedeveloper.com/business/wargaming-published-live-service-title-steel-hunters-scrapped-after-three-months
- https://wccftech.com/wargaming-announces-steel-hunters-is-shutting-down-three-months-after-early-access-launch
- https://www.mmorpg.com/news/wargaming-is-sunsetting-steel-hunters-after-just-months-in-early-access-2000135444
- https://www.pcgamer.com/war-thunder-fans-organise-extraordinary-review-bombing-campaign-over-reverted-economy-changes-studio-pleads-if-your-goal-is-not-to-hurt-the-game-please-use-other-less-destructive-ways
- https://www.resetera.com/threads/war-thunder-players-are-in-a-full-revolt-over-the-economy-with-near-50k-negative-reviews-in-5-days.721858
- https://www.mmorpg.com/news/war-thunder-devs-revert-economic-changes-after-community-feedback-and-review-bombing-2000128004
- https://www.gamedeveloper.com/business/wargaming-kicks-pay-to-win-monetization-to-the-curb
- https://www.gamespress.com/World-of-Tanks-Blitz-Marks-a-Decade-with-180-Million-Registered-Player
- https://wargaming.com/en/news/wot-blitz-5th-anniversary — 120M+ downloads

**Official / product pages**
- https://store.steampowered.com/app/1705180/Gunner_HEAT_PC/ — 91% Very Positive (4,873 reviews)
- https://worldoftanks.com — WoT 16th anniversary promos
- https://tankionline.com ; https://en.tankiwiki.com/About_the_game ; https://en.wikipedia.org/wiki/Tanki_Online — Tanki Online/Tanki X history
- https://krunker.io ; https://krunkerio.fandom.com/wiki/Settings
- https://www.crazygames.com/game/shellshockersio ; https://www.crazygames.com/game/diepio
- https://docs.crazygames.com/faq — CrazyGames 50M+ monthly players
- https://play.google.com/store/apps/details?id=com.Shooter.ModernWarfront — MWT: Tank Battles
- https://en.wikipedia.org/wiki/Diep.io ; https://diep.io

**Community sentiment**
- https://www.reddit.com/r/Crossout/comments/1gfyov1/is_crossout_worth_it
- https://steamcommunity.com/app/386180/reviews/?browsefilter=toprated
- https://forum.enlisted.net/t/this-game-has-one-of-the-worst-if-not-the-worst-cosmetic-monetization-system-ive-ever-seen-in-a-videogame/133831
- https://www.reddit.com/r/enlistedgame/comments/1iwkpf7/unpopular_opinion_enlisted_is_a_pretty_good_game
- https://www.reddit.com/r/ModernWarships/comments/1hfspz0/a_brief_rant_about_mwt
- https://www.trustpilot.com — War Thunder review themes
- https://www.rockpapershotgun.com/crossout-review-early-access

**Retention benchmarks (treat as ranges, not laws)**
- https://www.juegostudio.com/blog/how-to-increase-user-retention-and-increase-your-games-lifetime — median D30 ~1%
- https://www.reddit.com/r/gamedev/comments/zf9nk1/ — D1 30% "exceptional", D7 7% "hard"
- https://featureupvote.com/blog/game-retention — D1/D7/D30 benchmark ranges
- https://www.gamemakers.com/p/understanding-battle-pass-game-design — battle pass as monetization+retention tool
- https://machinations.io/articles/battle-passes-and-how-to-balance-them — pass pacing/caps
