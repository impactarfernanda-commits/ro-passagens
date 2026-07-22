-- Compatibilidade para ambientes onde 202607220001 já foi aplicada.
-- Corrige somente valores nulos; marcações explícitas false/restrito_ro são preservadas.

update public.funcionarios
set
  visivel_obras_control = coalesce(visivel_obras_control, true),
  visivel_passagens = coalesce(visivel_passagens, true),
  escopo_passagens = coalesce(escopo_passagens, 'comum')
where visivel_obras_control is null
   or visivel_passagens is null
   or escopo_passagens is null;

update public.obras
set
  visivel_obras_control = coalesce(visivel_obras_control, true),
  visivel_passagens = coalesce(visivel_passagens, true),
  escopo_passagens = coalesce(escopo_passagens, 'comum'),
  tipo_centro_custo = coalesce(tipo_centro_custo, 'obra')
where visivel_obras_control is null
   or visivel_passagens is null
   or escopo_passagens is null
   or tipo_centro_custo is null;
