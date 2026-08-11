begin;
do $$ declare c record;begin
 for c in select * from (values
  ('Curitiba','PR',true,'Curitiba','PR'),
  ('Chopinzinho - PR',null,true,'Chopinzinho','PR'),
  ('Salvador - BA',null,true,'Salvador','BA'),
  ('Manaus/AM',null,true,'Manaus','AM'),
  ('Rio Claro / SP',null,true,'Rio Claro','SP'),
  ('São Paulo-SP',null,true,'São Paulo','SP'),
  ('Curitiba',null,false,'Curitiba',null),
  ('Cidade - XX',null,false,'Cidade - XX',null),
  (null,null,false,null,null),
  ('Chopinzinho - PR','SC',true,'Chopinzinho - PR','SC')
 ) v(cidade_entrada,uf_entrada,possui_esperado,cidade_esperada,uf_esperada) loop
  if not exists(select 1 from public.ro_interpretar_cidade_uf_residencial(c.cidade_entrada,c.uf_entrada) r where r.possui_endereco=c.possui_esperado and r.cidade is not distinct from c.cidade_esperada and r.uf is not distinct from c.uf_esperada) then raise exception 'FALHA_INTERPRETACAO:%/%',c.cidade_entrada,c.uf_entrada;end if;
 end loop;
end $$;
rollback;
