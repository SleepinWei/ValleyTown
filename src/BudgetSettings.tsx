import { useEffect, useState } from 'react';
import { budgetProviders, budgetPercent, money, type BudgetProvider, type BudgetPool } from '../shared/budget';
import type { Usage } from '../shared/types';
import './budget.css';

type Save = (provider: BudgetProvider, value: number) => Promise<unknown>;
function BudgetCard({provider,pool,onSave}:{provider:BudgetProvider;pool:BudgetPool;onSave:Save}){
  const [value,setValue]=useState(String(pool.limitCny)),[pending,setPending]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{setValue(String(pool.limitCny));},[pool.limitCny]);
  const amount=Number(value),valid=value.trim()!==''&&Number.isFinite(amount)&&amount>=0&&amount<=1_000_000&&Math.abs(amount*100-Math.round(amount*100))<1e-6;
  const save=async(e:React.FormEvent)=>{e.preventDefault();if(!valid||pending)return;setPending(true);setMessage('');try{await onSave(provider,amount);setMessage('上限已保存，累计费用保留。');}catch(error){setMessage((error as Error).message);}finally{setPending(false);}};
  return <form className="budget-pool" onSubmit={e=>void save(e)}>
    <div className="budget-pool-title"><h4>{provider}</h4><span>独立人民币池</span></div>
    <div className="usage-big">{money(pool.spentCny)}<small>已用估算 / 上限 {money(pool.limitCny)}</small></div>
    <div className="budget-meter" role="progressbar" aria-label={`${provider} 金额池已用与预留`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={budgetPercent(pool)}><i style={{width:`${budgetPercent(pool)}%`}}/></div>
    <div className="usage-meta"><span>预留 {money(pool.reservedCny)}</span><span>可用 {money(pool.remainingCny)}</span></div>
    <label htmlFor={`budget-${provider}`}>{provider} 累计上限（元）</label>
    <div className="input-row"><input id={`budget-${provider}`} type="number" min="0" max="1000000" step="0.01" value={value} aria-invalid={!valid} aria-describedby={`budget-message-${provider}`} onChange={e=>{setValue(e.target.value);setMessage('');}}/><button className="primary" disabled={!valid||pending} type="submit">{pending?'保存中…':'保存上限'}</button></div>
    <p id={`budget-message-${provider}`} className={!valid?'warning':'hint'} role="status">{!valid?'请输入 0–1,000,000 元，最多两位小数。':message||'设为 0 可关闭此池；提高上限后手动继续模拟。'}</p>
    {pool.legacyCalls>0&&<p className="hint">含 {pool.legacyCalls} 次旧记录，按迁移时单价保守折算。</p>}
  </form>;
}
export function BudgetSettings({usage,onSave,onExchange}:{usage:Usage;onSave:Save;onExchange:(value:number)=>Promise<unknown>}){
  const [exchange,setExchange]=useState(String(usage.usdCny)),[pending,setPending]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{setExchange(String(usage.usdCny));},[usage.usdCny]);
  const rate=Number(exchange),valid=exchange.trim()!==''&&Number.isFinite(rate)&&rate>0&&rate<=100;
  return <div className="settings-section"><h3>模型金额池 · 人民币</h3><p className="muted">DeepSeek 与 Jev 分别扣费，互不借用。任一池不足以预留下一次请求时，全局暂停。</p>
    {budgetProviders.map(provider=><BudgetCard key={provider} provider={provider} pool={usage.pools[provider]} onSave={onSave}/>)}
    <details className="budget-pricing"><summary>计费估算与 Jev 汇率</summary><p className="hint">DeepSeek Flash 每百万 token：输入 ¥2、缓存命中 ¥0.04、输出 ¥8。按高峰单价保守估算，未计空闲时段折扣。</p><p className="hint">Jev 1.13.0 每百万输入 token $0.042，输出免费。汇率默认 7，可按实际支付汇率修改；不是实时汇率。新汇率仅用于后续请求，已有费用和在途预留不变。</p>
    <form onSubmit={e=>{e.preventDefault();if(!valid||pending)return;setPending(true);setMessage('');void onExchange(rate).then(()=>setMessage('汇率已保存。'),error=>setMessage(error.message)).finally(()=>setPending(false));}}><label htmlFor="jev-exchange">1 美元折合人民币（元）</label><div className="input-row"><input id="jev-exchange" type="number" min="0.000001" max="100" step="any" value={exchange} aria-invalid={!valid} onChange={e=>setExchange(e.target.value)}/><button className="outline" disabled={!valid||pending}>{pending?'保存中…':'保存汇率'}</button></div><p className="hint" role="status">{valid?message:'请输入大于 0、不超过 100 的汇率。'}</p></form></details>
    <p className="hint">金额为本地费用估算，以供应商账单为准。已发出但用量未知的请求保留预留；重启、读档不清零。token 仅作统计，不再限制运行。</p>
  </div>;
}
