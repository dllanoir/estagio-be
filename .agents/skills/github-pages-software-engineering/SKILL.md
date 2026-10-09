---
name: github-pages-software-engineering
description: "Padrão de engenharia de software, system design e arquitetura limpa (Clean Architecture) para desenvolvimento de aplicações web modernas hospedadas no GitHub Pages com GitHub Actions."
---

# GitHub Pages Software Engineering & Architecture Skill

Esta habilidade orienta o assistente e equipes no design, estruturação, desenvolvimento e manutenção de aplicações web modernas, modulares e de nível sênior hospedadas no **GitHub Pages** utilizando **GitHub Actions** para automação de CI/CD.

---

## 1. Princípios Fundamentais (System Design no GitHub Pages)

O **GitHub Pages** é uma infraestrutura de hospedagem de arquivos estáticos (Jamstack/CDN global). Ele **não** possui um servidor de aplicação em tempo de execução (como Node.js, Express, PHP ou Python). Qualquer lógica de backend dinâmico, banco de dados ou autenticação deve ser tratada através de serviços de nuvem externos (ex: Supabase, Firebase, APIs REST/GraphQL).

### Pilares de Engenharia:
1. **Zero-Trust Backend Security (Row Level Security):**
   - O código frontend (HTML, JS, CSS) é público por definição no navegador.
   - A segurança dos dados **nunca** depende de esconder URLs ou variáveis de ambiente de compilação.
   - A segurança reside no banco de dados (ex: Supabase Postgres RLS), onde requisições sem JWT autenticado retornam `0` registros (`[]`).
2. **Client-Side Auth Guard (Gatekeeper Pré-Renderização):**
   - Um script leve e síncrono no `<head>` verifica tokens locais antes de processar ou pintar o `<body>`.
   - Estilo anti-flash (`body { visibility: hidden !important; }`) previne vazamento visual de layouts antes do redirecionamento para a tela de autenticação.
3. **Resiliência Offline-First & Armazenamento Híbrido:**
   - **L1 (Memória / LocalStorage):** Alta reatividade (0ms latência) para estado imediato da interface.
   - **L2 (IndexedDB):** Persistência de alta capacidade (suporta centenas de megabytes e gigabytes) para evitar erros de `QuotaExceededError` (o LocalStorage é limitado a ~5MB).
   - **L3 (Cloud Database):** Sincronização assíncrona bidirecional com fila de mutações offline (`offline mutation queue`).
4. **Build Automatizado e Otimizado (Vite Bundler):**
   - Usar **Vite** em vez de monolitos de arquivo único.
   - Minificação de assets, tree-shaking, geração de hashes para controle de cache (`main.[hash].js`), e separação de chunks.
   - Caminhos relativos (`base: './'`) para compatibilidade perfeita com subdiretórios do GitHub Pages (`https://usuario.github.io/repositorio/`).

---

## 2. Estrutura Padrão de Diretórios (Clean Frontend Architecture)

Para qualquer aplicação escalável no GitHub Pages, siga rigorosamente esta estrutura:

```
projeto/
├── .github/
│   └── workflows/
│       ├── deploy.yml            # Pipeline de Build & Deploy no GitHub Pages
│       └── ci.yml                # Quality gate: validação de build e linter em PRs
├── public/                       # Arquivos estáticos servidos diretamente
│   └── favicon.svg
├── src/
│   ├── config/                   # Configurações globais e inicialização de SDKs
│   │   ├── env.js                # Chaves públicas, URLs e endpoints
│   │   └── constants.js          # Constantes de domínio, enums e cores
│   ├── domain/                   # Regras de Negócio e Modelos (Isolados do DOM)
│   │   ├── [entidade].js         # Validações, normalizações e lógica pura
│   │   └── validators.js         # Validadores de schema e campos
│   ├── services/                 # Comunicação externa e persistência
│   │   ├── auth.service.js       # Gerenciamento de sessão, login e logout
│   │   ├── db.service.js         # Queries e mutações na nuvem (Supabase REST)
│   │   ├── storage.service.js    # IndexedDB e LocalStorage unificados
│   │   └── sync.service.js       # Sincronização híbrida e fila offline
│   ├── ui/                       # Componentes de interface e renderização DOM
│   │   ├── components/           # Componentes reutilizáveis (botões, cards, modais)
│   │   ├── views/                # Telas e painéis principais
│   │   └── state.js              # Gerenciador de estado reativo da interface
│   ├── styles/                   # CSS Modular estruturado
│   │   ├── tokens.css            # Variáveis CSS (cores, tipografia, espaçamentos)
│   │   ├── reset.css             # Normalização base
│   │   ├── layout.css            # Shell, grid e sidebars
│   │   └── components.css        # Estilos dos componentes visuais
│   ├── utils/                    # Funções utilitárias puras
│   │   ├── date.js               # Formatação e cálculo de datas
│   │   ├── text.js               # Sanitização HTML e normalização de busca
│   │   └── export.js             # Exportação CSV/PDF e download de arquivos
│   ├── main.js                   # Ponto de entrada da aplicação principal
│   └── login.js                  # Ponto de entrada da página de autenticação
├── index.html                    # Template limpo da aplicação principal
├── login.html                    # Template limpo da tela de login
├── vite.config.js                # Configuração do bundler Vite
├── package.json                  # Dependências e scripts npm
└── README.md                     # Documentação técnica e arquitetural
```

---

## 3. Padrão de Configuração do Vite (`vite.config.js`)

O GitHub Pages frequentemente serve aplicações sob um subcaminho (`https://<user>.github.io/<repo>/`). Para garantir que links e scripts carreguem corretamente em qualquer ambiente:

```javascript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Garante que todos os assets gerados utilizem caminhos relativos
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html')
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
});
```

---

## 4. Pipeline de CI/CD no GitHub Actions (`.github/workflows/deploy.yml`)

Utilize as actions oficiais mantidas pelo GitHub para deploy no GitHub Pages:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches:
      - main
      - master
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: true

jobs:
  build-and-deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout código
        uses: actions/checkout@v4

      - name: Configurar Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Instalar dependências
        run: npm ci

      - name: Compilar projeto (Vite build)
        run: npm run build

      - name: Configurar GitHub Pages
        uses: actions/configure-pages@v5

      - name: Enviar artefato estático (dist)
        uses: actions/upload-pages-artifact@v3
        with:
          path: 'dist'

      - name: Publicar no GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

---

## 5. Diretrizes de Clean Code para Aplicações Frontend Vanilla

1. **Sem Poluição de Escopo Global (`window`):**
   - Exportar funções e classes explicitamente em módulos ES (`export const ...`).
   - Importar apenas o necessário (`import { ... } from './services/auth.service.js'`).
2. **Funções Puras no Domínio:**
   - Funções que calculam prazos, normalizam registros ou filtram dados não devem acessar o DOM diretamente. Elas recebem dados e retornam novos dados.
3. **Desacoplamento de Dados e Renderização:**
   - Serviços (`services/`) não alteram elementos da página (`document.getElementById`). Eles apenas comunicam com a rede ou armazenamento e retornam promessas.
   - Componentes de UI (`ui/`) escutam alterações de estado e atualizam os elementos do DOM.
4. **Sanitização Obrigatória (Prevenção contra XSS):**
   - Sempre sanitizar HTML e texto antes de injetar via `innerHTML`.
   - Utilizar escape de entidades (`&`, `<`, `>`, `"`) para textos dinâmicos de usuários.
5. **Tratamento Resiliente de Erros:**
   - Toda chamada assíncrona deve conter blocos `try/catch` com fallback elegante e notificações claras (Toasts) para o usuário em vez de quebrar a página silenciosamente.
