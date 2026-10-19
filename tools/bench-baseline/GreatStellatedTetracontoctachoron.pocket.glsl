// Generated canonical convex-component BVH. Exact ray/halfspace intervals.
uniform sampler2D uPockets;
const vec4 compoundPlanes[48]=vec4[](vec4(-1,0.,0.,0.),vec4(0.,-1,0.,0.),vec4(0.,0.,-1,0.),vec4(0.,0.,0.,-1),vec4(0.,0.,0.,1),vec4(0.,0.,1,0.),vec4(0.,1,0.,0.),vec4(1,0.,0.,0.),vec4(-0.5,-0.5,-0.5,0.5),vec4(-0.5,-0.5,0.5,-0.5),vec4(-0.5,0.5,-0.5,-0.5),vec4(-0.5,0.5,0.5,0.5),vec4(0.5,-0.5,-0.5,-0.5),vec4(0.5,-0.5,0.5,0.5),vec4(0.5,0.5,-0.5,0.5),vec4(0.5,0.5,0.5,-0.5),vec4(-0.707106781,-0.707106781,0.,0.),vec4(-0.707106781,0.707106781,0.,0.),vec4(0.,0.,-0.707106781,-0.707106781),vec4(0.,0.,-0.707106781,0.707106781),vec4(0.,0.,0.707106781,-0.707106781),vec4(0.,0.,0.707106781,0.707106781),vec4(0.707106781,-0.707106781,0.,0.),vec4(0.707106781,0.707106781,0.,0.),vec4(-0.5,-0.5,-0.5,-0.5),vec4(-0.5,-0.5,0.5,0.5),vec4(-0.5,0.5,-0.5,0.5),vec4(-0.5,0.5,0.5,-0.5),vec4(0.5,-0.5,-0.5,0.5),vec4(0.5,-0.5,0.5,-0.5),vec4(0.5,0.5,-0.5,-0.5),vec4(0.5,0.5,0.5,0.5),vec4(-0.707106781,0.,0.,-0.707106781),vec4(-0.707106781,0.,0.,0.707106781),vec4(0.,-0.707106781,-0.707106781,0.),vec4(0.,-0.707106781,0.707106781,0.),vec4(0.,0.707106781,-0.707106781,0.),vec4(0.,0.707106781,0.707106781,0.),vec4(0.707106781,0.,0.,-0.707106781),vec4(0.707106781,0.,0.,0.707106781),vec4(-0.707106781,0.,-0.707106781,0.),vec4(-0.707106781,0.,0.707106781,0.),vec4(0.,-0.707106781,0.,-0.707106781),vec4(0.,-0.707106781,0.,0.707106781),vec4(0.,0.707106781,0.,-0.707106781),vec4(0.,0.707106781,0.,0.707106781),vec4(0.707106781,0.,-0.707106781,0.),vec4(0.707106781,0.,0.707106781,0.));
const float compoundSupports[48]=float[](0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5);
const vec4 compoundLo[9]=vec4[](vec4(-1.0000002,-0.7071069812,-0.7071069812,-0.7071069812),vec4(-1.0000002,-0.5000002,-0.5000002,-0.5000002),vec4(-1.0000002,-0.5000002,-0.5000002,-0.5000002),vec4(-1.0000002,-0.5000002,-0.5000002,-0.5000002),vec4(-0.7071069812,-0.7071069812,-0.7071069812,-0.7071069812),vec4(-0.7071069812,-0.2071069812,-0.7071069812,-0.7071069812),vec4(-0.7071069812,-0.7071069812,-0.7071069812,-0.7071069812),vec4(-0.7071069812,-0.7071069812,-0.7071069812,-0.2071069812),vec4(-0.7071069812,-0.7071069812,-0.2071069812,-0.7071069812));
const vec4 compoundHi[9]=vec4[](vec4(-0.4999998,0.7071069812,0.7071069812,0.7071069812),vec4(-0.4999998,0.5000002,0.5000002,0.5000002),vec4(-0.4999998,0.5000002,0.5000002,0.5000002),vec4(-0.4999998,0.5000002,0.5000002,0.5000002),vec4(-0.4999998,0.7071069812,0.7071069812,0.7071069812),vec4(-0.4999998,0.2071069812,0.7071069812,0.7071069812),vec4(-0.4999998,0.7071069812,0.7071069812,0.7071069812),vec4(-0.4999998,0.7071069812,0.7071069812,0.2071069812),vec4(-0.4999998,0.7071069812,0.2071069812,0.7071069812));
const int compoundEnd[9]=int[](9,4,3,4,9,6,9,8,9);
const int compoundPart[9]=int[](-1,-1,1,3,-1,2,-1,4,5);

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
for(int step=0;step<9;step++) {
  if(node>=9)break;
  if(!CompoundBox(p,ray,compoundLo[node],compoundHi[node],limit)){node=compoundEnd[node];continue;}
  int co=compoundPart[node];node++;
  if(co<0)continue;
  float enter=0.,exit=limit;bool hit=true;
  for(int j=0;j<8;j++) {
   int idx=co*8+j;vec4 n=compoundPlanes[idx];
   float distance=compoundSupports[idx]-dot(n,p),speed=dot(n,ray);
   if(abs(speed)<1e-9){if(distance< -2e-7){hit=false;break;}}
   else {float t=distance/speed;if(speed>0.)exit=min(exit,t);else enter=max(enter,t);}
   if(exit<enter){hit=false;break;}
  }
  if(hit&&exit>max(enter,2e-6))return true;
 }
 return false;
}
