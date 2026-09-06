/**
 * HOLLOW SUN — render→inspect loop step 2 (pipeline v2, PLAYBOOK §6 upgrade #1):
 * agentic visual QA. For each .qa/assets/*.png, ask the VLM (glm-4.6v via the
 * z-ai-web-dev-sdk — see skills/VLM/SKILL.md) for a one-line visual verdict on
 * the EMBER RITE quality bar (faceted/chiseled read, no obvious mesh errors).
 *
 * THE INSPECT GATE IS ADVISORY: it never hard-blocks the pipeline. If the SDK
 * is missing, fails to init, times out, or errors per-image → print SKIP and
 * exit 0. Verdicts land in .qa/asset-inspect.json either way.
 *
 * Usage: bun scripts/inspect-assets.ts [--dir .qa/assets] [--out .qa/asset-inspect.json]
 */

import ZAI from 'z-ai-web-dev-sdk';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PREVIEW_DIR = arg('--dir', '.qa/assets');
const OUT_FILE = arg('--out', '.qa/asset-inspect.json');
const TIMEOUT_MS = 90_000;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} after ${ms}ms`)), ms)),
  ]);
}

const PROMPT = (asset: string) =>
  `You are a strict game-art QA reviewer. This is a headless Blender preview render of the game asset "${asset}" ` +
  'from a dark-fantasy roguelite (art bar: EMBER RITE — near-black obsidian stone, faceted/chiseled silhouette, warm ember rim accents). ' +
  `In ONE line (max ~30 words) give a visual verdict: does it read as a clean faceted stone artifact with a clear silhouette? ` +
  'Flag obvious mesh errors (holes, inverted faces, exploded/floating parts, empty frame). ' +
  'Format exactly: PASS|WARN|FAIL - <reason>';

interface Row {
  asset: string;
  status: 'ok' | 'skip';
  verdict: string;
}

async function main(): Promise<void> {
  if (!existsSync(PREVIEW_DIR)) {
    console.log(`SKIP inspect: no preview dir ${PREVIEW_DIR} (run make previews first) — advisory gate not blocking`);
    return;
  }
  const pngs = readdirSync(PREVIEW_DIR).filter((n) => n.endsWith('.png')).sort();
  if (pngs.length === 0) {
    console.log(`SKIP inspect: no preview PNGs in ${PREVIEW_DIR} — advisory gate not blocking`);
    return;
  }

  let zai: Awaited<ReturnType<typeof ZAI.create>>;
  try {
    zai = await ZAI.create();
  } catch (e) {
    console.log(`SKIP inspect: VLM SDK init failed (${(e as Error).message}) — advisory gate not blocking`);
    return;
  }

  const rows: Row[] = [];
  for (const png of pngs) {
    const asset = png.replace(/\.png$/, '');
    const b64 = readFileSync(join(PREVIEW_DIR, png)).toString('base64');
    try {
      const res = await withTimeout(
        zai.chat.completions.createVision({
          model: 'glm-4.6v',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: PROMPT(asset) },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
              ],
            },
          ],
          thinking: { type: 'disabled' },
        }),
        TIMEOUT_MS,
        'VLM timeout',
      );
      const verdict = String(res?.choices?.[0]?.message?.content ?? '').trim() || 'EMPTY';
      rows.push({ asset, status: 'ok', verdict });
      console.log(`VERDICT ${asset} :: ${verdict}`);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      rows.push({ asset, status: 'skip', verdict: `SKIP (${msg})` });
      console.log(`SKIP ${asset} :: ${msg} — advisory gate not blocking`);
    }
  }

  mkdirSync('.qa', { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    advisory: true,
    engine: 'glm-4.6v via z-ai-web-dev-sdk createVision',
    previews: PREVIEW_DIR,
    rows,
  };
  writeFileSync(OUT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  const ok = rows.filter((r) => r.status === 'ok').length;
  console.log(`INSPECT done ok=${ok} skip=${rows.length - ok} → ${OUT_FILE} (advisory)`);
}

main().catch((e) => {
  console.log(`SKIP inspect: unexpected failure (${(e as Error).message}) — advisory gate not blocking`);
  process.exit(0);
});
