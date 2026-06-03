
-- Backfill direto (a migration roda em session_replication_role=replica, então triggers user não disparam).
-- Calcula tipo_usuario e regrava user_roles com base na nova regra de sync_from_user_acessos.

WITH calc AS (
  SELECT
    ua.user_id,
    ua.lojas,
    ua.setores,
    ua.acesso_total,
    (ua.lojas   IS NOT NULL AND array_length(ua.lojas,1)   > 0) AS has_lojas,
    (ua.setores IS NOT NULL AND array_length(ua.setores,1) > 0) AS has_setores,
    (ua.modulos ?| ARRAY['dashboard','crm','lojas','financeiro','ti','interno','estoque','tarefas','configuracoes']) AS has_web,
    (ua.modulos ? 'menu_loja') AS has_loja_menu
  FROM public.user_acessos ua
),
classified AS (
  SELECT
    user_id, lojas, setores, has_lojas, has_setores,
    CASE
      WHEN acesso_total THEN 'admin'
      WHEN has_lojas AND NOT has_setores THEN 'loja'
      WHEN has_loja_menu AND NOT has_web THEN 'loja'
      WHEN has_setores THEN 'setor_operador'
      ELSE 'colaborador'
    END AS v_tipo,
    CASE
      WHEN acesso_total THEN 'admin'
      WHEN has_lojas AND NOT has_setores THEN 'setor_usuario'
      WHEN has_loja_menu AND NOT has_web THEN 'setor_usuario'
      WHEN has_setores THEN 'setor_usuario'
      ELSE 'operador'
    END AS v_role
  FROM calc
)
UPDATE public.profiles p
   SET tipo_usuario = c.v_tipo,
       lojas        = COALESCE(c.lojas, '{}'::text[]),
       setor_id     = CASE WHEN c.has_setores THEN c.setores[1] ELSE NULL END
  FROM classified c
 WHERE p.id = c.user_id
   AND (p.tipo_usuario IS DISTINCT FROM c.v_tipo
        OR p.lojas IS DISTINCT FROM COALESCE(c.lojas, '{}'::text[])
        OR p.setor_id IS DISTINCT FROM (CASE WHEN c.has_setores THEN c.setores[1] ELSE NULL END));

-- Regrava user_roles para todos os usuários presentes em user_acessos
DELETE FROM public.user_roles
 WHERE user_id IN (SELECT user_id FROM public.user_acessos);

WITH calc AS (
  SELECT
    ua.user_id,
    ua.lojas,
    ua.setores,
    ua.acesso_total,
    (ua.lojas   IS NOT NULL AND array_length(ua.lojas,1)   > 0) AS has_lojas,
    (ua.setores IS NOT NULL AND array_length(ua.setores,1) > 0) AS has_setores,
    (ua.modulos ?| ARRAY['dashboard','crm','lojas','financeiro','ti','interno','estoque','tarefas','configuracoes']) AS has_web,
    (ua.modulos ? 'menu_loja') AS has_loja_menu
  FROM public.user_acessos ua
),
classified AS (
  SELECT
    user_id, lojas, setores, has_lojas, has_setores,
    CASE
      WHEN acesso_total THEN 'admin'
      WHEN has_lojas AND NOT has_setores THEN 'loja'
      WHEN has_loja_menu AND NOT has_web THEN 'loja'
      WHEN has_setores THEN 'setor_operador'
      ELSE 'colaborador'
    END AS v_tipo
  FROM calc
)
-- admins
INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'admin'::app_role FROM classified WHERE v_tipo = 'admin';

INSERT INTO public.user_roles (user_id, role)
SELECT c.user_id, 'operador'::app_role
  FROM (
    SELECT
      ua.user_id,
      ua.acesso_total,
      (ua.lojas   IS NOT NULL AND array_length(ua.lojas,1)   > 0) AS has_lojas,
      (ua.setores IS NOT NULL AND array_length(ua.setores,1) > 0) AS has_setores,
      (ua.modulos ?| ARRAY['dashboard','crm','lojas','financeiro','ti','interno','estoque','tarefas','configuracoes']) AS has_web,
      (ua.modulos ? 'menu_loja') AS has_loja_menu
    FROM public.user_acessos ua
  ) c
 WHERE NOT c.acesso_total
   AND NOT (c.has_lojas AND NOT c.has_setores)
   AND NOT (c.has_loja_menu AND NOT c.has_web)
   AND NOT c.has_setores;

-- tipo 'loja' (escopo por loja) — 1 linha por loja com loja_nome
INSERT INTO public.user_roles (user_id, role, loja_nome)
SELECT ua.user_id, 'setor_usuario'::app_role, l
  FROM public.user_acessos ua, unnest(ua.lojas) l
 WHERE NOT ua.acesso_total
   AND ua.lojas IS NOT NULL AND array_length(ua.lojas,1) > 0
   AND (ua.setores IS NULL OR array_length(ua.setores,1) = 0);

-- tipo 'setor_operador' (tem setores) — 1 linha por setor
INSERT INTO public.user_roles (user_id, role, setor_id)
SELECT ua.user_id, 'setor_usuario'::app_role, s
  FROM public.user_acessos ua, unnest(ua.setores) s
 WHERE NOT ua.acesso_total
   AND ua.setores IS NOT NULL AND array_length(ua.setores,1) > 0;
