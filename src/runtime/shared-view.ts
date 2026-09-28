import type { Snapshot } from '../../shared/types';

// Only game presentation leaves the host; never credentials or checkpoints.
export const presentationKeys=['id','clock','dayMinutes','status','mode','weather','actors','player','events','conversations','appointments','quests','usage','configured','notice','observer','society','runtime','incidents','timing','bubbles','performance','laboratory','privateActors','decisions','actionTraces','readViews','playerView','displayVersion'] as const;
const sensitiveKey=/^(?:.*apikey|.*accessToken|.*refreshToken|authorization|headers|cookie|password|serviceRole|serviceRoleKey|secretKey|clientSecret|deepseekKey|jevKey|privateKey|credentials|config|payload|documentErrors|file|imported)$/i;
export function redactPresentation(value:unknown):any {
  if(typeof value==='string')return value
    .replace(/\b(?:sk-|sb_secret_|sbp_)[A-Za-z0-9_-]{8,}\b/g,'[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[REDACTED]');
  if(Array.isArray(value))return value.map(redactPresentation);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!sensitiveKey.test(key.replace(/[_-]/g,''))).map(([key,v])=>[key,key==='error'&&v?'请求失败，诊断详情仅管理员可见':redactPresentation(v)]));
  return value;
}
export function publicTownSnapshot(value:Snapshot):Snapshot {
  const picked=Object.fromEntries(presentationKeys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
  return redactPresentation(picked) as Snapshot;
}
export function playerPresentation(value:Snapshot):Snapshot {
  const {privateActors,decisions,actionTraces,documentErrors,...rest}=value;
  return {...rest,...value.playerView,observer:false};
}
export function readSharedView(snapshot:Snapshot|undefined,method:string,path:string):unknown {
  // Viewing is entirely local: there is no worker, transport or model call here.
  if(method!=='GET'||!/^\/(?:decision-lab|saves|documents\/[^/?]+|action-policy\/[^/?]+|stories\/[^/?]+\?view=(?:player|observer))$/.test(path))throw new Error('当前为只读观看，只有管理员可以操作小镇或调用模型。');
  if(!snapshot?.readViews||!Object.hasOwn(snapshot.readViews,path))throw new Error('等待管理员同步这份查看资料，请稍后重试。');
  return structuredClone(snapshot.readViews[path]);
}
