import {ArrowRight,HardHat,LogOut,Plane} from 'lucide-react';
import {Link} from 'react-router-dom';
import {BrandLogo} from './components';

const obrasControlUrl=import.meta.env.VITE_OBRAS_CONTROL_URL||'https://obras-control-demo.vercel.app';

export function Portal({onLogout}:{onLogout:()=>void}){
  return <div className="portal">
    <div className="portal-accent"/>
    <header className="portal-header">
      <BrandLogo className="portal-logo"/>
      <button className="portal-logout" type="button" onClick={onLogout}><LogOut size={17}/>Sair</button>
    </header>
    <main className="portal-main">
      <div className="portal-heading">
        <span>Portal Tanks BR</span>
        <h1>Como podemos ajudar?</h1>
        <p>Escolha o sistema que deseja acessar.</p>
      </div>
      <div className="portal-cards">
        <Link className="portal-card passages" to="/solicitacoes">
          <span className="portal-icon"><Plane size={28}/></span>
          <span className="portal-card-copy"><strong>Solicitação de Passagens</strong><small>Solicite e acompanhe deslocamentos de campo.</small></span>
          <ArrowRight className="portal-arrow" size={21}/>
        </Link>
        <a className="portal-card workforce" href={obrasControlUrl}>
          <span className="portal-icon"><HardHat size={28}/></span>
          <span className="portal-card-copy"><strong>Alocação de Mão de Obra</strong><small>Acesse a gestão de obras, equipes e alocações.</small></span>
          <ArrowRight className="portal-arrow" size={21}/>
        </a>
      </div>
    </main>
    <footer className="portal-footer">Tanks BR · Sistemas internos</footer>
  </div>
}
