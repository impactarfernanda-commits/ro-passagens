import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,HardHat,Loader2,LogOut,Plane} from 'lucide-react';
import {Link,useSearchParams} from 'react-router-dom';
import {BrandLogo} from './components';
import {safeObrasReturnPath,startObrasSso} from './sso';

const OBRAS_SSO_TIMEOUT_MS=15_000;

export function Portal({onLogout}:{onLogout:()=>void}){
  const [params]=useSearchParams();
  const returnedWithoutSession=params.get('obras_auth_failed')==='1';
  const [opening,setOpening]=useState(false);
  const [error,setError]=useState(returnedWithoutSession);
  const attempt=useRef(0);
  const timeout=useRef<ReturnType<typeof setTimeout>|null>(null);
  const returnPath=safeObrasReturnPath(params.get('return_path'));
  const reset=useCallback(()=>{attempt.current+=1;setOpening(false);if(timeout.current)clearTimeout(timeout.current);timeout.current=null;},[]);
  useEffect(()=>()=>reset(),[reset]);
  const openObras=useCallback(async()=>{
    if(opening)return;
    const currentAttempt=++attempt.current;
    setOpening(true);setError(false);
    try{
      const redirectUrl=await Promise.race([
        startObrasSso(returnPath),
        new Promise<never>((_,reject)=>{timeout.current=setTimeout(()=>reject(new Error('SSO_START_TIMEOUT')),OBRAS_SSO_TIMEOUT_MS);}),
      ]);
      if(currentAttempt!==attempt.current)return;
      if(timeout.current)clearTimeout(timeout.current);timeout.current=null;
      window.name='obras-control-bootstrap';
      globalThis.location.assign(redirectUrl);
    }catch{
      if(currentAttempt!==attempt.current)return;
      reset();setError(true);
    }
  },[opening,reset,returnPath]);
  return <div className="portal">
    <div className="portal-accent"/>
    <header className="portal-header"><BrandLogo className="portal-logo"/><button className="portal-logout" type="button" onClick={onLogout}><LogOut size={17}/>Sair</button></header>
    <main className="portal-main">
      <div className="portal-heading"><span>Portal Tanks BR</span><h1>Como podemos ajudar?</h1><p>Escolha o sistema que deseja acessar.</p></div>
      <div className="portal-cards">
        <Link className="portal-card passages" to="/solicitacoes"><span className="portal-icon"><Plane size={28}/></span><span className="portal-card-copy"><strong>Solicitação de Passagens</strong><small>Solicite e acompanhe deslocamentos de campo.</small></span><ArrowRight className="portal-arrow" size={21}/></Link>
        <button type="button" className="portal-card workforce" onClick={openObras} disabled={opening}><span className="portal-icon"><HardHat size={28}/></span><span className="portal-card-copy"><strong>Alocação de Mão de Obra</strong><small>{opening?'Abrindo Obras Control...':'Acesse a gestão de obras, equipes e alocações.'}</small></span>{opening?<Loader2 className="portal-arrow portal-spinner" size={21}/>:<ArrowRight className="portal-arrow" size={21}/>}</button>
        {error&&<div className="error portal-open-error" role="alert">{returnedWithoutSession?'Não foi possível concluir a autenticação no Obras Control.':'Não foi possível abrir o Obras Control.'} <button type="button" onClick={openObras}>Tentar novamente</button></div>}
      </div>
    </main>
    <footer className="portal-footer">Tanks BR · Sistemas internos</footer>
  </div>
}
