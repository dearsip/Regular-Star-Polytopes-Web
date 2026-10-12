import { fixGLSL } from './fix-glsl.js';

const common = /* glsl */`
uniform sampler2D uFrames;
uniform sampler2D uCenters;
uniform sampler2D uUnitCells;
uniform int uPerCell;
uniform bool uOriginal;
uniform bool uCullCells;
uniform bool uBackOnly;
uniform bool uHopfColors;
uniform float uExplosion;
uniform float uFoV;
uniform float uFilter;
uniform int uOnlyCell;
uniform vec4 uBack;
uniform mat4 uPose;
vec4 frame(int cell,int row) { return texelFetch(uFrames,ivec2(row,cell),0); }
ivec2 address(int index) { return ivec2(index & 255,index >> 8); }
`;

export const starVertexShader = /* glsl */`
${common}
uniform sampler2D uPockets;
uniform vec4 uPocketHeader0,uPocketHeader1;
uniform sampler2D uFixFrames;
#ifdef POCKET_FIX_DIRECT
${fixGLSL}
out vec3 vClipSide,vRayDenominator;
flat out uint vActiveClips;
#endif
in vec4 aPosition4;
in vec4 aLightingNormal;
in float aUnit;
in float aEntry;
out vec4 vPosition4;
out vec4 vPreparedP;
flat out vec4 vPreparedBack;
flat out int vEntry;
flat out int vUnit;
flat out int vCell;
flat out int vRear;
out vec3 vColor;
vec4 pocket(int index) { return texelFetch(uPockets,address(index),0); }
void main() {
    int uid=int(aUnit+0.5);
    int cell=uOriginal?uid:(uPerCell>0?uid/uPerCell:int(texelFetch(uUnitCells,address(uid),0).x+0.5));
    vec4 normal4=frame(cell,3);
    vec4 cellCenter=frame(cell,4);
    // The unmargined vertices have unit radius and dot(vertex,center)=|center|².
    // Normalize their expanded radius, matching the original projection shader.
    float scale=inversesqrt(1.0+dot(cellCenter,cellCenter)*uExplosion*(uExplosion+2.0));
    float support=dot(normal4,cellCenter)*(1.0+uExplosion)*scale;
    vec4 p=(aPosition4+cellCenter*uExplosion)*scale;
    vec4 normal=uPose*normal4;
    vec4 transformed=uPose*p;
    float theta=radians(clamp(uFoV,-175.0,175.0))*0.5;
    float sine=sin(theta),cosine=cos(theta);
    float denominator=1.0+sine*transformed.w;
    vec3 projected=transformed.xyz*cosine/denominator;
    projected.z=-projected.z; // Unity's viewing depth to Three.js camera convention.
    gl_Position=projectionMatrix*modelViewMatrix*vec4(projected,1.0);
    // Compose 4D->3D and 3D->screen projective maps in homogeneous coordinates.
    gl_Position*=denominator;
    vec4 sourceCenter=uOriginal?cellCenter:texelFetch(uCenters,address(uid),0);
    vec4 center=uPose*sourceCenter;
    center=(center+uPose*cellCenter*uExplosion)*scale;
    bool back=normal.w+support*sine>=-1e-9*cosine;
    float centerZ=center.z*cosine/(1.0+center.w*sine);
    if ((uCullCells&&back)||(uBackOnly&&!back)||(uOnlyCell>=0&&cell!=uOnlyCell)||centerZ<sin(radians(uFilter))-1e-9)
        gl_Position=vec4(-2,-2,0,1);
    vPosition4=p;vUnit=uid;vCell=cell;vRear=back?1:0;
    vEntry=-1;
    vPreparedP=p;vPreparedBack=uBack;
    if(!uOriginal && uPerCell>0) {
        vEntry=int(round(aEntry));
#if defined(POCKET_FIX_DIRECT)
        vec4 x=texelFetch(uFixFrames,address(uid*4),0),y=texelFetch(uFixFrames,address(uid*4+1),0);
        vec4 z=texelFetch(uFixFrames,address(uid*4+2),0),n=texelFetch(uFixFrames,address(uid*4+3),0);
        vec4 eye=uBack+sine*sourceCenter;
        vec4 local=vec4(dot(x,p-sourceCenter),dot(y,p-sourceCenter),dot(z,p-sourceCenter),0.0);
        vec4 localBack=vec4(dot(x,eye),dot(y,eye),dot(z,eye),dot(n,eye));
        FixClipData clips=FixPrepareClips(local,localBack,sine);
        vClipSide=clips.side;vRayDenominator=clips.rayDenominator;vActiveClips=clips.activeMask;
#elif defined(POCKET_PREPARED_VERTEX)
        if(vEntry>=0) {
            int row=int(round(uPocketHeader1.x))+(vEntry>>5)*int(round(uPocketHeader1.y));
            int matrixOffset=int(round(pocket(row+1).y))+(vEntry & 31)*4;
            vec4 a=pocket(matrixOffset),b=pocket(matrixOffset+1),c=pocket(matrixOffset+2),d=pocket(matrixOffset+3);
            vPreparedP=vec4(dot(a,p),dot(b,p),dot(c,p),dot(d,p));
            vPreparedBack=vec4(dot(a,uBack),dot(b,uBack),dot(c,uBack),dot(d,uBack));
        }
#endif
    }
    vec3 base=frame(cell,uHopfColors?6:5).rgb;
    float diffuse=abs(dot(normalize(aLightingNormal.xyz),normalize(vec3(.4,.8,-.6))));
    vColor=clamp(base*(.66+.30*diffuse)+.04*clamp((diffuse-.75)*4.0,0.0,1.0),0.0,1.0);
    if(uOriginal&&uPerCell==0&&back)vColor*=.24;
}
`;

const inputs = /* glsl */`
in vec4 vPosition4;
in vec4 vPreparedP;
flat in vec4 vPreparedBack;
flat in int vEntry;
flat in int vUnit;
flat in int vCell;
flat in int vRear;
in vec3 vColor;
out vec4 fragColor;
uniform bool uOcclusion;
uniform int uSelection; // 0=full, 1=radial sector, 2=vertex neighborhood
uniform sampler2D uSelectionUnits;
uniform sampler2D uRegions;
uniform int uRegionCount;
bool selected(vec4 p) {
    if(uSelection==2)return texelFetch(uSelectionUnits,address(vUnit),0).x>.5;
    if(uSelection!=1)return true;
    int row=0;
    for(int j=0;j<uRegionCount;j++) {
        int count=int(texelFetch(uRegions,address(row++),0).x);bool inside=true;
        for(int k=0;k<count;k++) {
            if(dot(texelFetch(uRegions,address(row++),0),p)>2e-7)inside=false;
        }
        if(inside)return true;
    }
    return false;
}
`;

const color = `
    bool inward=uOriginal ? (uPerCell>0 && gl_FrontFacing==(vRear==1)) : !gl_FrontFacing;
    fragColor=vec4(inward?vColor*.65:vColor,1);
    // The Unity project renders in linear color space; encode the same lit
    // values for the browser's sRGB output using Three's color-space helper.
    fragColor=linearToOutputTexel(fragColor);
`;
export const polychoronFragmentShader = pocketSource => /* glsl */`
${common}
#ifdef POCKET_FIX_DIRECT
${fixGLSL}
in vec3 vClipSide,vRayDenominator;
flat in uint vActiveClips;
#else
${pocketSource}
#endif
${inputs}
void main() {
    if(!uOriginal&&!selected(vPosition4))discard;
    float sine=sin(radians(clamp(uFoV,-175.0,175.0))*.5);
    if(uOcclusion&&!uOriginal){
#if defined(POCKET_FIX_DIRECT)
        FixClipData clips;clips.side=vClipSide;clips.rayDenominator=vRayDenominator;clips.activeMask=vActiveClips;
        if(FixClipOccluded(clips))discard;
#elif defined(POCKET_PREPARED_VERTEX)
        if(HullPocketOccludedPrepared(vPosition4,uBack,sine,vEntry,vPreparedP,vPreparedBack,vEntry>=0,false))discard;
#else
        if(HullPocketOccludedEntry(vPosition4,uBack,sine,vEntry))discard;
#endif
    }
    ${color}
}
`;

export const polyhedronFragmentShader = /* glsl */`
${common}
${inputs}
uniform sampler2D uBlocks;
uniform int uBlockCount;
void main() {
    if(!uOriginal&&!selected(vPosition4))discard;
    float sine=sin(radians(clamp(uFoV,-175.0,175.0))*.5);
    if(uOcclusion&&!uOriginal) {
        vec3 p=vPosition4.xyw,d=-uBack.xyw-sine*p;
        float epsilon=2e-5/max(length(d),1e-6),maximum=sine>0.0?1.0/sine:1e20;
        int row=0;
        for(int j=0;j<uBlockCount;j++) {
            int count=int(texelFetch(uBlocks,address(row++),0).x);float nearT=epsilon,farT=maximum;
            for(int k=0;k<count;k++) {
                vec4 eq=texelFetch(uBlocks,address(row++),0);
                float num=-eq.w-dot(eq.xyz,p),den=dot(eq.xyz,d);
                if(abs(den)<1e-9) { if(num<-2e-7)farT=-1.0; }
                else if(den>0.0)farT=min(farT,num/den);else nearT=max(nearT,num/den);
            }
            if(farT-nearT>2e-6&&farT>epsilon&&nearT<maximum)discard;
        }
    }
    ${color}
}
`;
