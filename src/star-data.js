import * as THREE from 'three';

export async function fetchJSON(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`${response.status}: ${url}`);
    return response.json();
}

export async function fetchBinary(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`${response.status}: ${url}`);
    let buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // Also handles hosts which already decoded a Content-Encoding: gzip response.
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        if (!globalThis.DecompressionStream) throw new Error('このブラウザーはgzip展開に未対応です。ブラウザーを更新してください。');
        buffer = await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    return buffer;
}

async function fetchText(url, signal) {
    const response=await fetch(url,{signal});
    if(!response.ok)throw new Error(`${response.status}: ${url}`);
    return response.text();
}

export function decodeGeometry(buffer) {
    const header = new DataView(buffer);
    if (buffer.byteLength < 16 || header.getUint32(0, true) !== 0x31475453) throw new Error('Invalid STG1 mesh');
    const vertices = header.getUint32(4, true), indices = header.getUint32(8, true);
    if (buffer.byteLength !== 16 + vertices * 24 + indices * 4) throw new Error('Truncated STG1 mesh');
    const geometry = new THREE.BufferGeometry();
    // Indexed custom shaders use aPosition4; a dummy XYZ buffer would consume
    // another 12 bytes per vertex on both the CPU and GPU without being read.
    geometry.setAttribute('aPosition4', new THREE.BufferAttribute(new Float32Array(buffer, 16, vertices * 4), 4));
    geometry.setAttribute('aLightingNormal', new THREE.BufferAttribute(new Int8Array(buffer, 16 + vertices * 16, vertices * 4), 4, true));
    // Unit IDs fit exactly in Float32 and are interpolated as flat integers in GLSL.
    geometry.setAttribute('aUnit', new THREE.BufferAttribute(Float32Array.from(new Uint32Array(buffer, 16 + vertices * 20, vertices)), 1));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer, 16 + vertices * 24, indices), 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
    return geometry;
}

export function texture(data, width = 256) {
    const height = Math.max(1, Math.ceil(data.length / (4 * width)));
    const packed = new Float32Array(width * height * 4);
    packed.set(data);
    const result = new THREE.DataTexture(packed, width, height, THREE.RGBAFormat, THREE.FloatType);
    result.minFilter = result.magFilter = THREE.NearestFilter;
    result.generateMipmaps = false;
    result.flipY = false;
    result.needsUpdate = true;
    return result;
}

export async function loadModel(id, signal) {
    const base = new URL(`../data/${id}`, import.meta.url).href;
    const metadata = await fetchJSON(base + '.json', signal);
    const assets = await Promise.all([
        fetchBinary(base + '.surface.bin.gz', signal),
        fetchBinary(base + '.original.bin.gz', signal),
        fetchBinary(base + '.frames.bin.gz', signal),
        fetchBinary(base + '.centers.bin.gz', signal),
        metadata.dimension === 4 ? fetchBinary(base + '.pockets.bin.gz', signal) : Promise.resolve(new ArrayBuffer(64)),
        metadata.dimension === 4 ? fetchText(new URL('../data/'+metadata.shaderFile,import.meta.url),signal) : Promise.resolve(''),
        id==='Fix' ? fetchBinary(base+'.unit-frames.bin.gz',signal) : Promise.resolve(new ArrayBuffer(16))
    ]);
    const resources = {
        surface: decodeGeometry(assets[0]), original: decodeGeometry(assets[1]),
        frames: texture(new Float32Array(assets[2]), 7), centers: texture(new Float32Array(assets[3])),
        pockets: texture(new Float32Array(assets[4])),
        pocketShader: assets[5],fixFrames: texture(new Float32Array(assets[6]))
    };
    // Original cells need no occlusion entry. Full meshes carry baked entry IDs,
    // matching the compact POSITION.z word used by the source fast path.
    resources.original.setAttribute('aEntry',new THREE.BufferAttribute(new Float32Array(metadata.original.vertices).fill(-1),1));
    const ids=resources.surface.getAttribute('aUnit').array;
    const entries=new Float32Array(ids.length).fill(-1);
    if(metadata.dimension===4){
        const atlas=new Float32Array(assets[4]),seed=Math.round(atlas[3])*4;
        for(let i=0;i<ids.length;i++)entries[i]=atlas[seed+ids[i]];
    }
    resources.surface.setAttribute('aEntry',new THREE.BufferAttribute(entries,1));
    resources.headers = Array.from({ length: 4 }, (_, i) => new THREE.Vector4().fromArray(new Float32Array(assets[4]), i * 4));
    const unitCells = new Float32Array(metadata.unitCount * 4);
    metadata.unitCells?.forEach((cell, i) => unitCells[i * 4] = cell);
    resources.unitCells = texture(unitCells);
    const blocks = [];
    let offset = 0;
    for (const size of metadata.blockSizes ?? []) {
        blocks.push(size, 0, 0, 0);
        blocks.push(...metadata.blockPlanes.slice(offset, offset + size * 4));
        offset += size * 4;
    }
    resources.blocks = texture(blocks.length ? blocks : [0, 0, 0, 0]);
    const regions = [];
    offset = 0;
    for (const size of metadata.sectorSizes) {
        regions.push(size, 0, 0, 0);
        for (let i = 0; i < size; i++) {
            const p = metadata.sectorPlanes.slice(offset, offset + metadata.dimension);
            regions.push(...(metadata.dimension === 3 ? [p[0], p[1], 0, p[2]] : p));
            offset += metadata.dimension;
        }
    }
    resources.regions = texture(regions);
    resources.selection = texture(new Float32Array(metadata.unitCount * 4));
    // Reuse the source vertex buffers and draw only selected triangle ranges.
    // CSG still describes the full solid, so undisplayed cells can occlude them.
    const subsets=new Map(),rangeCache=new Map();
    function subset(source,units,key){
        if(subsets.has(key))return subsets.get(key);
        const indices=source.index.array,ids=source.getAttribute('aUnit').array;
        if(!rangeCache.has(source)){
            const ranges=new Map();let start=0,previous=ids[indices[0]];
            for(let i=3;i<=indices.length;i+=3){
                const uid=i===indices.length?-1:ids[indices[i]];
                if(uid!==previous){ranges.set(previous,[start,i]);start=i;previous=uid;}
            }
            rangeCache.set(source,ranges);
        }
        const ranges=rangeCache.get(source),parts=units.map(uid=>ranges.get(uid)).filter(Boolean);
        const selected=new Uint32Array(parts.reduce((n,[a,b])=>n+b-a,0));let offset=0;
        for(const [a,b] of parts){selected.set(indices.subarray(a,b),offset);offset+=b-a;}
        const geometry=new THREE.BufferGeometry();
        for(const [name,attribute] of Object.entries(source.attributes))geometry.setAttribute(name,attribute);
        geometry.setIndex(new THREE.BufferAttribute(selected,1));geometry.boundingSphere=source.boundingSphere;
        subsets.set(key,geometry);return geometry;
    }
    resources.vertexNeighborhood=group=>subset(resources.surface,metadata.groups[group].units,'vertex-'+group);
    resources.singleCell=()=>subset(resources.original,[metadata.originalCell],'single');
    resources.radialSurface=()=>{
        if(subsets.has('radial'))return subsets.get('radial');
        const points=resources.surface.getAttribute('aPosition4').array,ids=resources.surface.getAttribute('aUnit').array;
        const centers=new Float32Array(assets[3]),radius=new Float64Array(metadata.unitCount);
        for(let i=0;i<ids.length;i++){
            const uid=ids[i];let d=0;for(let k=0;k<4;k++)d+=(points[i*4+k]-centers[uid*4+k])**2;
            radius[uid]=Math.max(radius[uid],d);
        }
        const cones=[];let offset=0;
        for(const count of metadata.sectorSizes){
            const planes=[];
            for(let i=0;i<count;i++){
                const p=metadata.sectorPlanes.slice(offset,offset+metadata.dimension);offset+=metadata.dimension;
                const n=metadata.dimension===3?[p[0],p[1],0,p[2]]:p;planes.push([n,Math.hypot(...n)]);
            }
            cones.push(planes);
        }
        const units=[];
        for(let uid=0;uid<metadata.unitCount;uid++){
            const r=Math.sqrt(radius[uid])+2e-6;
            if(cones.some(planes=>planes.every(([n,length])=>n.reduce((v,a,k)=>v+a*centers[uid*4+k],0)<=length*r+2e-7)))units.push(uid);
        }
        return subset(resources.surface,units,'radial');
    };
    resources.dispose = () => {
        for(const geometry of subsets.values())geometry.dispose();
        resources.surface.dispose(); resources.original.dispose();
        for (const value of Object.values(resources)) if (value?.isTexture) value.dispose();
    };
    return { metadata, resources };
}
