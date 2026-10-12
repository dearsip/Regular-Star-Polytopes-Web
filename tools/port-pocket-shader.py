"""Port the complete Unity pocket predicate, keeping the same float tolerances.
Only the canonical CSG traversal is selected; no exterior/subface fallback.
"""
import argparse,re
from pathlib import Path

def preprocess(text):
    defines={'POCKET_MULTI_ENTRY'};stack=[];active=True;out=[]
    def expression(s):
        s=re.sub(r'defined\((\w+)\)',lambda m:str(m[1] in defines),s)
        return bool(eval(s.replace('&&',' and ').replace('||',' or ').replace('!',' not '),{'__builtins__':{}},{}))
    for line in text.splitlines():
        s=line.strip()
        if s.startswith('#ifndef '):
            cond=s.split()[1] not in defines;stack.append([active,cond]);active=active and cond
        elif s.startswith('#if '):
            cond=expression(s[4:]);stack.append([active,cond]);active=active and cond
        elif s.startswith('#elif '):
            parent,taken=stack[-1];cond=not taken and expression(s[6:]);stack[-1][1]|=cond;active=parent and cond
        elif s=='#else':
            parent,taken=stack[-1];active=parent and not taken;stack[-1][1]=True
        elif s=='#endif':active=stack.pop()[0]
        elif s.startswith('#define '):
            if active:defines.add(s.split()[1])
        elif s.startswith('#include '):pass
        elif active:out.append(line)
    assert not stack
    return '\n'.join(out)

def cast_round(s,kind):
    prefix=f'({kind})round(';start=0
    while (i:=s.find(prefix,start))>=0:
        j=i+len(prefix);depth=1;k=j
        while depth:
            if s[k]=='(':depth+=1
            if s[k]==')':depth-=1
            k+=1
        s=s[:i]+f'{kind}(round('+s[j:k]+')'+s[k:];start=k+1
    return s

def port(source):
    text=preprocess(source)
    text=re.sub(r'\[\s*(loop|unroll|branch)\s*\]','',text)
    text=re.sub(r'\bprecise\s+','',text)
    for n in (2,3,4):text=re.sub(r'\bfloat'+str(n)+r'\b','vec'+str(n),text)
    text=cast_round(cast_round(text,'int'),'uint')
    text=text.replace('(uint)index','uint(index)')
    text=re.sub(r'\blayout\b','pocketLayout',text)
    text=text.replace('sampler2D_float _HullPockets;','uniform sampler2D uPockets;')
    text=text.replace('vec4 _HullPockets_TexelSize;','')
    text=text.replace('vec4 _PocketHeader0,_PocketHeader1,_PocketHeader2,_PocketHeader3;',
        'uniform vec4 uPocketHeader0,uPocketHeader1,uPocketHeader2,uPocketHeader3;')
    for i in range(4):text=text.replace('_PocketHeader'+str(i),'uPocketHeader'+str(i))
    a=text.index('vec4 PocketTex(');b=text.index('\nuint PocketChildren',a)
    text=text[:a]+'''vec4 PocketTex(int index) {
  return texelFetch(uPockets,ivec2(index & 255,index >> 8),0);
}
'''+text[b:]
    text=text.replace(',0,0,false,false',',vec4(0),vec4(0),false,false')
    # GLSL ES does not implicitly coerce HLSL integer literals to scalars.
    for before,after in {
        'nearT=0,':'nearT=0.0,', 'numerator=0;':'numerator=0.0;',
        'denominator<0':'denominator<0.0', '2*epsilon':'2.0*epsilon',
        'num=0;':'num=0.0;', 'den<0 ?':'den<0.0 ?',
        'rootChildren==0':'rootChildren==0u', 'cutouts==0':'cutouts==0u',
        '(1u<<j))==0':'(1u<<j))==0u', '(1u<<k))==0':'(1u<<k))==0u',
        '>1+1e-7':'>1.0+1e-7', 'sine>0?1/sine':'sine>0.0?1.0/sine'
    }.items():text=text.replace(before,after)
    return text

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--unity',type=Path,required=True);p.add_argument('--out',type=Path,default=Path(__file__).resolve().parents[1]/'src/pocket-glsl.js');a=p.parse_args()
    src=a.unity/'Assets/HachigayoLab/NonconvexPolytopes/Shaders/HullPocketOcclusion.cginc'
    a.out.parent.mkdir(parents=True,exist_ok=True)
    a.out.write_text('// Generated from HullPocketOcclusion.cginc; see NOTICE.md.\nexport const pocketGLSL = /* glsl */`\n'+port(src.read_text(encoding='utf-8'))+'\n`;\n',encoding='utf-8')
