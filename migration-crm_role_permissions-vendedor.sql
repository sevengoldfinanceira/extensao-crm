-- Seven Gold CRM — Permissões para Vendedor
-- Execute este SQL no Supabase SQL Editor.

-- ============================================
-- PASSO 1: Descubra o cargo EXATO do vendedor
-- ============================================
-- Execute esta query primeiro para ver o valor real:
-- SELECT DISTINCT cargo FROM public.crm_users;
--
-- O cargo precisa bater EXATAMENTE com o que está no banco.
-- Exemplos: 'Vendedor', 'vendedor', 'VENDEDOR', 'Consultor Comercial', etc.

-- ============================================
-- PASSO 2: Garantir que a tabela permite leitura
-- ============================================
-- Se a tabela tem RLS mas sem política de SELECT, adicione:
DROP POLICY IF EXISTS "crm_role_permissions_select_authenticated" ON public.crm_role_permissions;
CREATE POLICY "crm_role_permissions_select_authenticated"
ON public.crm_role_permissions
FOR SELECT
TO authenticated
USING (true);

-- ============================================
-- PASSO 3: Inserir permissões (ajuste o cargo)
-- ============================================
-- Troque 'Vendedor' pelo valor EXATO que apareceu no PASSO 1.
INSERT INTO public.crm_role_permissions (cargo, area_key, area_label, permitido)
VALUES
  ('Vendedor', 'crm_pipeline', 'Funil de Leads', true),
  ('Vendedor', 'calendario', 'Calendário', true),
  ('Vendedor', 'tarefas', 'Tarefas', true),
  ('Vendedor', 'retornos', 'Retornos', true)
ON CONFLICT DO NOTHING;

-- Se o cargo for diferente (ex: 'vendedor' minúsculo), repita:
-- INSERT INTO public.crm_role_permissions (cargo, area_key, area_label, permitido)
-- VALUES
--   ('vendedor', 'crm_pipeline', 'Funil de Leads', true),
--   ('vendedor', 'calendario', 'Calendário', true),
--   ('vendedor', 'tarefas', 'Tarefas', true),
--   ('vendedor', 'retornos', 'Retornos', true)
-- ON CONFLICT DO NOTHING;

-- ============================================
-- PASSO 4: Verificar
-- ============================================
-- SELECT * FROM public.crm_role_permissions WHERE cargo ILIKE '%vendedor%';
