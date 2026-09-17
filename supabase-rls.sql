-- =============================================================
-- POLÍTICAS RLS PARA O PedeIA
-- Arquivo separado para colar no Supabase SQL Editor.
-- Execute este arquivo depois do schema.sql.
-- =============================================================

-- Habilita RLS em todas as tabelas do sistema.
ALTER TABLE public.comerciantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lojas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itens_do_pedido ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avaliacoes ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- POLÍTICAS: comerciantes
-- =============================================================
DROP POLICY IF EXISTS "comerciantes_select_own" ON public.comerciantes;
CREATE POLICY "comerciantes_select_own"
ON public.comerciantes
FOR SELECT
USING (id = auth.uid());

DROP POLICY IF EXISTS "comerciantes_insert_own" ON public.comerciantes;
CREATE POLICY "comerciantes_insert_own"
ON public.comerciantes
FOR INSERT
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "comerciantes_update_own" ON public.comerciantes;
CREATE POLICY "comerciantes_update_own"
ON public.comerciantes
FOR UPDATE
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "comerciantes_delete_own" ON public.comerciantes;
CREATE POLICY "comerciantes_delete_own"
ON public.comerciantes
FOR DELETE
USING (id = auth.uid());

-- =============================================================
-- POLÍTICAS: clientes
-- =============================================================
DROP POLICY IF EXISTS "clientes_select_own" ON public.clientes;
CREATE POLICY "clientes_select_own"
ON public.clientes
FOR SELECT
USING (id = auth.uid());

DROP POLICY IF EXISTS "clientes_insert_own" ON public.clientes;
CREATE POLICY "clientes_insert_own"
ON public.clientes
FOR INSERT
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "clientes_update_own" ON public.clientes;
CREATE POLICY "clientes_update_own"
ON public.clientes
FOR UPDATE
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "clientes_delete_own" ON public.clientes;
CREATE POLICY "clientes_delete_own"
ON public.clientes
FOR DELETE
USING (id = auth.uid());

-- =============================================================
-- POLÍTICAS: lojas
-- Permite leitura pública para exibir a loja na vitrine.
-- O dono da loja pode gerenciar apenas a própria loja.
-- =============================================================
DROP POLICY IF EXISTS "lojas_select_public" ON public.lojas;
CREATE POLICY "lojas_select_public"
ON public.lojas
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "lojas_insert_own" ON public.lojas;
CREATE POLICY "lojas_insert_own"
ON public.lojas
FOR INSERT
WITH CHECK (merchant_id = auth.uid());

DROP POLICY IF EXISTS "lojas_update_own" ON public.lojas;
CREATE POLICY "lojas_update_own"
ON public.lojas
FOR UPDATE
USING (merchant_id = auth.uid())
WITH CHECK (merchant_id = auth.uid());

DROP POLICY IF EXISTS "lojas_delete_own" ON public.lojas;
CREATE POLICY "lojas_delete_own"
ON public.lojas
FOR DELETE
USING (merchant_id = auth.uid());

-- =============================================================
-- POLÍTICAS: categorias
-- Publico pode ler categorias da loja aberta.
-- Comerciantes podem gerenciar apenas as categorias da própria loja.
-- =============================================================
DROP POLICY IF EXISTS "categorias_select_public" ON public.categorias;
CREATE POLICY "categorias_select_public"
ON public.categorias
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "categorias_manage_own" ON public.categorias;
CREATE POLICY "categorias_manage_own"
ON public.categorias
FOR ALL
USING (
    loja_id IN (
        SELECT id
        FROM public.lojas
        WHERE merchant_id = auth.uid()
    )
)
WITH CHECK (
    loja_id IN (
        SELECT id
        FROM public.lojas
        WHERE merchant_id = auth.uid()
    )
);

-- =============================================================
-- POLÍTICAS: produtos
-- Publico pode ver produtos da loja.
-- Comerciantes gerenciam os produtos da própria loja.
-- =============================================================
DROP POLICY IF EXISTS "produtos_select_public" ON public.produtos;
CREATE POLICY "produtos_select_public"
ON public.produtos
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "produtos_manage_own" ON public.produtos;
CREATE POLICY "produtos_manage_own"
ON public.produtos
FOR ALL
USING (
    loja_id IN (
        SELECT id
        FROM public.lojas
        WHERE merchant_id = auth.uid()
    )
)
WITH CHECK (
    loja_id IN (
        SELECT id
        FROM public.lojas
        WHERE merchant_id = auth.uid()
    )
);

-- =============================================================
-- POLÍTICAS: pedidos
-- Comerciantes veem e atualizam pedidos da própria loja.
-- Clientes autenticados podem ver seus próprios pedidos.
-- =============================================================
DROP POLICY IF EXISTS "pedidos_select_own" ON public.pedidos;
CREATE POLICY "pedidos_select_own"
ON public.pedidos
FOR SELECT
USING (
    loja_id IN (
        SELECT id
        FROM public.lojas
        WHERE merchant_id = auth.uid()
    )
    OR cliente_id = auth.uid()
);

DROP POLICY IF EXISTS "pedidos_insert_public" ON public.pedidos;
CREATE POLICY "pedidos_insert_public"
ON public.pedidos
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "pedidos_update_own" ON public.pedidos;
CREATE POLICY "pedidos_update_own"
ON public.pedidos
FOR UPDATE
USING (
    loja_id IN (
        SELECT id
        FROM public.lojas
        WHERE merchant_id = auth.uid()
    )
)
WITH CHECK (
    loja_id IN (
        SELECT id
        FROM public.lojas
        WHERE merchant_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "pedidos_delete_own" ON public.pedidos;
CREATE POLICY "pedidos_delete_own"
ON public.pedidos
FOR DELETE
USING (
    loja_id IN (
        SELECT id
        FROM public.lojas
        WHERE merchant_id = auth.uid()
    )
);

-- =============================================================
-- POLÍTICAS: itens_do_pedido
-- Só permite gestão dos itens vinculados aos pedidos da loja do dono.
-- =============================================================
DROP POLICY IF EXISTS "itens_pedido_select_own" ON public.itens_do_pedido;
CREATE POLICY "itens_pedido_select_own"
ON public.itens_do_pedido
FOR SELECT
USING (
    pedido_id IN (
        SELECT p.id
        FROM public.pedidos p
        INNER JOIN public.lojas l ON l.id = p.loja_id
        WHERE l.merchant_id = auth.uid()
    )
    OR pedido_id IN (
        SELECT id
        FROM public.pedidos
        WHERE cliente_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "itens_pedido_insert_public" ON public.itens_do_pedido;
CREATE POLICY "itens_pedido_insert_public"
ON public.itens_do_pedido
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "itens_pedido_update_own" ON public.itens_do_pedido;
CREATE POLICY "itens_pedido_update_own"
ON public.itens_do_pedido
FOR UPDATE
USING (
    pedido_id IN (
        SELECT p.id
        FROM public.pedidos p
        INNER JOIN public.lojas l ON l.id = p.loja_id
        WHERE l.merchant_id = auth.uid()
    )
)
WITH CHECK (
    pedido_id IN (
        SELECT p.id
        FROM public.pedidos p
        INNER JOIN public.lojas l ON l.id = p.loja_id
        WHERE l.merchant_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "itens_pedido_delete_own" ON public.itens_do_pedido;
CREATE POLICY "itens_pedido_delete_own"
ON public.itens_do_pedido
FOR DELETE
USING (
    pedido_id IN (
        SELECT p.id
        FROM public.pedidos p
        INNER JOIN public.lojas l ON l.id = p.loja_id
        WHERE l.merchant_id = auth.uid()
    )
);

-- =============================================================
-- POLÍTICAS: mensagens
-- Mensagem pode ser lida pelo remetente ou pelo dono da loja.
-- =============================================================
DROP POLICY IF EXISTS "mensagens_select_own" ON public.mensagens;
CREATE POLICY "mensagens_select_own"
ON public.mensagens
FOR SELECT
USING (
    remetente_id = auth.uid()
    OR pedido_id IN (
        SELECT p.id
        FROM public.pedidos p
        INNER JOIN public.lojas l ON l.id = p.loja_id
        WHERE l.merchant_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "mensagens_insert_own" ON public.mensagens;
CREATE POLICY "mensagens_insert_own"
ON public.mensagens
FOR INSERT
WITH CHECK (remetente_id = auth.uid());

DROP POLICY IF EXISTS "mensagens_update_own" ON public.mensagens;
CREATE POLICY "mensagens_update_own"
ON public.mensagens
FOR UPDATE
USING (
    remetente_id = auth.uid()
    OR pedido_id IN (
        SELECT p.id
        FROM public.pedidos p
        INNER JOIN public.lojas l ON l.id = p.loja_id
        WHERE l.merchant_id = auth.uid()
    )
)
WITH CHECK (
    remetente_id = auth.uid()
    OR pedido_id IN (
        SELECT p.id
        FROM public.pedidos p
        INNER JOIN public.lojas l ON l.id = p.loja_id
        WHERE l.merchant_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "mensagens_delete_own" ON public.mensagens;
CREATE POLICY "mensagens_delete_own"
ON public.mensagens
FOR DELETE
USING (
    remetente_id = auth.uid()
    OR pedido_id IN (
        SELECT p.id
        FROM public.pedidos p
        INNER JOIN public.lojas l ON l.id = p.loja_id
        WHERE l.merchant_id = auth.uid()
    )
);

-- =============================================================
-- POLÍTICAS: avaliacoes
-- Leitura pública, mas só o cliente dono da avaliação consegue editar.
-- =============================================================
DROP POLICY IF EXISTS "avaliacoes_select_public" ON public.avaliacoes;
CREATE POLICY "avaliacoes_select_public"
ON public.avaliacoes
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "avaliacoes_insert_own" ON public.avaliacoes;
CREATE POLICY "avaliacoes_insert_own"
ON public.avaliacoes
FOR INSERT
WITH CHECK (cliente_id = auth.uid());

DROP POLICY IF EXISTS "avaliacoes_update_own" ON public.avaliacoes;
CREATE POLICY "avaliacoes_update_own"
ON public.avaliacoes
FOR UPDATE
USING (cliente_id = auth.uid())
WITH CHECK (cliente_id = auth.uid());

DROP POLICY IF EXISTS "avaliacoes_delete_own" ON public.avaliacoes;
CREATE POLICY "avaliacoes_delete_own"
ON public.avaliacoes
FOR DELETE
USING (cliente_id = auth.uid());
