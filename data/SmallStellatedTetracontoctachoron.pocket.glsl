// Certified chamber CSG: no original cells, component loops or BVH.
const vec4 CompoundWalls[4]=vec4[](vec4(0.0,0.7071067812,-0.7071067812,0.0),vec4(0.0,0.0,0.7071067812,-0.7071067812),vec4(0.0,0.0,0.0,1),vec4(0.5,-0.5,-0.5,-0.5));
const vec4 CompoundMaterial[2]=vec4[](vec4(1,1,1,1),vec4(1.414213562,0.0,1.414213562,0.0));
bool CompoundOccludedPrepared(vec4 p,vec4 back,float sine,int seed) {
 vec4 ray=-(back+sine*p);
 float speed2=dot(ray,ray),pd=dot(p,ray);
 float limit=(-pd+sqrt(max(0.0,pd*pd+speed2*(1.0-dot(p,p)))))/speed2;
 if(sine>1e-7)limit=min(limit,1.0/sine);
 float cursor=2e-6;
  for(int step=0;step<64;step++) {
  if(cursor>=limit)return false;
  float end=limit;int wall=-1;
  vec4 current=p+cursor*ray;
  {float speed=dot(CompoundWalls[0],ray);if(speed< -1e-9){float t=cursor+max(0.0,dot(CompoundWalls[0],current))/(-speed);if(t<end){end=t;wall=0;}}}
  {float speed=dot(CompoundWalls[1],ray);if(speed< -1e-9){float t=cursor+max(0.0,dot(CompoundWalls[1],current))/(-speed);if(t<end){end=t;wall=1;}}}
  {float speed=dot(CompoundWalls[2],ray);if(speed< -1e-9){float t=cursor+max(0.0,dot(CompoundWalls[2],current))/(-speed);if(t<end){end=t;wall=2;}}}
  {float speed=dot(CompoundWalls[3],ray);if(speed< -1e-9){float t=cursor+max(0.0,dot(CompoundWalls[3],current))/(-speed);if(t<end){end=t;wall=3;}}}
  if(step>0||seed!=0) {
   float num=1.0-dot(CompoundMaterial[0],p),den=dot(CompoundMaterial[0],ray);
   float lo=cursor,hi=end;
   if(abs(den)<1e-9){if(num< -2e-7)hi=-1.0;}
   else if(den>0.0)hi=min(hi,num/den);else lo=max(lo,num/den);
   if(hi>lo+2e-7)return true;
  }
  if(step>0||seed!=1) {
   float num=1.0-dot(CompoundMaterial[1],p),den=dot(CompoundMaterial[1],ray);
   float lo=cursor,hi=end;
   if(abs(den)<1e-9){if(num< -2e-7)hi=-1.0;}
   else if(den>0.0)hi=min(hi,num/den);else lo=max(lo,num/den);
   if(hi>lo+2e-7)return true;
  }
  if(wall<0)return false;
  vec4 n=CompoundWalls[wall];p-=2.0*dot(n,p)*n;ray-=2.0*dot(n,ray)*n;
  cursor=end;
 }
 return false;
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
