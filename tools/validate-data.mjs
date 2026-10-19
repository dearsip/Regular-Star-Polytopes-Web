import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(name, root), 'utf8'));
const binary = async name => gunzipSync(await readFile(new URL(name, root)));
const catalog = await json('data/catalog.json');
assert.equal(catalog.models.length, 21);
assert.equal(catalog.models.filter(m => m.dimension === 3).length, 5);
assert.equal(new Set(catalog.models.map(m => m.id)).size, 21);
assert.equal(catalog.models.filter(m => m.compound && m.dimension===3).length, 1, '3D compounds');
assert.equal(catalog.models.filter(m => m.compound && m.dimension===4).length, 6, '4D compounds');
let triangles = 0;
for (const item of catalog.models) {
  const m = await json(`data/${item.id}.json`);
  assert.equal(m.id, item.id);
  assert(m.cellCount > 0 && m.unitCount > 0);
  assert(m.originalCell >= 0 && m.originalCell < m.cellCount);
  assert(Number.isFinite(m.explosionMax) && m.explosionMax > 0);
  assert.equal(m.sectorPlanes.length, m.sectorSizes.reduce((a, b) => a + b, 0) * m.dimension);
  if(m.compound)assert.equal(m.unitCells.length,m.unitCount);
  if(m.id==='StellaOctangula') {
    assert.equal(m.componentCount,2);assert.equal(m.cellCount,8);assert.equal(m.unitCount,24);
    assert.deepEqual(m.groups.map(g=>g.orbitSize),[8,6]);assert.deepEqual(m.groups.map(g=>g.units.length),[3,8]);
    assert(m.shaderDefines.includes('COMPOUND_TETRA'));
  }
  for (const group of m.groups) for (const id of group.units) assert(id >= 0 && id < m.unitCount);
  for (const kind of ['full', 'original']) {
    const b = await binary(`data/${m.id}.${kind === 'full' ? 'surface' : kind}.bin.gz`);
    assert.equal(b.toString('ascii', 0, 4), 'STG1');
    const n = b.readUInt32LE(4), indices = b.readUInt32LE(8);
    assert.equal(n, m[kind].vertices);
    assert.equal(indices, m[kind].triangles * 3);
    assert.equal(b.length, 16 + n * 24 + indices * 4);
    assert.equal(createHash('sha256').update(b).digest('hex'), m[kind].sha256);
    for (let i = 0; i < n * 4; i++) assert(Number.isFinite(b.readFloatLE(16 + i * 4)));
    for (let i = 0; i < n; i++) assert(b.readUInt32LE(16 + n * 20 + i * 4) < (kind === 'full' ? m.unitCount : m.cellCount));
    for (let i = 0; i < indices; i++) assert(b.readUInt32LE(16 + n * 24 + i * 4) < n);
    triangles += indices / 3;
  }
  assert.equal((await binary(`data/${m.id}.frames.bin.gz`)).length, m.cellCount * 7 * 16);
  assert.equal((await binary(`data/${m.id}.centers.bin.gz`)).length, m.unitCount * 16);
  if (m.dimension === 4) {
    assert.equal((await binary(`data/${m.id}.pockets.bin.gz`)).length, m.pocketTexels * 16);
    assert(m.shaderDefines.length>0 && m.shaderFile===m.id+'.pocket.glsl');
    assert((await readFile(new URL('data/'+m.shaderFile,root),'utf8')).length>0);
    if(m.id==='Fix'){
      assert(m.shaderDefines.includes('POCKET_FIX_DIRECT'));
      assert.equal((await binary('data/Fix.unit-frames.bin.gz')).length,m.unitCount*64);
    }
  }
  else {
    assert.equal(m.unitCells.length, m.unitCount);
    assert.equal(m.blockPlanes.length, m.blockSizes.reduce((a, b) => a + b, 0) * 4);
  }
  console.log(`${m.id}: mesh, indices, unit IDs, selection and SHA-256 OK`);
}
const lock = await json('vendor/three/manifest.json');
for (const [name, sha] of Object.entries(lock.sha256)) assert.equal(createHash('sha256').update(await readFile(new URL('vendor/three/' + name, root))).digest('hex'), sha);
console.log(`Validated all 21 models (${triangles.toLocaleString()} triangles) and vendored Three.js.`);
