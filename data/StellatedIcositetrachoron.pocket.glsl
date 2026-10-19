// Convex L1 minimum: endpoints and four coordinate zero crossings.
bool CompoundL1(vec4 p,vec4 back,float sine) {
 vec4 ray=-(back+sine*p);bool hit=false;
 for(int j=0;j<4;j++) {
  if(abs(ray[j])<1e-9)continue;
  float t=max(2e-6,-p[j]/ray[j]);
  hit=hit||dot(abs(p+t*ray),vec4(1))<.9999998;
 }
 return hit;
}
bool CompoundOccludedPrepared(vec4 p,vec4 back,float sine,int seed) {
vec4 ray=-(back+sine*p),low=vec4(-0.5000002,-0.5000002,-0.5000002,-0.5000002),high=vec4(2e-07,2e-07,2e-07,2e-07);float enter=0.0,exit=sine>1e-7?1.0/sine:1e20;
for(int a=0;a<4;a++) {
 if(abs(ray[a])<1e-9){if(p[a]<low[a]||p[a]>high[a])return false;}
 else {float x=(low[a]-p[a])/ray[a],y=(high[a]-p[a])/ray[a];enter=max(enter,min(x,y));exit=min(exit,max(x,y));}
 if(exit<enter)return false;
}
vec4 pLocal=vec4(dot(vec4(-0.5,-0.5,-0.5,-0.5),p),dot(vec4(0.5,0.5,-0.5,-0.5),p),dot(vec4(0.5,-0.5,0.5,-0.5),p),dot(vec4(0.5,-0.5,-0.5,0.5),p));
vec4 backLocal=vec4(dot(vec4(-0.5,-0.5,-0.5,-0.5),back),dot(vec4(0.5,0.5,-0.5,-0.5),back),dot(vec4(0.5,-0.5,0.5,-0.5),back),dot(vec4(0.5,-0.5,-0.5,0.5),back));
return CompoundL1(pLocal,backLocal,sine);
}
uniform sampler2D uPockets;
bool HullPocketOccludedEntry(vec4 source,vec4 back,float sine,int entry) {
 vec4 a=texelFetch(uPockets,address(entry*5),0),b=texelFetch(uPockets,address(entry*5+1),0);
 vec4 c=texelFetch(uPockets,address(entry*5+2),0),d=texelFetch(uPockets,address(entry*5+3),0);
 vec4 p=vec4(dot(a,source),dot(b,source),dot(c,source),dot(d,source));
 vec4 eye=vec4(dot(a,back),dot(b,back),dot(c,back),dot(d,back));
 int seed=int(round(texelFetch(uPockets,address(entry*5+4),0).x));
 return CompoundOccludedPrepared(p,eye,sine,seed);
}
