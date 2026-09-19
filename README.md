# PedeIA

Projeto independente de pedidos por link para restaurantes, lanchonetes, lojas e outros comércios locais.

## Conceito

O comerciante configura sua loja, categorias e produtos no painel. O PedeIA gera um link público exclusivo, como `?loja=brasa-e-massa`. O cliente entra por esse link, vê somente aquela loja, monta a sacola e envia os dados de entrega e pagamento.

O cliente não cria conta nem faz cadastro. Cada comércio possui um identificador público persistente no link. O painel deixa esse link visível na lateral, no dashboard e na tela **Minha loja**, com ação para copiar e enviar pelo WhatsApp.

## Estrutura do projeto

- `app.js`: lógica principal da interface e do painel
- `server.js`: servidor local para servir a aplicação
- `database.js`: conexão com PostgreSQL/Supabase
- `schema.sql`: estrutura das tabelas em português
- `styles/`: estilos organizados por área da aplicação
- `js/`: arquivos do cliente e integrações externas

## Rodar

```powershell
npm start
```

Abra `http://localhost:4173` para o painel. Clique em **Ver minha loja** ou use `?loja=brasa-e-massa` para a vitrine do cliente.

A primeira versão usa autenticação do Supabase e persistência em banco. Todo o código deste projeto, incluindo servidor, frontend e documentação, está dentro desta pasta `PedeIA`.

## Publicar no GitHub e Render

Envie o conteúdo desta pasta para um repositório próprio chamado `pedeia`. Não envie `node_modules` nem arquivos `.env`.

No Render, crie um **Web Service** conectado ao repositório e use:

- **Runtime:** Node
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Health Check Path:** `/api/health`

Se o repositório tiver somente os arquivos desta pasta, não preencha **Root Directory**. Se você enviar a pasta maior contendo `PedeIA`, use `PedeIA` como **Root Directory**.

Depois do deploy, teste `https://SEU-APP.onrender.com/api/health`. A resposta esperada é:

```json
{"ok":true,"service":"pedeia"}
```

O arquivo `render.yaml` já guarda essa configuração para o deploy automático pelo Render Blueprint.

## Aprovação de novos comerciantes

Execute `schema.sql` e `supabase-rls.sql` no Supabase. O formulário **Criar conta** cria o usuário no Auth e registra os dados em `solicitacoes_acesso` com status `pending`; ele não cria a loja nem libera o painel automaticamente.

Para aprovar uma solicitação, o responsável deve conferir a linha no Supabase, criar o registro correspondente em `comerciantes` e atualizar o status para `approved`. Depois, o comerciante poderá entrar e concluir os dados da loja no painel.

O Supabase Auth pode enviar automaticamente o e-mail de confirmação configurado no projeto. Para enviar um e-mail próprio quando o status mudar para `approved`, use uma Edge Function ou serviço SMTP disparado por webhook do Supabase; a chave administrativa não deve ser colocada no frontend.

Se aparecer `email rate limit exceeded` ao criar uma conta, o limite de envio do e-mail de confirmação do Supabase foi atingido. Aguarde o período de bloqueio e evite clicar várias vezes no cadastro. Para produção, configure um SMTP próprio em **Supabase > Authentication > SMTP Settings**, pois o SMTP padrão possui limite baixo.

Se aparecer `Error sending confirmation email`, o provedor de e-mail do Supabase está ausente ou configurado incorretamente. Confira **Authentication > SMTP Settings**, valide host, porta, usuário, senha e remetente, e use **Send test email**. Durante testes, também é possível desativar **Confirm email** em **Authentication > Providers > Email**, mas em produção é recomendado manter a confirmação ativa com SMTP próprio.
