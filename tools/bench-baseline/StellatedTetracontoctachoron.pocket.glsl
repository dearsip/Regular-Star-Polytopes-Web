// Generated canonical convex-component BVH. Exact ray/halfspace intervals.
uniform sampler2D uPockets;
const vec4 compoundPlanes[48]=vec4[](vec4(-0.707106781,-0.707106781,0.,0.),vec4(-0.707106781,0.,-0.707106781,0.),vec4(-0.707106781,0.,0.,-0.707106781),vec4(-0.707106781,0.,0.,0.707106781),vec4(-0.707106781,0.,0.707106781,0.),vec4(-0.707106781,0.707106781,0.,0.),vec4(0.,-0.707106781,-0.707106781,0.),vec4(0.,-0.707106781,0.,-0.707106781),vec4(0.,-0.707106781,0.,0.707106781),vec4(0.,-0.707106781,0.707106781,0.),vec4(0.,0.,-0.707106781,-0.707106781),vec4(0.,0.,-0.707106781,0.707106781),vec4(0.,0.,0.707106781,-0.707106781),vec4(0.,0.,0.707106781,0.707106781),vec4(0.,0.707106781,-0.707106781,0.),vec4(0.,0.707106781,0.,-0.707106781),vec4(0.,0.707106781,0.,0.707106781),vec4(0.,0.707106781,0.707106781,0.),vec4(0.707106781,-0.707106781,0.,0.),vec4(0.707106781,0.,-0.707106781,0.),vec4(0.707106781,0.,0.,-0.707106781),vec4(0.707106781,0.,0.,0.707106781),vec4(0.707106781,0.,0.707106781,0.),vec4(0.707106781,0.707106781,0.,0.),vec4(-1,0.,0.,0.),vec4(-0.5,-0.5,-0.5,-0.5),vec4(-0.5,-0.5,-0.5,0.5),vec4(-0.5,-0.5,0.5,-0.5),vec4(-0.5,-0.5,0.5,0.5),vec4(-0.5,0.5,-0.5,-0.5),vec4(-0.5,0.5,-0.5,0.5),vec4(-0.5,0.5,0.5,-0.5),vec4(-0.5,0.5,0.5,0.5),vec4(0.,-1,0.,0.),vec4(0.,0.,-1,0.),vec4(0.,0.,0.,-1),vec4(0.,0.,0.,1),vec4(0.,0.,1,0.),vec4(0.,1,0.,0.),vec4(0.5,-0.5,-0.5,-0.5),vec4(0.5,-0.5,-0.5,0.5),vec4(0.5,-0.5,0.5,-0.5),vec4(0.5,-0.5,0.5,0.5),vec4(0.5,0.5,-0.5,-0.5),vec4(0.5,0.5,-0.5,0.5),vec4(0.5,0.5,0.5,-0.5),vec4(0.5,0.5,0.5,0.5),vec4(1,0.,0.,0.));
const float compoundSupports[48]=float[](0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781,0.707106781);
const vec4 compoundLo[1]=vec4[](vec4(-0.7071069812,-0.7071069812,-0.4142137624,-0.4142137624));
const vec4 compoundHi[1]=vec4[](vec4(-0.2928930188,-0.2928930188,0.4142137624,0.4142137624));
const int compoundEnd[1]=int[](1);
const int compoundPart[1]=int[](1);

bool CompoundBox(vec4 p,vec4 d,vec4 lo,vec4 hi,float limit) {
 float enter=0.,exit=limit;
 for(int a=0;a<4;a++) {
  if(abs(d[a])<1e-9){if(p[a]<lo[a]||p[a]>hi[a])return false;}
  else {float x=(lo[a]-p[a])/d[a],y=(hi[a]-p[a])/d[a];enter=max(enter,min(x,y));exit=min(exit,max(x,y));}
 }
 return exit>=enter;
}
bool HullPocketOccludedEntry(vec4 source,vec4 back,float sine,int cell) {
 vec4 a=texelFetch(uPockets,address(cell*4),0),b=texelFetch(uPockets,address(cell*4+1),0);
 vec4 c=texelFetch(uPockets,address(cell*4+2),0),e=texelFetch(uPockets,address(cell*4+3),0);
 vec4 p=vec4(dot(a,source),dot(b,source),dot(c,source),dot(e,source));
 vec4 eye=vec4(dot(a,back),dot(b,back),dot(c,back),dot(e,back));
 vec4 ray=-(eye+sine*p);
 float limit=sine>1e-7?1./sine:1e20;
 int node=0;
for(int step=0;step<1;step++) {
  if(node>=1)break;
  if(!CompoundBox(p,ray,compoundLo[node],compoundHi[node],limit)){node=compoundEnd[node];continue;}
  int co=compoundPart[node];node++;
  if(co<0)continue;
  float enter=0.,exit=limit;bool hit=true;
  for(int j=0;j<24;j++) {
   int idx=co*24+j;vec4 n=compoundPlanes[idx];
   float distance=compoundSupports[idx]-dot(n,p),speed=dot(n,ray);
   if(abs(speed)<1e-9){if(distance< -2e-7){hit=false;break;}}
   else {float t=distance/speed;if(speed>0.)exit=min(exit,t);else enter=max(enter,t);}
   if(exit<enter){hit=false;break;}
  }
  if(hit&&exit>max(enter,2e-6))return true;
 }
 return false;
}
