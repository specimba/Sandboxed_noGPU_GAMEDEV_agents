import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'public/assets/meshes';
let pass = 0, fail = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.glb'))) {
  const buf = readFileSync(join(dir, f));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  await new Promise<void>((res) => {
    new GLTFLoader().parse(ab, '', (g) => {
      console.log(`PASS ${f} verts=${(g.scene.children[0] as unknown as { geometry: { attributes: { position: { count: number } } } }).geometry.attributes.position.count}`);
      pass++; res();
    }, (e) => { console.log(`FAIL ${f}: ${e}`); fail++; res(); });
  });
}
console.log(`ASSET_VERIFY pass=${pass} fail=${fail}`);
