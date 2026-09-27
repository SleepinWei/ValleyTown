import type { Answer, Question } from '../server/models';

// Benchmark-only bridge. Self-rated confidence is not a calibrated Jev probability.
export const replacementInstruction='你是小镇的结构化决策层。根据 state 独立回答 questions 的每个问题，遵守各题 instructions 和 criteria，不生成对白或解释。只返回 JSON 对象 {"answers":{"题目ID":{...}}}。choice 返回 {"type":"choice","choice":"合法候选键","confidence":0到1的自评把握度}；score 返回 {"type":"score","score":0到criteria长度减1的实数,"confidence":0到1的自评把握度}，score 是按给定等级顺序评估的等级位置；noul 返回 {"type":"noul","noul":0到1的命题符合程度}。每题都必须回答。不输出概率分布。';

export function replacementAnswers(text:string,questions:Record<string,Question>):Record<string,Answer>{
  const parsed=JSON.parse(text);
  if(!parsed||typeof parsed.answers!=='object'||parsed.answers===null)throw new Error('DS replacement: missing answers');
  const answers:Record<string,Answer>={};
  const unit=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1;
  for(const [id,q] of Object.entries(questions)){
    const a=parsed.answers[id];
    if(!a||a.type!==q.type)throw new Error('DS replacement: wrong question type');
    if(q.type==='choice'){
      if(typeof a.choice!=='string'||!Object.hasOwn(q.criteria,a.choice)||!unit(a.confidence))throw new Error('DS replacement: invalid choice/confidence');
      answers[id]={type:q.type,choice:a.choice,confidence:a.confidence};
    }else if(q.type==='score'){
      if(typeof a.score!=='number'||!Number.isFinite(a.score)||a.score<0||a.score>q.criteria.length-1||!unit(a.confidence))throw new Error('DS replacement: invalid score/confidence');
      answers[id]={type:q.type,score:a.score,confidence:a.confidence};
    }else{
      if(!unit(a.noul))throw new Error('DS replacement: invalid noul');
      answers[id]={type:q.type,noul:a.noul};
    }
  }
  return answers;
}
