"""Generate WebGL variants using the adopted per-figure optimization settings."""
import argparse,re,json,importlib.util
from pathlib import Path

NAMES=['Fix','Sishi','Gohi','Gishi','Gahi','Gashi','Gaghi','Gofix','Gogishi','Gax']
spec=importlib.util.spec_from_file_location('generic',Path(__file__).with_name('port-pocket-shader.py'))
generic=importlib.util.module_from_spec(spec);spec.loader.exec_module(generic)

def preprocess(source,defines=None,folder=None):
    macros={k:'1' for k in defines or []};stack=[];active=True;out=[]
    def expression(s):
        s=re.sub(r'defined\((\w+)\)',lambda m:str(m[1] in macros),s)
        return bool(eval(s.replace('&&',' and ').replace('||',' or ').replace('!',' not '),{'__builtins__':{}},{}))
    def visit(text):
        nonlocal active
        for line in text.splitlines():
            s=line.strip()
            if s.startswith('#ifndef ') or s.startswith('#ifdef '):
                cond=(s.split()[1] not in macros) if s.startswith('#ifndef') else (s.split()[1] in macros)
                stack.append([active,cond]);active=active and cond
            elif s.startswith('#if '):
                cond=expression(s[4:]);stack.append([active,cond]);active=active and cond
            elif s.startswith('#elif '):
                parent,taken=stack[-1];cond=not taken and expression(s[6:]);stack[-1][1]|=cond;active=parent and cond
            elif s=='#else':
                parent,taken=stack[-1];active=parent and not taken;stack[-1][1]=True
            elif s=='#endif':active=stack.pop()[0]
            elif s.startswith('#define '):
                if active:
                    parts=s.split(maxsplit=2);macros[parts[1]]=parts[2] if len(parts)>2 else '1'
            elif s.startswith('#include '):
                if active and folder:visit((folder/re.search(r'"([^"]+)"',s)[1]).read_text(encoding='utf-8'))
            elif active:
                for key,value in macros.items():
                    if value!='1':line=re.sub(r'\b'+key+r'\b',value,line)
                out.append(line)
    visit(source)
    assert not stack
    return '\n'.join(out)

def translate(text):
    text=re.sub(r'\[\s*(loop|unroll|branch)\s*\]','',text)
    text=re.sub(r'\b(precise|static)\s+','',text)
    for n in (2,3,4):text=re.sub(r'\bfloat'+str(n)+r'\b','vec'+str(n),text)
    text=generic.cast_round(generic.cast_round(text,'int'),'uint')
    text=re.sub(r'\((int|uint)\)([a-zA-Z_]\w*(?:\.[xyzw])?)',r'\1(\2)',text)
    text=re.sub(r'\blayout\b','pocketLayout',text)
    text=re.sub(r'\bactive\b','activeMask',text)
    def array(m):
        kind,name,count,values=m.groups()
        if kind=='float':values=','.join(v+'.0' if re.fullmatch(r'-?\d+',v.strip()) else v for v in values.split(','))
        return f'const {kind} {name}[{count}]={kind}[{count}]({values});'
    text=re.sub(r'const\s+(vec[234]|float)\s+(\w+)\[(\d+)\]\s*=\s*\{([^{}]+)\};',array,text)
    text=text.replace('sampler2D_float _HullPockets;','uniform sampler2D uPockets;').replace('vec4 _HullPockets_TexelSize;','')
    text=text.replace('vec4 _PocketHeader0,_PocketHeader1,_PocketHeader2,_PocketHeader3;','uniform vec4 uPocketHeader0,uPocketHeader1,uPocketHeader2,uPocketHeader3;')
    for i in range(4):text=text.replace('_PocketHeader'+str(i),'uPocketHeader'+str(i))
    if 'vec4 PocketTex(' in text:
        a=text.index('vec4 PocketTex(');b=text.index('\nuint PocketChildren',a)
        text=text[:a]+'vec4 PocketTex(int index) {return texelFetch(uPockets,ivec2(index & 255,index >> 8),0);}\n'+text[b:]
    text=text.replace(',0,0,false,false',',vec4(0),vec4(0),false,false')
    text=re.sub(r'(float\s+\w+\s*=\s*)(-?\d+)(?=[;,])',r'\1\2.0',text)
    text=re.sub(r'\b(num|numerator|lo|hi|nearT|farT|cutLo|cutHi)\s*=\s*0;',r'\1=0.0;',text)
    text=re.sub(r'\b(lo|hi)\s*=\s*(-?\d+)(?=[;,])',r'\1=\2.0',text)
    text=re.sub(r'(v\[[ijk]\])<0\b',r'\1<0.0',text)
    text=text.replace(',0,parallel',',0.0,parallel')
    text=re.sub(r'\b(den|denominator|sine|facing|direction\.w)\s*(<=?|>=?)\s*0\b',r'\1\2 0.0',text)
    text=text.replace('2*epsilon','2.0*epsilon').replace('>1+1e-7','>1.0+1e-7').replace('?1/sine','?1.0/sine')
    text=re.sub(r'\b(rootChildren|cutouts)==0\b',r'\1==0u',text)
    text=re.sub(r'(\(1u<<[jk]\)\))==0\b',r'\1==0u',text)
    text=re.sub(r'(data\.activeMask&[124]u\))!=0\b',r'\1!=0u',text)
    text=re.sub(r'((?:\b\w+\.)+[xyzw])\s*(<=?|>=?)\s*0(?![\w.])',r'\1\2 0.0',text)
    text=text.replace('FixPrepareOne(uint i','FixPrepareOne(int i').replace('if(facing<= 0.0) return 0;','if(facing<= 0.0) return vec3(0);')
    text=text.replace('float _OcclusionEpsilon;','const float _OcclusionEpsilon=0.000002;')
    text=re.sub(r',0,(p|a|q),',r',0.0,\1,',text)
    return text

def generate(unity,out):
    shader=unity/'Assets/HachigayoLab/NonconvexPolytopes/Shaders'
    source=(shader/'HullPocketOcclusion.cginc').read_text(encoding='utf-8')
    out.mkdir(parents=True,exist_ok=True);root=out.parent;(root/'src').mkdir(exist_ok=True)
    fix=translate(preprocess((shader/'FixOcclusion.cginc').read_text(encoding='utf-8'),folder=shader))
    (root/'src/fix-glsl.js').write_text('// Three large-subface clips; generated from FixOcclusion.cginc.\nexport const fixGLSL = /* glsl */`\n'+fix+'\n`;\n',encoding='utf-8')
    for name in NAMES:
        material=unity/'Assets/HachigayoLab/RegularStarPolytopesGallery/Generated'/(name+'Live.mat')
        text=material.read_text(encoding='utf-8');block=text.split('m_ValidKeywords:')[1].split('m_InvalidKeywords:')[0]
        flags=set(re.findall(r'- (POCKET_\w+)',block))
        if name=='Fix':flags={'POCKET_FIX_DIRECT'};glsl='// Fix uses three affine tests computed at vertices.\n'
        else:glsl=translate(preprocess(source,flags,shader))+'\n'
        (out/(name+'.pocket.glsl')).write_text(glsl,encoding='utf-8')
        path=out/(name+'.json');doc=json.loads(path.read_text(encoding='utf-8'))
        doc['shaderDefines']=sorted(flags);doc['shaderFile']=name+'.pocket.glsl';doc['preparedVertex']='POCKET_VERTEX_ENTRY' in flags
        path.write_text(json.dumps(doc,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
        if name=='Fix':
            d=json.loads((unity/'Assets/HachigayoLab/NonconvexPolytopes/Data/Fix.exterior.json').read_text(encoding='utf-8'))
            import numpy as np,gzip
            raw=np.asarray([u['basis'] for u in d['units']],dtype='<f4').tobytes()
            with (out/'Fix.unit-frames.bin.gz').open('wb') as f:
                with gzip.GzipFile(filename='',fileobj=f,mode='wb',mtime=0) as z:z.write(raw)
        print(name,','.join(sorted(flags)),len(glsl),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--unity',type=Path,required=True);p.add_argument('--out',type=Path,default=Path(__file__).resolve().parents[1]/'data');a=p.parse_args();generate(a.unity,a.out)
