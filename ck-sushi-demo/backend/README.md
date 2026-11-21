# CK Sushi backend/admin — homologação

## Arquitetura
- Origem atual: Cloudflare Worker `ck-sushi-backend-staging`, com D1 `ck-sushi-staging` via binding `CATALOG_DB`.
- Código versionado: `worker.js`, `admin.html`, `admin.js`, `admin.css`, `migrations/0001_init.sql`, `build.mjs`.
- `node backend/build.mjs` monta `backend/dist/worker.js` incluindo o front já existente em `ck-sushi-demo/index.html`. O script não modifica o frontend de produção.
- Os assets do painel são empacotados na camada de build, nunca originados de entradas não confiáveis.
- O `index.html` atual é fallback estático na homologação. A consulta `/api/catalog` carrega os dados D1 usando a mesma origem.
- Alterações do painel afetam somente a base de homologação.

## URLs do ambiente de testes
- `/`: demonstração de vitrine integrada à API.
- `/admin`: painel administrativo; a leitura do catálogo é pública, todas as gravações exigem identidade verificada no servidor.
- `/api/health`: saúde do serviço sem dados pessoais.
- `/api/catalog`: catálogo público.
- `/api/admin/session`, `/api/admin/summary`, `/api/admin/products`, `/api/admin/audit`: protegidas por Access.
- `/api/orders`, `/api/checkout`, `/api/payments*`: 503; não captam dados pessoais.

## Configuração obrigatória ANTES de acesso administrativo
A consulta à API da Cloudflare em 21/11/2026 retornou `access.api.error.not_enabled`; Cloudflare Zero Trust/Access não está habilitado nesta conta. **Não há senha de emergência, conta padrão ou bypass**.

1. Ativar e configurar Cloudflare Zero Trust/Access no painel de administração do cliente.
2. Configurar aplicação Access de identidade para o hostname de homologação. Aplicar política Allow apenas a e-mails administrativos aprovados, preferencialmente com MFA e restrição de sessão.
3. Anotar o team name do Access (não a URL inteira) e o AUD da aplicação.
4. Configurar as variáveis do Worker `ACCESS_TEAM_NAME`, `ACCESS_AUD`, `ACCESS_OWNER_EMAILS` e, se aplicável, `ACCESS_EDITOR_EMAILS`. E-mails separados por vírgula; evitar contas compartilhadas.
5. Testar usuário autorizado e não autorizado. O Worker valida assinatura RS256, issuer, audience, expiração, usuário permitido, origem e header anti-CSRF. Identificar e registrar responsáveis por provisionamento/revogação.
6. **Nunca** inserir chaves/tokens ou dados de clientes nos arquivos do GitHub.

Sem Access funcional e lista de e-mails, a API bloqueia operações com 503/401/403. Não publicar um login alternativo sem testes equivalentes.

## Segurança de dados e operação
- Usar SQL parametrizado nas rotas. Preços persistidos em centavos.
- Toda alteração usa versão otimista para evitar conflitos, e registra usuário/ação na auditoria.
- D1 possui tabelas estruturais para futuros pedidos, incidentes e direitos dos titulares; **essas rotinas não estão ativas**.
- Não há chaves de pagamento, integrações Pix, fornecedor de entregas nem webhooks ativos.
- Antes de tornar reais pedidos e dados de clientes, concluir `SECURITY_LGPD_CHECKLIST.md`, política de tratamento e retenção, criptografia de campos pessoais, canais de direitos, backup/restauração, controles antifraude, conciliação, PSP e testes de segurança.
- Testes não destrutivos: `node backend/tests/api-smoke.mjs`. Eles verificam que rotas administrativas não autenticadas e pedidos reais são recusados.

## Dados de teste
Os 103 produtos são dados públicos coletados do menu original e não foram aprovados formalmente pelo estabelecimento para uso comercial. Confirmar promoções e autorização de imagens. Não migrar dados pessoais do cliente para staging.

## Regressão e publicação
O Worker atual de demonstração `ck-sushi-demo` **não é alterado** por este serviço de homologação. Nunca aplicar o banco `ck-sushi-staging` ao ambiente de produção. Para publicar um novo build, validar os testes, a política Access e o diff da migração antes de atualizar o Worker.