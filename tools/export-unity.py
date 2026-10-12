"""Export existing star geometry without opening Unity or regenerating its Assets.

Requires numpy, not scipy. Output is deterministic little-endian geometry,
gzip-compressed for GitHub Pages. The page has no Python/Unity dependency.
"""
from pathlib import Path
import argparse, colorsys, gzip, hashlib, json, struct
import numpy as np

FOUR = ['Sishi','Gohi','Gishi','Fix','Gahi','Gashi','Gaghi','Gofix','Gogishi','Gax']
THREE = ['SmallStellatedDodecahedron','GreatDodecahedron','GreatStellatedDodecahedron','GreatIcosahedron']

def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write_json(p, value):
    p.write_text(json.dumps(value, ensure_ascii=False, separators=(',',':'))+'\n', encoding='utf-8')
def gz(p, data):
    with p.open('wb') as f:
        with gzip.GzipFile(filename='',fileobj=f,mode='wb',mtime=0,compresslevel=9) as z: z.write(data)
def embed(p):
    p=np.asarray(p).reshape(-1,3)
    return np.column_stack((p[:,:2],np.zeros(len(p)),p[:,2]))
def lists(sizes, indices):
    start=0; out=[]
    for size in sizes:out.append(indices[start:start+size]);start+=size
    return out
def color(cell): return [*colorsys.hsv_to_rgb((cell*.61803399)%1,.55,.95),1]

class Mesh:
    def __init__(self): self.points=[];self.normals=[];self.units=[];self.indices=[];self.count=0
    def polygon(self,p,unit,center,cap,basis,four):
        p=np.asarray(p); fc=p.mean(0); start=self.count
        e1=p[1]-p[0];e2=p[2]-p[0]
        n=np.cross(basis@e1,basis@e2); norm=np.linalg.norm(n)
        if norm<1e-9: n=np.array([0,0,1.]);norm=1.
        n=np.round(n/norm*127).clip(-127,127).astype('i1')
        ring=np.empty((len(p)*2,4));ring[::2]=p;ring[1::2]=fc+(p-fc)*.83
        indices=[]
        for j in range(len(p)):
            a=2*j;b=2*((j+1)%len(p));indices.extend([a,a+1,b+1,a,b+1,b])
        idx=np.array(indices,dtype='<u4').reshape(-1,3)
        a,b,c=ring[idx[0]]
        if four: flip=np.linalg.det(np.column_stack((b-a,c-a,(a+b+c)/3-center,cap)))>1e-13
        else:
            xyz=ring[:,[0,1,3]]
            flip=np.dot(np.cross(xyz[idx[0,1]]-xyz[idx[0,0]],xyz[idx[0,2]]-xyz[idx[0,0]]),cap[[0,1,3]])<0
        if flip:idx[:,[1,2]]=idx[:,[2,1]]
        self.points.append(ring.astype('<f4'));self.normals.append(np.tile(np.r_[n,0],(len(ring),1)))
        self.units.append(np.full(len(ring),unit,dtype='<u4'));self.indices.append((idx+start).flatten());self.count+=len(ring)
    def save(self,p,per_cell):
        points=np.concatenate(self.points); normals=np.concatenate(self.normals);units=np.concatenate(self.units);indices=np.concatenate(self.indices).astype('<u4')
        # Unity treats clockwise screen winding as front-facing. WebGL uses
        # counterclockwise; projected Z is also inverted for the Three camera.
        # Reverse once after the intrinsic outward-winding alignment above.
        web_triangles=indices.reshape(-1,3)
        web_triangles[:,[1,2]]=web_triangles[:,[2,1]]
        assert len(points)==len(normals)==len(units) and indices.max()<len(points) and np.isfinite(points).all()
        raw=b'STG1'+struct.pack('<III',len(points),len(indices),per_cell)+points.tobytes()+normals.tobytes()+units.tobytes()+indices.tobytes()
        gz(p,raw)
        return {'vertices':len(points),'triangles':len(indices)//3,'compressedBytes':p.stat().st_size,'sha256':hashlib.sha256(raw).hexdigest()}

def export(unity,out):
    out.mkdir(parents=True,exist_ok=True)
    source=unity/'Assets/HachigayoLab/NonconvexPolytopes/Data'
    gallery=unity/'Assets/HachigayoLab/RegularStarPolytopesGallery/Data'
    symbols={s['name']:s['symbol'] for s in read(gallery/'schlafli-tutorial.json')['symbols']}
    catalog=[]
    for name in THREE+FOUR:
        four=name in FOUR;dimension=4 if four else 3
        definition=read(gallery/(name+('.original' if four else '')+'.json'))
        sections=read(gallery/(name+'.sections.json'))
        metadata={'id':name,'dimension':dimension,'title':sections['title'],'symbol':symbols[name],
            'source':definition['source'] if four else 'https://polytope.miraheze.org/wiki/'+''.join(('_'+c.lower()) if c.isupper() and i else c for i,c in enumerate(name)),
            'originalCell':sections['originalCell'],'explosionMax':sections['explosionMax'],
            'groups':[{'label':g['label'],'units':g['units']} for g in sections['groups']],
            'sectorSizes':sections['sectorSizes'],'sectorPlanes':sections['sectorPlanes']}
        mesh=Mesh();original=Mesh()
        if four:
            exterior=read(source/(name+'.exterior.json'))
            frames=np.array(exterior['cellFrames']).reshape(-1,7,4)
            per_cell=exterior.get('unitsPerCell',20)
            centers=[]
            for uid,u in enumerate(exterior['units']):
                p=np.array(u['vertices']).reshape(-1,4);center=p.mean(0);centers.append(center)
                p=center+(p-center)*.88
                faces=lists(u['faceSizes'],u['faceIndices']) if 'faceSizes' in u else [[0,1,2],[0,3,1],[1,3,2],[2,3,0]]
                cell=u['cell'];assert cell==uid//per_cell,'Units must be packed in cell order'
                basis=frames[cell,:3];cap=frames[cell,3]
                for face in faces:mesh.polygon(p[face],uid,center,cap,basis,True)
            pockets=read(source/(name+'.pockets.json'))
            texels=np.array(pockets['texels'],dtype='<f4');gz(out/(name+'.pockets.bin.gz'),texels.tobytes())
            metadata['pocketTexels']=len(texels)//4
            metadata['unitsPerCell']=per_cell;metadata['unitCount']=len(centers);metadata['cellCount']=len(frames)
            gz(out/(name+'.frames.bin.gz'),frames.astype('<f4').tobytes())
        else:
            caps=np.array(definition['caps']).reshape(-1,4)
            frames=np.zeros((len(caps),7,4));frames[:,0,0]=1;frames[:,1,1]=1;frames[:,2,3]=1
            frames[:,3]=embed(caps[:,:3]);frames[:,4]=frames[:,3]*caps[:,3:4]
            frames[:,5]=frames[:,6]=np.array([color(i) for i in range(len(caps))])
            centers=[]
            for uid,u in enumerate(definition['patches']):
                p=embed(u['vertices']);center=p.mean(0);centers.append(center);p=center+(p-center)*.94
                cell=u['cell'];mesh.polygon(p,uid,frames[cell,4],frames[cell,3],frames[cell,:3],False)
            metadata['blockSizes']=definition['blockSizes'];metadata['blockPlanes']=definition['blockPlanes']
            metadata['unitsPerCell']=0;metadata['unitCount']=len(centers);metadata['cellCount']=len(frames)
            metadata['unitCells']=[u['cell'] for u in definition['patches']]
            gz(out/(name+'.frames.bin.gz'),frames.astype('<f4').tobytes())
        gz(out/(name+'.centers.bin.gz'),np.asarray(centers,dtype='<f4').tobytes())
        metadata['full']=mesh.save(out/(name+'.surface.bin.gz'),metadata['unitsPerCell'])
        points=np.array(definition['vertices']).reshape(-1,dimension)
        if not four:points=embed(points)
        faces=lists(definition['faceSizes'],definition['faceIndices'])
        cells=lists(definition['cellSizes'],definition['cellIndices']) if four else [[i] for i in range(len(faces))]
        for cell,face_ids in enumerate(cells):
            ids=sorted(set(i for f in face_ids for i in faces[f]));center=points[ids].mean(0)
            for f in face_ids:
                p=center+(points[faces[f]]-center)*.94
                original.polygon(p,cell,center,frames[cell,3],frames[cell,:3],four)
        metadata['original']=original.save(out/(name+'.original.bin.gz'),1)
        write_json(out/(name+'.json'),metadata)
        catalog.append({k:metadata[k] for k in ('id','dimension','title','symbol','source','unitCount','cellCount','full','original')})
        print(name,metadata['full'],flush=True)
    write_json(out/'catalog.json',{'schema':1,'models':catalog,'coordinateConvention':'3D embedded as (x,y,0,z); 4D normalized to unit radius'})
    # Keep renderer metadata and adopted shader variants together on regeneration.
    import importlib.util
    spec=importlib.util.spec_from_file_location('optimized',Path(__file__).with_name('port-optimized-shaders.py'))
    optimized=importlib.util.module_from_spec(spec);spec.loader.exec_module(optimized);optimized.generate(unity,out)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--unity',type=Path,required=True);parser.add_argument('--out',type=Path,default=Path(__file__).resolve().parents[1]/'data')
    args=parser.parse_args();export(args.unity.resolve(),args.out.resolve())
