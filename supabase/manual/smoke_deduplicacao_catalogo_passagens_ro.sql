begin;
do $$ begin
 if public.ro_correspondencia_nome_catalogo_ro('VITOR FERRI','VITOR PENATTI FERRI')<>'NOME_INTERMEDIARIO_AUSENTE' then raise exception 'FALHA_VITOR';end if;
 if public.ro_correspondencia_nome_catalogo_ro('YORDAN ALISSON DE CASTRO BONAC','YORDAN ALISSON DE CASTRO BONACCORSI')<>'SOBRENOME_TRUNCADO' then raise exception 'FALHA_YORDAN';end if;
 if public.ro_correspondencia_nome_catalogo_ro('YURI VIEIRA NASCIMENTO','YURI VIEIRA DO NASCIMENTO')<>'PARTICULA_DIVERGENTE' then raise exception 'FALHA_YURI';end if;
 if public.ro_correspondencia_nome_catalogo_ro('ANA S','ANA SA') is not null then raise exception 'FALHA_PREFIXO_CURTO';end if;
end $$;
rollback;

