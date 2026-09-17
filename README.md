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
