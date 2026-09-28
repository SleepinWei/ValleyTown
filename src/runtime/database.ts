import type { TownData } from '../../engine/browser-store';
export interface LocalTown {data:TownData;revision:number;dirty:boolean;updated:number}
export async function openTownDatabase():Promise<IDBDatabase> {
  if(!globalThis.indexedDB)throw new Error('当前浏览器不支持 IndexedDB，无法保存小镇。');
  return new Promise((resolve,reject)=>{const request=indexedDB.open('valleytown',1);request.onupgradeneeded=()=>request.result.createObjectStore('towns');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('存档数据库被旧页面占用，请关闭其他溪谷镇页面后重试。'));});
}
export async function readLocal(db:IDBDatabase,key:string):Promise<LocalTown|undefined>{return new Promise((resolve,reject)=>{const tx=db.transaction('towns','readonly'),r=tx.objectStore('towns').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function writeLocal(db:IDBDatabase,key:string,value:LocalTown):Promise<void>{return new Promise((resolve,reject)=>{const tx=db.transaction('towns','readwrite');tx.objectStore('towns').put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('存档事务中断'));});}
