import {useCallback,useRef,useState} from 'react';
import {ArrowRight,HardHat,Loader2,LogOut,Plane} from 'lucide-react';
import {Link,useSearchParams} from 'react-router-dom';
import {BrandLogo} from './components';
import {safeObrasReturnPath,startObrasSso} from './sso';

export function Portal({onLogout}:{onLogout:()=>void}){
  const [params]=useSearchParams();
  const [opening,setOpening]=useState(false);
  const [error,setError]=useState(false);
  const started=useRef(false);
  const returnPath=safeObrasReturnPath(params.get('return_path'));
  const openObras=useCallback(async()=>{
    if(started.current)return;
    started.current=true;setOpening(true);setError(false);
    try{globalThis.location.assign(await startObrasSso(returnPath));}
    catch{started.current=false;setOpening(false);setError(true);}
  },[returnPath]);
  return <div className="portal">
    <div className="portal-accent"/>
    <header className="portal-header">
      <BrandLogo className="portal-logo"/>
      <button className="portal-logout" type="button" onClick={onLogout}><LogOut size={17}/>Sair</button>
    </header>
    <main className="portal-main">
      <div className="portal-heading"><span>Portal Tanks BR</span><h1>Como podemos ajudar?</h1><p>Escolha o sistema que deseja acessar.</p></div>
      <div className="portal-cards">
        <Link className="portal-card passages" to="/solicitacoes"><span className="portal-icon"><Plane size={28}/></span><span className="portal-card-copy"><strong>Solicitação de Passagens</strong><small>Solicite e acompanhe deslocamentos de campo.</small></span><ArrowRight className="portal-arrow" size={21}/></Link>
        <button type="button" className="portal-card workforce" onClick={openObras} disabled={opening}><span className="portal-icon"><HardHat size={28}/></span><span className="portal-card-copy"><strong>Alocação de Mão de Obra</strong><small>{opening?'Abrindo…':'Acesse a gestão de obras, equipes e alocações.'}</small></span>{opening?<Loader2 className="portal-arrow" size={21}/>:<ArrowRight className="portal-arrow" size={21}/>}</button>
        {error&&<div className="error" role="alert">Não foi possível abrir o Obras Control. Tente novamente.</div>}
      </div>
    </main>
    <footer className="portal-footer">Tanks BR · Sistemas internos</footer>
  </div>
}
