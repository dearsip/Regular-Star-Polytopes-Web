import * as THREE from 'three';
import { StarControls } from './star-controls.js';
import { fetchJSON, loadModel } from './star-data.js';
import { starVertexShader, polychoronFragmentShader, polyhedronFragmentShader } from './star-shader.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const modes = ['full', 'single', 'radial', 'vertex', 'explosion'];
const number = (key, fallback, min, max) => {
    const n = Number(params.get(key) ?? fallback);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const initial = {
    model: params.get('model') ?? 'Fix', mode: modes.includes(params.get('mode')) ? params.get('mode') : 'full',
    fov: number('fov', 0, -175, 175), filter: number('filter', -90, -90, 90), zoom: number('zoom', 0, -1, 4),
    explosion: number('explosion', 0, 0, 1), group: number('group', 0, 0, 1000),
    stereo: ['off', 'parallel', 'cross'].includes(params.get('stereo')) ? params.get('stereo') : 'off',
    eyeSpacing: number('eyeSpacing', .25, 0, 1)
};
const canvas = $('viewer');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('verify') }); }
catch (error) { $('loading').textContent = 'WebGL 2 を利用できません。WebGL 2 is required.'; throw error; }
renderer.setClearColor(0x10181f);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, .01, 100);
camera.position.z = 7;
const stereoCamera = new THREE.StereoCamera();
stereoCamera.eyeSep = initial.eyeSpacing;
stereoCamera.aspect = 1; // camera.aspect already describes one stereo viewport.
camera.focus = 7;
const start = performance.now() * .001;
const u = {
    uFoV: { value: initial.fov }, uFilter: { value: initial.filter },
    uPose: { value: new THREE.Matrix4() }, uBack: { value: new THREE.Vector4(0, 0, 0, 1) },
    uOcclusion: { value: params.get('occlusion') !== '0' }, uHopfColors: { value: params.get('hopf') !== '0' },
    uExplosion: { value: 0 }, uSelection: { value: 0 },
    uAxis1: { value: new THREE.Vector4(1, 0, 0, 0) }, uAxis2: { value: new THREE.Vector4(0, 1, 0, 0) },
    uAxis3: { value: new THREE.Vector4(0, 0, 1, 0) }, uAxis4: { value: new THREE.Vector4(0, 0, 0, 1) }
};
for (let i = 1; i <= 2; i++) {
    u[`uAutoRot${i}From`] = { value: i === 1 ? new THREE.Vector4(0, 0, 0, -1) : new THREE.Vector4(1, 0, 0, 0) };
    u[`uAutoRot${i}To`] = { value: i === 1 ? new THREE.Vector4(1, 0, 0, 0) : new THREE.Vector4(0, 1, 0, 0) };
    u[`uAutoRot${i}Speed`] = { value: 0 };
    u[`uAutoRot${i}Time`] = { value: start };
}
const controls = new StarControls(canvas, u);
controls.setUseArcball(params.get('arcball') === '1');
controls.inertia = params.get('inertia') !== '0';
let model = null, loadController = null, mode = initial.mode, group = initial.group;
let zoom = initial.zoom, firstLoad = true, meshes = [];
let loading = true, shaderFailed = false;
let needsRender = true;
const gpuContext=renderer.getContext(),gpuTimer=gpuContext.getExtension('EXT_disjoint_timer_query_webgl2');
let gpuQuery=null,gpuSamples=[];
function updateCost() {
    if(!model)return;
    const original=mode==='single'||mode==='explosion';
    const sorted=[...gpuSamples].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)]??0;
    const slow=model.metadata.compound&&(sorted.length>=3?median>8:median>12);
    $('cost').hidden=original||!(model.metadata.full.triangles>=400000||slow);
}
function pollCost() {
    if(!gpuQuery||!gpuContext.getQueryParameter(gpuQuery.query,gpuContext.QUERY_RESULT_AVAILABLE))return;
    if(model?.metadata.id===gpuQuery.model&&mode===gpuQuery.mode&&!gpuContext.getParameter(gpuTimer.GPU_DISJOINT_EXT)) {
        gpuSamples.push(gpuContext.getQueryParameter(gpuQuery.query,gpuContext.QUERY_RESULT)/1e6);
        if(gpuSamples.length>9)gpuSamples.shift();updateCost();
    }
    gpuContext.deleteQuery(gpuQuery.query);gpuQuery=null;
}
// Heavy projections need no GPU work while the view is stationary.
for (const event of ['input', 'change', 'click']) document.addEventListener(event, () => { needsRender = true; });
for (const event of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'webglcontextrestored']) canvas.addEventListener(event, () => { needsRender = true; });

function status(message, kind = '') { $('status').textContent = message; $('status').dataset.kind = kind; }
renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    shaderFailed = true;
    const detail = gl.getShaderInfoLog(vertex) + gl.getShaderInfoLog(fragment);
    status('描画シェーダーのコンパイルに失敗しました。Shader compilation failed.', 'error');
    console.error(detail);
};

function poseNow(now = performance.now() * .001) {
    const axes = [u.uAxis1.value, u.uAxis2.value, u.uAxis3.value, u.uAxis4.value].map(v => v.clone());
    for (let i = 1; i <= 2; i++) {
        const f = u[`uAutoRot${i}From`].value, t = u[`uAutoRot${i}To`].value;
        const angle = u[`uAutoRot${i}Speed`].value * (now - u[`uAutoRot${i}Time`].value);
        const half = f.clone().multiplyScalar(Math.cos(angle)).addScaledVector(t, Math.sin(angle));
        for (const a of axes) { a.addScaledVector(f, -2 * a.dot(f)); a.addScaledVector(half, -2 * a.dot(half)); }
    }
    return new THREE.Matrix4().fromArray(axes.flatMap(a => a.toArray()));
}

function defaults() {
    controls.reset();
    controls.rotatePlaneManual(0, 3, THREE.MathUtils.degToRad(37));
    controls.rotatePlaneManual(1, 3, THREE.MathUtils.degToRad(19));
    if (controls.dimension === 4) {
        controls.rotatePlaneManual(2, 3, THREE.MathUtils.degToRad(-23));
        controls.rotatePlaneManual(0, 2, THREE.MathUtils.degToRad(14));
    }
}

function restorePose() {
    const axes = [1, 2, 3, 4].map(i => params.get(`axis${i}`)?.split(',').map(Number));
    if (axes.every(a => a?.length === 4 && a.every(Number.isFinite))) {
        const v = axes.map(a => new THREE.Vector4(...a));
        const valid = v.every((a, i) => Math.abs(a.lengthSq() - 1) < .001 && v.every((b, j) => i === j || Math.abs(a.dot(b)) < .001));
        const fixedZ = model.metadata.dimension !== 3 || v[2].clone().sub(new THREE.Vector4(0, 0, 1, 0)).length() < .001;
        if (valid && fixedZ) v.forEach((a, i) => u[`uAxis${i + 1}`].value.copy(a));
    }
    for (let i = 1; i <= 2; i++) {
        const from = params.get(`autoRot${i}From`)?.split(',').map(Number);
        const to = params.get(`autoRot${i}To`)?.split(',').map(Number);
        if (from?.length !== 4 || to?.length !== 4 || ![...from, ...to].every(Number.isFinite)) continue;
        const f = new THREE.Vector4(...from), t = new THREE.Vector4(...to);
        if (Math.abs(f.lengthSq() - 1) > .001 || Math.abs(t.lengthSq() - 1) > .001 || Math.abs(f.dot(t)) > .001) continue;
        if (model.metadata.dimension === 3 && (Math.abs(f.z) > 1e-6 || Math.abs(t.z) > 1e-6)) continue;
        u[`uAutoRot${i}From`].value.copy(f); u[`uAutoRot${i}To`].value.copy(t);
        u[`uAutoRot${i}Speed`].value = number(`autoRot${i}Speed`, 0, -10, 10);
        u[`uAutoRot${i}Time`].value = performance.now() * .001;
    }
}

function material(original, backOnly = false) {
    const { metadata: m, resources: r } = model;
    return new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: starVertexShader,
        fragmentShader: m.dimension === 4 ? polychoronFragmentShader(r.pocketShader) : polyhedronFragmentShader,
        defines: Object.fromEntries([...(m.shaderDefines??[]),...(m.preparedVertex?['POCKET_PREPARED_VERTEX']:[])].map(key=>[key,1])),
        side: THREE.DoubleSide,
        uniforms: {
            ...u,
            uFrames: { value: r.frames }, uCenters: { value: r.centers }, uUnitCells: { value: r.unitCells },
            uPockets: { value: r.pockets }, uPerCell: { value: m.unitsPerCell },
            uFixFrames: { value: r.fixFrames },
            uPocketHeader0: { value: r.headers[0] }, uPocketHeader1: { value: r.headers[1] },
            uPocketHeader2: { value: r.headers[2] }, uPocketHeader3: { value: r.headers[3] },
            uBlocks: { value: r.blocks }, uBlockCount: { value: m.blockSizes?.length ?? 0 },
            uOriginal: { value: original }, uCullCells: { value: !original || mode === 'explosion' },
            uBackOnly: { value: backOnly }, uOnlyCell: { value: original && mode !== 'explosion' ? m.originalCell : -1 },
            uSelectionUnits: { value: r.selection }, uRegions: { value: r.regions }, uRegionCount: { value: m.sectorSizes.length }
        }
    });
}

function applyMode() {
    if (!model) return;
    needsRender = true;
    for (const mesh of meshes) { scene.remove(mesh); mesh.material.dispose(); }
    meshes = [];
    const original = mode === 'single' || mode === 'explosion';
    const geometry=mode==='single'?model.resources.singleCell():original?model.resources.original:mode==='radial'?model.resources.radialSurface():model.resources.surface;
    const mesh = new THREE.Mesh(geometry, material(original));
    mesh.frustumCulled = false; scene.add(mesh); meshes.push(mesh);
    if (mode === 'radial') {
        const overlay = new THREE.Mesh(model.resources.singleCell(), material(true, true));
        overlay.frustumCulled = false; scene.add(overlay); meshes.push(overlay);
    }
    u.uSelection.value = mode === 'radial' ? 1 : 0;
    u.uExplosion.value = mode === 'explosion' ? Number($('explosion').value) * model.metadata.explosionMax : 0;
    $('groupControl').hidden = mode !== 'vertex';
    $('explosionControl').hidden = mode !== 'explosion';
    $('occlusion').disabled = original;
    gpuSamples=[];updateCost();
    $('modeNote').hidden=mode!=='explosion'||!model.metadata.explosionContact?.coincidentCentersWithCell0?.length;
    for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    updateGroup(); updateLabels();
}

function updateGroup() {
    if (!model) return;
    const { metadata: m, resources: r } = model;
    group = Math.max(0, Math.min(m.groups.length - 1, Number($('group').value) || 0));
    const data = r.selection.image.data;
    data.fill(0);
    for (const uid of m.groups[group]?.units ?? []) data[uid * 4] = 1;
    r.selection.needsUpdate = true;
    if(mode==='vertex'&&meshes[0])meshes[0].geometry=r.vertexNeighborhood(group);
}

async function choose(id) {
    loadController?.abort(); loadController = new AbortController();
    const signal = loadController.signal;
    loading = true; $('loading').hidden = false; $('loading').textContent = 'Loading…';
    status('読み込み中 / Loading…');
    try {
        const next = await loadModel(id, signal);
        if (signal.aborted) { next.resources.dispose(); return; }
        for (const mesh of meshes) { scene.remove(mesh); mesh.material.dispose(); }
        meshes = []; model?.resources.dispose(); model = next; shaderFailed=false;
        const m = model.metadata;
        for(const button of document.querySelectorAll('[data-mode]')) button.hidden=false;
        controls.dimension = m.dimension; defaults();
        if (firstLoad) { restorePose(); firstLoad = false; }
        $('title').textContent = m.title; $('symbol').textContent = m.symbol;
        $('dimension').textContent = m.dimension === 4 ? '4D → 3D' : '3D → 2D';
        $('wiki').href = m.source;
        $('filterControl').hidden = m.dimension !== 4;
        $('hopfControl').hidden = m.dimension !== 4 || !!m.compound;
        $('group').replaceChildren(...m.groups.map((g, i) => new Option(g.label, String(i))));
        $('group').value = String(Math.max(0, Math.min(m.groups.length - 1, group)));
        document.querySelector('[data-mode="single"]').textContent = m.dimension === 4 ? 'Single cell' : 'Single face';
        document.querySelector('[data-mode="radial"]').textContent = m.dimension === 4 ? 'Single cell + radial exterior' : 'Single face + radial exterior';
        $('help').innerHTML = m.dimension === 4 ? '左ドラッグ：3D回転。右ドラッグ・2本指：4D回転。<br>Left drag: 3D spin. Right drag / two fingers: 4D rotation.' : 'ドラッグ・2本指：3D回転（Z軸は固定）。<br>Drag / two fingers: rotate in 3D; the unused Z axis stays fixed.';
        if (m.dimension === 3) u.uFilter.value = -90;
        else u.uFilter.value = Number($('filter').value);
        applyMode();
        loading = false; $('loading').hidden = true;
        status(`${m.unitCount.toLocaleString()} surface patches · ${m.cellCount} ${m.dimension === 4 ? 'cells' : 'faces'}`);
        document.title = `${m.title} — Regular Star Polytopes`;
    } catch (error) {
        if (signal.aborted) return;
        loading = false; $('loading').textContent = '読み込みに失敗しました / Loading failed';
        status(error.message, 'error'); console.error(error);
    }
}

function updateLabels() {
    $('fovValue').textContent = Math.abs(u.uFoV.value) < .05 ? 'Orthographic' : `${u.uFoV.value.toFixed(1)}°`;
    $('filterValue').textContent = `${u.uFilter.value.toFixed(1)}°`;
    $('zoomValue').textContent = zoom.toFixed(2);
    $('explosionValue').textContent = `${Math.round(Number($('explosion').value) * 100)}%`;
    $('eyeSpacingValue').textContent = stereoCamera.eyeSep.toFixed(3);
}

for (const [id, key] of [['fov', 'uFoV'], ['filter', 'uFilter']]) {
    $(id).value = u[key].value;
    $(id).addEventListener('input', () => { u[key].value = Number($(id).value); updateLabels(); });
}
$('zoom').value = zoom;
$('zoom').addEventListener('input', () => { zoom = Number($('zoom').value); updateLabels(); });
$('explosion').value = initial.explosion;
$('explosion').addEventListener('input', () => {
    if (model) u.uExplosion.value = Number($('explosion').value) * model.metadata.explosionMax;
    updateLabels();
});
$('stereo').value = initial.stereo;
$('eyeSpacingControl').hidden = initial.stereo === 'off';
$('stereo').addEventListener('change', () => { $('eyeSpacingControl').hidden = $('stereo').value === 'off'; });
$('eyeSpacing').value = initial.eyeSpacing;
$('eyeSpacing').addEventListener('input', () => {
    stereoCamera.eyeSep = Number($('eyeSpacing').value);
    updateLabels();
});
$('resolution').value = String(number('resolution', 1, .5, 1.5));
if (!$('resolution').value) $('resolution').value = '1';
for (const [id, key] of [['occlusion', 'uOcclusion'], ['hopf', 'uHopfColors']]) {
    $(id).checked = u[key].value;
    $(id).addEventListener('change', () => u[key].value = $(id).checked);
}
$('arcball').checked = controls.useArcball;
$('arcball').addEventListener('change', () => controls.setUseArcball($('arcball').checked));
$('inertia').checked = controls.inertia;
$('inertia').addEventListener('change', () => { controls.inertia = $('inertia').checked; if (!controls.inertia) pause(); });
$('model').addEventListener('change', () => choose($('model').value));
$('group').addEventListener('change', updateGroup);
for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => { mode = button.dataset.mode; applyMode(); });
$('reset').addEventListener('click', defaults);
function pause() { controls.commitAutoRotation(1); controls.stopAutoRotation(); }
$('pause').addEventListener('click', pause);
let panelClosed = params.get('panel') === 'hide' || (!params.has('panel') && window.innerWidth <= 700);
function panel() { document.querySelector('.app').classList.toggle('closed', panelClosed); $('togglePanel').setAttribute('aria-expanded', String(!panelClosed)); }
panel();
$('togglePanel').addEventListener('click', () => { panelClosed = !panelClosed; panel(); });
canvas.addEventListener('wheel', event => { zoom = THREE.MathUtils.clamp(zoom - event.deltaY * .002, -1, 4); $('zoom').value = zoom; updateLabels(); }, { passive: false });

$('share').addEventListener('click', async () => {
    if (!model) return;
    const next = new URLSearchParams({ model: model.metadata.id, mode, group: String(group),
        fov: String(u.uFoV.value), filter: String(u.uFilter.value), zoom: String(zoom), stereo: $('stereo').value,
        eyeSpacing: String(stereoCamera.eyeSep),
        resolution: $('resolution').value, explosion: $('explosion').value, panel: panelClosed ? 'hide' : 'show' });
    for (const id of ['occlusion', 'hopf', 'arcball', 'inertia']) next.set(id, $(id).checked ? '1' : '0');
    const sharedTime=performance.now()*.001;
    const pose = poseNow(sharedTime).elements;
    for (let i = 1; i <= 4; i++) next.set(`axis${i}`, pose.slice((i - 1) * 4, i * 4).join(','));
    for (let i = 1; i <= 2; i++) {
        for (const key of ['From', 'To']) {
            const v=u[`uAutoRot${i}${key}`].value.clone();
            // Restarting both clocks at the current pose conjugates channel 1
            // by the already accumulated channel-2 rotation.
            if(i===1){
                const f=u.uAutoRot2From.value,t=u.uAutoRot2To.value;
                const angle=u.uAutoRot2Speed.value*(sharedTime-u.uAutoRot2Time.value);
                const half=f.clone().multiplyScalar(Math.cos(angle)).addScaledVector(t,Math.sin(angle));
                v.addScaledVector(f,-2*v.dot(f));v.addScaledVector(half,-2*v.dot(half));
            }
            next.set(`autoRot${i}${key}`,v.toArray().join(','));
        }
        next.set(`autoRot${i}Speed`, String(u[`uAutoRot${i}Speed`].value));
    }
    history.replaceState(null, '', `${location.pathname}?${next}`);
    try { await navigator.clipboard.writeText(location.href); status('表示URLをコピーしました / View URL copied.'); }
    catch { status(location.href); }
});

function render() {
    pollCost();
    const rect = canvas.parentElement.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width)), height = Math.max(1, Math.floor(rect.height));
    const ratio = Math.min(window.devicePixelRatio, 1.5) * Number($('resolution').value);
    const resized=renderer.getPixelRatio() !== ratio || canvas.width !== Math.floor(width*ratio) || canvas.height !== Math.floor(height*ratio);
    const moving=Math.abs(u.uAutoRot1Speed.value)>1e-7 || Math.abs(u.uAutoRot2Speed.value)>1e-7;
    if(!needsRender&&!resized&&!moving)return;
    needsRender=false;
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) renderer.setSize(width, height, false);
    u.uPose.value.copy(poseNow());
    u.uBack.value.set(0, 0, 0, 1).applyMatrix4(u.uPose.value.clone().transpose());
    const stereo = $('stereo').value;
    const viewWidth = stereo === 'off' ? width : Math.floor(width / 2);
    const base = THREE.MathUtils.degToRad(38 * Math.pow(2, -zoom));
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(base * .5) * Math.max(1, height / viewWidth)));
    camera.aspect = viewWidth / height; camera.updateProjectionMatrix();
    // A shared URL may start in stereo before any mono render updates the pose.
    camera.updateMatrixWorld(true);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, width, height); renderer.clear();
    const query=gpuTimer&&model?.metadata.compound&&!gpuQuery?gpuContext.createQuery():null;
    if(query)gpuContext.beginQuery(gpuTimer.TIME_ELAPSED_EXT,query);
    if (stereo === 'off') renderer.render(scene, camera);
    else {
        stereoCamera.update(camera);
        renderer.setScissorTest(true);
        const left = stereo === 'cross' ? stereoCamera.cameraR : stereoCamera.cameraL;
        const right = stereo === 'cross' ? stereoCamera.cameraL : stereoCamera.cameraR;
        renderer.setViewport(0, 0, viewWidth, height); renderer.setScissor(0, 0, viewWidth, height); renderer.render(scene, left);
        renderer.setViewport(viewWidth, 0, width - viewWidth, height); renderer.setScissor(viewWidth, 0, width - viewWidth, height); renderer.render(scene, right);
        renderer.setScissorTest(false);
    }
    if(query){gpuContext.endQuery(gpuTimer.TIME_ELAPSED_EXT);gpuQuery={query,model:model.metadata.id,mode};}
}
renderer.setAnimationLoop(render);
updateLabels();
try {
    const catalog = await fetchJSON(new URL('../data/catalog.json', import.meta.url));
    for (const [dimension,compound,noun] of [[3,false,'regular star polyhedra'],[3,true,'regular compound'],[4,false,'regular star polychora'],[4,true,'regular compounds']]) {
        const models=catalog.models.filter(m=>m.dimension===dimension&&!!m.compound===compound);
        if(!models.length)continue;
        const optionGroup = document.createElement('optgroup');
        optionGroup.label = `${dimension}D → ${dimension-1}D · ${models.length} ${noun}`;
        for (const m of models) optionGroup.append(new Option(`${m.title} ${m.symbol}`, m.id));
        $('model').append(optionGroup);
    }
    $('model').disabled = false;
    $('model').value = catalog.models.some(m => m.id === initial.model) ? initial.model : 'Fix';
    await choose($('model').value);
} catch (error) { status(error.message, 'error'); $('loading').textContent = 'Loading failed'; }

// Small diagnostics surface for browser smoke tests; no scene mutation API.
window.starViewer = {
    get state() { return { model: model?.metadata.id, mode, loading, shaderFailed, dimension: controls.dimension,
        pose: u.uPose.value.elements.slice(), fov: u.uFoV.value, filter: u.uFilter.value, explosion: u.uExplosion.value,
        stereo: $('stereo').value, eyeSpacing: stereoCamera.eyeSep, zoom, cameraWorldZ:camera.matrixWorld.elements[14],
        triangles: renderer.info.render.triangles, gpuGeometries: renderer.info.memory.geometries,
        gpuTextures: renderer.info.memory.textures }; }
};
