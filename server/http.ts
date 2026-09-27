import { spawn } from 'node:child_process';

// curl is an optional native-TLS fallback for machines whose network middleware
// resets Node's TLS handshake. Credentials and payload travel over stdin only.
export async function postNative(url:string,key:string,body:unknown):Promise<Response>{
  const quoted=(text:string)=>`"${text.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r')}"`;
  const config=[`url = ${quoted(url)}`,'request = "POST"',`header = ${quoted('Authorization: Bearer '+key)}`,'header = "Content-Type: application/json"',`data = ${quoted(JSON.stringify(body))}`,'silent','show-error','max-time = 45','connect-timeout = 10','write-out = "\\n%{http_code}"'].join('\n');
  return new Promise((resolve,reject)=>{
    const child=spawn('curl',['--config','-'],{stdio:['pipe','pipe','pipe']});let output='';let done=false;
    const fail=(message:string,preflight=false)=>{if(done)return;done=true;reject(new Error(message,{cause:{preflight}}));};
    child.on('error',()=>fail('原生网络适配器不可用，请安装 curl 或使用默认传输'));
    child.stdin.on('error',()=>{});child.stderr.resume();
    child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>5e6){child.kill();fail('模型响应过大');}});
    child.on('close',code=>{if(done)return;if(code!==0){fail(`模型网络请求未完成（curl ${code}），请稍后重试`,[5,6,7,35,60].includes(code??0));return;}const split=output.lastIndexOf('\n'),status=Number(output.slice(split+1));if(status<200||status>599){fail('模型接口未返回有效 HTTP 状态');return;}done=true;resolve(new Response(output.slice(0,split),{status}));});
    child.stdin.end(config);
  });
}
