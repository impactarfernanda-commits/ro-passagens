import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,HardHat,Loader2,LogOut,Plane} from 'lucide-react';
import {Link,useSearchParams} from 'react-router-dom';
import {BrandLogo} from './components';
import {finalObrasUrl,isTrustedObrasMessage,OBRAS_ERROR_MESSAGE,OBRAS_READY_MESSAGE,obrasBootstrapUrl} from './obrasBootstrap';
import {OBRAS_ORIGIN,safeObrasReturnPath,startObrasSso} from './sso';

const OBRAS_BOOTSTRAP_TIMEOUT_MS=15_000;

export function Portal({onLogout}:{onLogout:()=>void}){
  const [params]=useSearchParams();
  const [opening,setOpening]=useState(false);
  const [error,setError]=useState(false);
  const [bootstrapUrl,setBootstrapUrl]=useState<string|null>(null);
  const started=useRef(false);
  const iframe=useRef<HTMLIFrameElement>(null);
  const timeout=useRef<ReturnType<typeof setTimeout>|null>(null);
  const returnPath=safeObrasReturnPath(params.get('return_path'));
  const reset=useCallback(()=>{started.current=false;setOpening(false);setBootstrapUrl(null);if(timeout.current)clearTimeout(timeout.current);timeout.current=null;},[]);
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(!isTrustedObrasMessage(event,OBRAS_ORIGIN)||event.source!==iframe.current?.contentWindow)return;
      if(event.data.type===OBRAS_ERROR_MESSAGE){reset();setError(true);return;}
      if(event.data.type!==OBRAS_READY_MESSAGE||event.data.return_path!==returnPath)return;
      const destination=finalObrasUrl(OBRAS_ORIGIN,event.data.return_path);
      if(destination!==finalObrasUrl(OBRAS_ORIGIN,returnPath))return;
      if(timeout.current)clearTimeout(timeout.current);
      globalThis.location.assign(destination);
    };
    globalThis.addEventListener('message',receive);
    return()=>{globalThis.removeEventListener('message',receive);if(timeout.current)clearTimeout(timeout.current);started.current=false;};
  },[reset,returnPath]);
  const openObras=useCallback(async()=>{
    if(started.current)return;
    started.current=true;setOpening(true);setError(false);
    timeout.current=setTimeout(()=>{reset();setError(true);},OBRAS_BOOTSTRAP_TIMEOUT_MS);
    try{setBootstrapUrl(obrasBootstrapUrl(await startObrasSso(returnPath)));}
    catch{reset();setError(true);}
  },[reset,returnPath]);
  return <div className="portal">
    <div className="portal-accent"/>
    <header className="portal-header"><BrandLogo className="portal-logo"/><button className="portal-logout" type="button" onClick={onLogout}><LogOut size={17}/>Sair</button></header>
    <main className="portal-main">
      <div className="portal-heading"><span>Portal Tanks BR</span><h1>Como podemos ajudar?</h1><p>Escolha o sistema que deseja acessar.</p></div>
      <div className="portal-cards">
        <Link className="portal-card passages" to="/solicitacoes"><span className="portal-icon"><Plane size={28}/></span><span className="portal-card-copy"><strong>Solicitação de Passagens</strong><small>Solicite e acompanhe deslocamentos de campo.</small></span><ArrowRight className="portal-arrow" size={21}/></Link>
        <button type="button" className="portal-card workforce" onClick={openObras} disabled={opening}><span className="portal-icon"><HardHat size={28}/></span><span className="portal-card-copy"><strong>Alocação de Mão de Obra</strong><small>{opening?'Abrindo Obras Control...':'Acesse a gestão de obras, equipes e alocações.'}</small></span>{opening?<Loader2 className="portal-arrow portal-spinner" size={21}/>:<ArrowRight className="portal-arrow" size={21}/>}</button>
        {bootstrapUrl&&<iframe ref={iframe} className="obras-bootstrap-frame" src={bootstrapUrl} title="Preparando Obras Control"/>}
        {error&&<div className="error portal-open-error" role="alert">Não foi possível abrir o Obras Control. <button type="button" onClick={openObras}>Tentar novamente</button></div>}
      </div>
    </main>
    <footer className="portal-footer">Tanks BR · Sistemas internos</footer>
  </div>
}
