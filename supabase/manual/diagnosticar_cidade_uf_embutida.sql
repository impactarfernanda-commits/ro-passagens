-- SOMENTE LEITURA. Não retorna documentos, telefone ou endereço completo.
select e.id colaborador_id,e.nome,e.cidade cidade_armazenada,e.uf is not null possui_uf_separada,
 i.cidade cidade_interpretada,i.uf uf_interpretada,
 case when e.uf is not null and i.possui_endereco then 'formato_separado'
      when e.uf is null and i.possui_endereco then 'uf_embutida_reconhecida'
      else 'endereco_incompleto' end classificacao
from public.ro_funcionarios_enderecos_privados e
cross join lateral public.ro_interpretar_cidade_uf_residencial(e.cidade,e.uf) i
order by classificacao,e.nome,e.id;
