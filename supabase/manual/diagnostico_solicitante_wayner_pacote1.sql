-- SOMENTE LEITURA. Execute manualmente no projeto hukhwirdrpylxpaedjbc.
select
  s.id as solicitacao_id,
  s.created_at,
  f.nome as funcionario,
  s.solicitante_id,
  sp.full_name as solicitante_full_name,
  s.aprovador_id,
  ap.full_name as aprovador_full_name,
  s.aprovacao_status
from public.ro_passagem_solicitacoes s
join public.funcionarios f on f.id=s.funcionario_id
left join public.users_profiles sp on sp.id=s.solicitante_id
left join public.users_profiles ap on ap.id=s.aprovador_id
where upper(btrim(f.nome))='WAYNER ROCHA SILVA'
order by s.created_at desc,s.id;
