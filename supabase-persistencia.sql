-- Ajustes para pedidos de clientes sem cadastro e persistencia real no Supabase.
-- Execute depois do schema.sql.

ALTER TABLE public.pedidos
  ALTER COLUMN cliente_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS cliente_nome VARCHAR(120),
  ADD COLUMN IF NOT EXISTS cliente_telefone VARCHAR(30);

ALTER TABLE public.itens_do_pedido
  ALTER COLUMN produto_id DROP NOT NULL;

ALTER TABLE public.mensagens
  ALTER COLUMN pedido_id DROP NOT NULL,
  ALTER COLUMN remetente_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS vista_pelo_comerciante BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS vista_pelo_cliente BOOLEAN NOT NULL DEFAULT FALSE;

DROP POLICY IF EXISTS "pedidos_insert_public" ON public.pedidos;
CREATE POLICY "pedidos_insert_public"
ON public.pedidos
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "itens_pedido_insert_public" ON public.itens_do_pedido;
CREATE POLICY "itens_pedido_insert_public"
ON public.itens_do_pedido
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "mensagens_insert_public" ON public.mensagens;
CREATE POLICY "mensagens_insert_public"
ON public.mensagens
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "mensagens_select_public" ON public.mensagens;
CREATE POLICY "mensagens_select_public"
ON public.mensagens
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "mensagens_update_read_public" ON public.mensagens;
CREATE POLICY "mensagens_update_read_public"
ON public.mensagens
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);
