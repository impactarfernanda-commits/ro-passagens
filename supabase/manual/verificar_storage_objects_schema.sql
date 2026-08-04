-- SOMENTE LEITURA. Executar apenas no ambiente isolado após preparar o dry run.
select
  column_name,
  data_type,
  udt_name
from information_schema.columns
where table_schema = 'storage'
  and table_name = 'objects'
  and column_name in ('owner_id', 'metadata')
order by column_name;
