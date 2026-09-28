import { createContext,useContext,type ButtonHTMLAttributes } from 'react';
export const ReadOnlyContext=createContext(false);
export const useReadOnly=()=>useContext(ReadOnlyContext);
export function WriteButton(props:ButtonHTMLAttributes<HTMLButtonElement>){
  const readOnly=useReadOnly();
  return <button {...props} disabled={readOnly||props.disabled} title={readOnly?'仅管理员可操作；观看不会发起模型请求':props.title}/>;
}
