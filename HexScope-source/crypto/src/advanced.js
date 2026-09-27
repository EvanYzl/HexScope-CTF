(function(root){
'use strict';
const M=()=>root.HexMath;
function curve(o){const {number,prime,mod,inv}=M(),p=number(o.p),a=mod(number(o.a),p),b=mod(number(o.b),p);if(p<=3n||p.toString(2).length>1024||!prime(p)||mod(4n*a*a*a+27n*b*b,p)===0n)throw Error('需要非奇异的素数域短 Weierstrass 曲线，p 为 5—1024 位素数');
 const point=v=>{if(v===null)return null;if(!Array.isArray(v)||v.length!==2)throw Error('点需为 [x,y]，无穷远点为 null');const x=number(v[0]),y=number(v[1]);if(x<0n||x>=p||y<0n||y>=p||mod(y*y-x*x*x-a*x-b,p))throw Error('点不在指定曲线上');return [x,y];};
 const eq=(P,Q)=>P===null?Q===null:Q!==null&&P[0]===Q[0]&&P[1]===Q[1];
 const neg=P=>P===null?null:[P[0],mod(-P[1],p)];
 function add(P,Q){if(P===null)return Q;if(Q===null)return P;if(P[0]===Q[0]&&mod(P[1]+Q[1],p)===0n)return null;const slope=mod((eq(P,Q)?3n*P[0]*P[0]+a:Q[1]-P[1])*inv(eq(P,Q)?2n*P[1]:Q[0]-P[0],p),p),x=mod(slope*slope-P[0]-Q[0],p);return [x,mod(slope*(P[0]-x)-P[1],p)];}
 function mul(k,P){if(k<0n)return mul(-k,neg(P));let out=null;while(k){if(k&1n)out=add(out,P);P=add(P,P);k>>=1n;}return out;}
 function log(P,Q,bound,check){if(P===null)throw Error('基点不能是无穷远点');if(bound<1n||bound>10000000000n)throw Error('ECC 搜索范围限 1—10^10');const n=M().rootInt(bound)+1n,baby=new Map(),key=P=>P===null?'O':P.join(',');let R=null;for(let j=0n;j<n;j++){if(j%128n===0n)check();if(!baby.has(key(R)))baby.set(key(R),j);R=add(R,P);}const step=neg(mul(n,P));R=Q;for(let i=0n;i<=n;i++){if(i%128n===0n)check();const j=baby.get(key(R));if(j!==undefined){const k=i*n+j;if(k<bound&&eq(mul(k,P),Q))return k;}R=add(R,step);}throw Error('搜索范围内未找到标量');}
 return {p,a,b,point,eq,neg,add,mul,log};
}
function smart(E,P,Q,check){const {p}=E,{mod,inv}=M();if(!E.eq(E.mul(p,P),null)||!E.eq(E.mul(p,Q),null))throw Error('Smart 攻击要求点的阶为 p；给定点不满足');const n=p*p,reduce=x=>mod(x,n);
 for(let attempt=1n;attempt<=8n;attempt++){
  check();const a=E.a+attempt*p,b=E.b+(attempt+1n)*p;
  const lift=P=>{const [x,y]=P;if(y===0n)throw Error('无法提升 y=0 的点');const error=(x*x*x+a*x+b-y*y)/p;return [x,reduce(y+mod(error*inv(2n*y,p),p)*p),1n];};
  function dbl(P){const [x,y,z]=P;if(!z||!y)return [0n,1n,0n];const yy=reduce(y*y),s=reduce(4n*x*yy),m=reduce(3n*x*x+a*z*z*z*z),xx=reduce(m*m-2n*s);return [xx,reduce(m*(s-xx)-8n*yy*yy),reduce(2n*y*z)];}
  function add(P,Q){if(!P[2])return Q;if(!Q[2])return P;const [x1,y1,z1]=P,[x2,y2,z2]=Q,u1=reduce(x1*z2*z2),u2=reduce(x2*z1*z1),s1=reduce(y1*z2*z2*z2),s2=reduce(y2*z1*z1*z1),h=reduce(u2-u1),r=reduce(s2-s1);if(!h)return !r?dbl(P):[0n,1n,0n];const h2=reduce(h*h),h3=reduce(h*h2),v=reduce(u1*h2),x=reduce(r*r-h3-2n*v);return [x,reduce(r*(v-x)-s1*h3),reduce(h*z1*z2)];}
  function mul(k,P){let R=[0n,1n,0n];while(k){if(k&1n)R=add(R,P);P=dbl(P);k>>=1n;}return R;}
  const PP=mul(p,lift(P)),QQ=mul(p,lift(Q));if(PP[1]%p===0n||QQ[1]%p===0n)continue;const phi=R=>reduce(-R[0]*R[2]*inv(R[1],n));const v=phi(PP),w=phi(QQ);if(v%p||w%p||v===0n)continue;const k=mod(w/p*inv(v/p,p),p);if(E.eq(E.mul(k,P),Q))return k;
 }throw Error('当前 p² 提升未成功；可能不满足异常曲线条件或提升退化');
}
function ecc(o){const E=curve(o),{number,crt,prime,pow,inv,mod}=M(),op=o.operation||'dlog',check=M().deadline(20000),P=E.point(o.P),Q=o.Q===undefined?null:E.point(o.Q);
 if(op==='add')return {point:E.add(P,Q)};if(op==='multiply'||op==='ecdh')return {point:E.mul(number(o.k),P)};
 if(op==='verify'){const n=number(o.order),r=number(o.r),s=number(o.s),z=number(o.z);if(!P||!Q||n<=1n||!E.eq(E.mul(n,P),null)||!E.eq(E.mul(n,Q),null))throw Error('基点/公钥/阶不匹配');if(r<=0n||r>=n||s<=0n||s>=n)return {valid:false};const w=inv(s,n),R=E.add(E.mul(mod(z*w,n),P),E.mul(mod(r*w,n),Q));return {valid:R!==null&&R[0]%n===r};}
 if(P===null||Q===null)throw Error('攻击要求 P、Q 均不是无穷远点');
 let k;
 if(op==='smart')k=smart(E,P,Q,check);
 else if(op==='pohlig'){const n=number(o.order);if(!E.eq(E.mul(n,P),null)||!E.eq(E.mul(n,Q),null))throw Error('所给 order 不消去 P、Q');if(!Array.isArray(o.factors)||o.factors.length>30)throw Error('需提供 order 的素数幂分解 [[prime, exponent], ...]');let product=1n;const pairs=[],seen=new Set();for(const [pv,ev]of o.factors){const l=number(pv),e=root.HexClassical.integer(ev,1,64,'指数');if(!prime(l)||seen.has(String(l)))throw Error('分解需包含不同素数');seen.add(String(l));const q=l**BigInt(e);if(n%q)throw Error('素数幂不能整除 order');product*=q;const G=E.mul(n/q,P),H=E.mul(n/q,Q),gamma=E.mul(l**BigInt(e-1),G);let x=0n,power=1n;for(let j=0;j<e;j++){check();const target=E.mul(l**BigInt(e-1-j),E.add(H,E.neg(E.mul(x,G)))),digit=E.log(gamma,target,l,check);x+=digit*power;power*=l;}pairs.push([x,q]);}if(product!==n)throw Error('本工具要求完整阶分解，部分模数不能宣称完整恢复');k=crt(pairs).value;}
 else if(op==='dlog')k=E.log(P,Q,number(o.bound),check);else throw Error('未知 ECC 操作');
 if(!E.eq(E.mul(k,P),Q))throw Error('ECC 回代校验失败');return M().message(k,{verified:true,operation:op});
}
// Exact rational LLL: no floating-point loss in the lattice calculation.
function fraction(a,b=1n){if(!b)throw Error('分母为零');if(b<0n){a=-a;b=-b;}const g=M().gcd(a,b);return [a/g,b/g];}
const fadd=(a,b)=>fraction(a[0]*b[1]+b[0]*a[1],a[1]*b[1]),fsub=(a,b)=>fraction(a[0]*b[1]-b[0]*a[1],a[1]*b[1]),fmul=(a,b)=>fraction(a[0]*b[0],a[1]*b[1]),fdiv=(a,b)=>fraction(a[0]*b[1],a[1]*b[0]);
function lll(matrix,check=M().deadline(20000)){const B=matrix.map(r=>r.slice()),n=B.length,d=B[0].length;if(n<2||n>12||d<n||d>16||B.some(r=>r.length!==d))throw Error('LLL 需要 2—12 个独立向量、维度不超过 16');
 const dot=(a,b)=>a.reduce((v,x,i)=>fadd(v,fmul(x,b[i])),[0n,1n]);
 function gs(){const star=[],mu=[],norm=[];for(let i=0;i<n;i++){check();star[i]=B[i].map(v=>[v,1n]);mu[i]=[];for(let j=0;j<i;j++){mu[i][j]=fdiv(dot(B[i].map(v=>[v,1n]),star[j]),norm[j]);star[i]=star[i].map((v,k)=>fsub(v,fmul(mu[i][j],star[j][k])));}norm[i]=dot(star[i],star[i]);if(!norm[i][0])throw Error('格基不满秩');}return {mu,norm};}
 let G=gs(),k=1,iterations=0;while(k<n){check();if(++iterations>6000)throw Error('LLL 达到迭代上限');for(let j=k-1;j>=0;j--){const [a,b]=G.mu[k][j],r=a<0n?-((-a+b/2n)/b):(a+b/2n)/b;if(r){B[k]=B[k].map((v,i)=>v-r*B[j][i]);G=gs();}}
 const right=fmul(fsub([3n,4n],fmul(G.mu[k][k-1],G.mu[k][k-1])),G.norm[k-1]);if(G.norm[k][0]*right[1]>=right[0]*G.norm[k][1])k++;else{[B[k],B[k-1]]=[B[k-1],B[k]];G=gs();k=Math.max(k-1,1);}}
 return B;
}
function trim(p){while(p.length>1&&p.at(-1)===0n)p.pop();return p;}
function multiply(a,b){const r=new Array(a.length+b.length-1).fill(0n);for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)r[i+j]+=a[i]*b[j];return r;}
function polyGcd(a,b){const norm=p=>{trim(p);const g=p.reduce((g,v)=>M().gcd(g,v),0n);if(g)return p.map(v=>v/g*(p.at(-1)<0n?-1n:1n));return [0n];};a=norm(a);b=norm(b);let rounds=0;while(b.some(Boolean)){if(++rounds>64)throw Error('多项式 GCD 达到上限');let r=a.slice();while(r.length>=b.length&&r.some(Boolean)){const d=r.length-b.length,lc=r.at(-1),bc=b.at(-1);r=r.map(v=>v*bc);for(let j=0;j<b.length;j++)r[j+d]-=lc*b[j];r=norm(r);}a=b;b=r;}return norm(a);}
function coppersmith(o){const {number,inv,mod,gcd}=M(),n=number(o.n),base=number(o.base),step=number(o.step??1),bits=root.HexClassical.integer(o.bits,1,1024,'未知位数'),m=root.HexClassical.integer(o.m??3,1,6,'m'),t=root.HexClassical.integer(o.t??3,1,6,'t');if(n<3n||n.toString(2).length>4096||m+t>12||step<=0n)throw Error('n 限 4096 位，m+t≤12，step>0');const check=M().deadline(25000),X=1n<<BigInt(bits),a=mod(base*inv(step,n),n),powers=[[1n]];for(let i=1;i<=m;i++)powers.push(multiply(powers.at(-1),[a,1n]));const dimension=m+t,rows=[];
 for(let i=0;i<m;i++)rows.push(powers[i].map(v=>v*n**BigInt(m-i)));
 for(let j=0;j<t;j++)rows.push([...new Array(j).fill(0n),...powers[m]]);
 const basis=rows.map(row=>Array.from({length:dimension},(_,k)=>(row[k]||0n)*X**BigInt(k))),reduced=lll(basis,check).map(row=>row.map((v,k)=>v/X**BigInt(k)));
 const roots=new Set();function collect(p){trim(p);if(p.length===2&&p[0]%p[1]===0n)roots.add(String(-p[0]/p[1]));if(p.length===3){const delta=p[1]*p[1]-4n*p[2]*p[0];if(delta>=0n){const sq=M().rootInt(delta);if(sq*sq===delta)for(const value of [-p[1]+sq,-p[1]-sq])if(value%(2n*p[2])===0n)roots.add(String(value/(2n*p[2])));}}}
 for(const r of reduced)collect(r.slice());
 for(let i=0;i<Math.min(reduced.length,6);i++)for(let j=0;j<i;j++){check();collect(polyGcd(reduced[i],reduced[j]));}
 for(const value of roots){const x=BigInt(value);if(x<0n||x>=X)continue;const p=gcd(base+step*x,n);if(p>1n&&p<n){const result={found:true,x:String(x),p:String(p),q:String(n/p),verified:n%p===0n,method:'Univariate linear Coppersmith/Howgrave-Graham lattice + exact LLL'};if(o.e!==undefined&&o.c!==undefined)result.rsa=M().rsa({n:String(n),p:String(p),e:o.e,c:o.c});return result;}}
 return {found:false,note:'本次格参数未找到根；本实现限线性因子泄露 f(x)=base+step*x，不是通用多元 Coppersmith。可调整 m/t/X 或使用专门数学工具。',latticeDimension:dimension};
}
const api={curve,smart,ecc,lll,coppersmith};root.HexAdvanced=api;if(typeof module!=='undefined')module.exports=api;
})(typeof self!=='undefined'?self:globalThis);
