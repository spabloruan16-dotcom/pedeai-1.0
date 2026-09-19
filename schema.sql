CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- =============================================================
-- TABELA: comerciantes
-- Guarda os dados do dono da loja e da conta autenticada no Supabase.
-- Cada usuário autenticado vira um comerciante vinculado à sua loja.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.comerciantes (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nome VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================
-- TABELA: clientes
-- Guarda os dados do cliente quando ele faz um pedido e fornece
-- endereço/telefone para entrega. Não é obrigatório login.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.clientes (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nome VARCHAR(120) NOT NULL,
    email VARCHAR(190) UNIQUE,
    telefone VARCHAR(30) NOT NULL,
    endereco TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================
-- TABELA: lojas
-- Guarda a identidade pública da loja, o tipo de comércio e as regras
-- principais de entrega e funcionamento. Essa tabela representa o
-- negócio que aparece para o cliente.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.lojas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES public.comerciantes(id) ON DELETE CASCADE,
    public_id VARCHAR(120) NOT NULL UNIQUE,
    nome VARCHAR(140) NOT NULL,
    tipo VARCHAR(80) NOT NULL,
    descricao TEXT,
    foto_url TEXT,
    capa_url TEXT,
    esta_aberta BOOLEAN NOT NULL DEFAULT TRUE,
    aceita_entrega BOOLEAN NOT NULL DEFAULT TRUE,
    aceita_retirada BOOLEAN NOT NULL DEFAULT TRUE,
    tempo_entrega SMALLINT NOT NULL DEFAULT 45,
    tempo_retirada SMALLINT NOT NULL DEFAULT 20,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT lojas_tempo_entrega_check CHECK (tempo_entrega >= 0),
    CONSTRAINT lojas_tempo_retirada_check CHECK (tempo_retirada >= 0)
);

ALTER TABLE public.lojas ADD COLUMN IF NOT EXISTS capa_url TEXT;

-- =============================================================
-- TABELA: categorias
-- Guarda as categorias do menu da loja, como lanches, porções e bebidas.
-- Cada categoria pertence a uma única loja.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.categorias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loja_id UUID NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
    nome VARCHAR(100) NOT NULL,
    ordem SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT categorias_ordem_check CHECK (ordem >= 0),
    CONSTRAINT categoria_unica_por_loja UNIQUE (loja_id, nome)
);

-- =============================================================
-- TABELA: produtos
-- Guarda cada item do cardápio, com preço, disponibilidade e imagem.
-- Produtos sempre pertencem a uma categoria e a uma loja.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.produtos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loja_id UUID NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
    categoria_id UUID NOT NULL REFERENCES public.categorias(id) ON DELETE RESTRICT,
    nome VARCHAR(140) NOT NULL,
    descricao TEXT NOT NULL,
    foto_url TEXT,
    preco NUMERIC(10,2) NOT NULL,
    disponivel BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT produtos_preco_check CHECK (preco >= 0)
);

-- =============================================================
-- TABELA: pedidos
-- Guarda cada pedido realizado pelo cliente. Ela controla status,
-- forma de entrega, valor total e o relacionamento com a loja.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.pedidos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loja_id UUID NOT NULL REFERENCES public.lojas(id) ON DELETE RESTRICT,
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
    cliente_nome VARCHAR(120),
    cliente_telefone VARCHAR(30),
    modalidade VARCHAR(20) NOT NULL,
    endereco TEXT,
    pagamento VARCHAR(40) NOT NULL,
    observacoes TEXT,
    total NUMERIC(10,2) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'Aguardando',
    pronto_em TIMESTAMPTZ,
    confirmado_em TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pedidos_modalidade_check CHECK (modalidade IN ('delivery', 'pickup')),
    CONSTRAINT pedidos_status_check CHECK (status IN ('Aguardando', 'Em preparo', 'Pronto', 'Saiu para entrega', 'Entregue', 'Cancelado')),
    CONSTRAINT pedidos_total_check CHECK (total >= 0),
    CONSTRAINT pedidos_endereco_check CHECK (modalidade = 'pickup' OR endereco IS NOT NULL)
);

-- =============================================================
-- TABELA: itens_do_pedido
-- Guarda cada item que entrou no pedido, incluindo quantidade e preço.
-- Essa tabela permite reconstruir a comanda e imprimir a nota.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.itens_do_pedido (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
    produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE RESTRICT,
    nome_produto VARCHAR(140) NOT NULL,
    descricao_produto TEXT NOT NULL,
    quantidade SMALLINT NOT NULL,
    preco_unitario NUMERIC(10,2) NOT NULL,
    observacao TEXT,
    CONSTRAINT itens_quantidade_check CHECK (quantidade > 0),
    CONSTRAINT itens_preco_check CHECK (preco_unitario >= 0)
);

-- =============================================================
-- TABELA: mensagens
-- Guarda conversas entre loja e cliente para pedidos e suporte.
-- Essa tabela ajuda a manter o chat do painel e da vitrine.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.mensagens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
    tipo_remetente VARCHAR(20) NOT NULL,
    remetente_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    mensagem TEXT NOT NULL,
    vista_pelo_comerciante BOOLEAN NOT NULL DEFAULT FALSE,
    vista_pelo_cliente BOOLEAN NOT NULL DEFAULT FALSE,
    fixada BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT mensagens_tipo_check CHECK (tipo_remetente IN ('customer', 'merchant'))
);

-- =============================================================
-- TABELA: avaliacoes
-- Guarda a avaliação feita pelo cliente após o pedido.
-- É usada para mostrar reputação e nota média da loja.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.avaliacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id UUID NOT NULL UNIQUE REFERENCES public.pedidos(id) ON DELETE CASCADE,
    loja_id UUID NOT NULL REFERENCES public.lojas(id) ON DELETE RESTRICT,
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
    valor SMALLINT NOT NULL,
    comentario TEXT,
    media_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT avaliacoes_valor_check CHECK (valor BETWEEN 1 AND 5)
);

-- =============================================================
-- ÍNDICES
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_lojas_merchant_id ON public.lojas(merchant_id);
CREATE INDEX IF NOT EXISTS idx_categorias_loja_id ON public.categorias(loja_id);
CREATE INDEX IF NOT EXISTS idx_produtos_loja_id ON public.produtos(loja_id);
CREATE INDEX IF NOT EXISTS idx_produtos_categoria_id ON public.produtos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_loja_id ON public.pedidos(loja_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_id ON public.pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_itens_pedido_pedido_id ON public.itens_do_pedido(pedido_id);
CREATE INDEX IF NOT EXISTS idx_itens_pedido_produto_id ON public.itens_do_pedido(produto_id);
CREATE INDEX IF NOT EXISTS idx_mensagens_pedido_id ON public.mensagens(pedido_id);
CREATE INDEX IF NOT EXISTS idx_mensagens_remetente_id ON public.mensagens(remetente_id);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_loja_id ON public.avaliacoes(loja_id);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_cliente_id ON public.avaliacoes(cliente_id);

-- =============================================================
-- TRIGGERS
-- =============================================================
CREATE TRIGGER comerciantes_set_updated_at
BEFORE UPDATE ON public.comerciantes
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER clientes_set_updated_at
BEFORE UPDATE ON public.clientes
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER lojas_set_updated_at
BEFORE UPDATE ON public.lojas
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER categorias_set_updated_at
BEFORE UPDATE ON public.categorias
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER produtos_set_updated_at
BEFORE UPDATE ON public.produtos
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER pedidos_set_updated_at
BEFORE UPDATE ON public.pedidos
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
