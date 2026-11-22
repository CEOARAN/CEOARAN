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

## Iteração técnica 2 — APIs de preço, domínio de pedidos e segurança

**Implementado em homologação (sem pedidos reais):**
- POST /api/checkout/quote — orçamento calculado pelo banco D1, sem confiar em preço, desconto ou frete enviado pelo navegador. Valida produtos disponíveis, quantidade, duplicações, origem e JSON.
- GET /api/store/config — confirma que pedidos, pagamentos e rastreamento real estão bloqueados.
- Rate Limiting Binding QUOTE_RATE_LIMIT — limite aproximado de 120 requisições por 60 segundos, por chave de cliente e localidade Cloudflare. Trata-se de proteção complementar, não de bloqueio distribuído rigoroso. O endereço IP usado na chave não é persistido no D1.
- Migrations/0002_commerce.sql — tabela de pedidos comerciais, itens, pagamentos, eventos, entregas, outbox e índices únicos. A migração foi aplicada, mas as tabelas comerciais seguem sem dados.
- Auditoria atômica de produtos via triggers SQL D1; a gravação de auditoria ocorre na própria alteração da linha.
- domain/order-machine.mjs — máquina de estados com regras de atores para cozinha, logística, pagamentos e reembolsos.
- integrations/mercadopago.mjs — validação de assinatura HMAC, valor, moeda, conta recebedora e referências; ainda não gera Pix nem processa webhook real.
- security/customer-crypto.mjs — AES-256-GCM com nonce aleatório, dados mínimos autorizados e contexto criptográfico vinculado ao ID do pedido. Não é utilizado em captação de dados reais neste ambiente.
- security/idempotency.mjs — hashes HMAC por operação para futuras chamadas financeiras idempotentes.
- openapi.json — contrato machine-readable das rotas públicas e administrativas.

**Testes reproduzíveis (Node >=20, sem pacotes de terceiros):**
    cd ck-sushi-demo/backend
    npm test
    npm run build
    npm run smoke

A etapa de homologação já testou os contratos via navegador e API Cloudflare. Não há configuração de credenciais, login administrativo ou dados pessoais no código.

**Bloqueios obrigatórios antes de produção:** Cloudflare Access com MFA e identidades autorizadas; contrato do restaurante como controlador (conforme análise fática); aviso de privacidade, retenção, direitos e revisão jurídica; conta Mercado Pago do restaurante e homologação Pix; habilitação efetiva da logística iFood; WAF, backups e restauração; testes de segurança, monitoramento e plano de resposta a incidentes.

Sem isso, pedidos e pagamentos continuarão HTTP 503.


## Integração iFood — validação preparada

O módulo integrations/ifood.mjs interpreta cotações oficiais de entrega externa (On-Demand Off Platform), verifica validade temporal, quantidade em centavos, distância, prazo estimado e garante que o rastreamento pertença ao domínio HTTPS meupedido.ifood.com.br. Os dados são derivados da documentação oficial https://developer.ifood.com.br/en-US/docs/food/guides/modules/shipping/outside .

A API exige acesso e elegibilidade aprovados pelo iFood; em staging o módulo NÃO solicita entregadores, não transmite endereços, não faz tracking ou cobranças, nem recebe dados pessoais. O frete do checkout permanece desconhecido até cotação autorizada.

Testes automáticos: tests/ifood.test.mjs. O módulo participa do build do Worker, mas nenhuma rota de despacho está ativa.

## Integração Mercado Pago — preparo da reunião (Orders API Pix)

A Orders API é a opção recomendada pelo Mercado Pago para novas integrações Checkout Transparente. A antiga Payments API permanece apenas como validador legado. **Nenhum pagamento foi ativado**.

Documento operacional: **[Plano da CEOARAN, plano do cliente e roteiro da reunião](operations/PLANO_OPERACAO_MERCADO_PAGO.md)**.

### Componentes adicionados ao backend
- `integrations/mercadopago-orders.mjs`: prepara payload Pix Orders e reconcilia referência, valor, usuário vendedor e status da resposta do provedor. Sem saída de rede e sem gerar cobranças.
- `integrations/mercadopago-test-webhook.mjs`: valida assinatura, aplicação e sandbox; armazena apenas um hash temporário para deduplicar o evento. Nunca altera pedidos/pagamentos.
- `GET /api/admin/integrations/mercadopago`: autenticado via Cloudflare Access e retorna apenas indicadores de configuração, nunca valores de credenciais.
- `POST /api/webhooks/mercadopago/test`: endpoint HTTPS específico de TESTE; sem secrets retorna 503. Quando configurado, só reconhece eventos de teste assinados.

### Configuração segura, apenas no staging
- `MP_TEST_ACCESS_TOKEN` — **Secret** obtido no ambiente Teste da aplicação do restaurante.
- `MP_TEST_WEBHOOK_SECRET` — **Secret** gerado no formulário de Webhooks de Teste.
- `MP_TEST_APPLICATION_ID` — variável comum com o identificador da aplicação.
- `MP_TEST_MERCHANT_ID` — variável opcional para verificação futura do titular recebedor.

**Produção NÃO está configurada.** Criar Worker e banco independentes somente depois dos testes e da revisão jurídica. Administradores do Worker podem executar código que tenha acesso a Secrets em runtime; isso exige segregação de privilégios e contrato, mesmo que a pessoa não conheça a senha bancária do cliente.

Fontes: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/overview • https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix • https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications • https://developers.cloudflare.com/workers/configuration/secrets/

## Rotina automática de retenção dos webhooks de teste

O Worker de homologação possui `scheduled()` vinculado ao agendamento Cloudflare `0 3 * * *` (03:00 UTC, 00:00 em São Paulo).

- A tarefa executa `jobs/staging-maintenance.mjs`: verifica que não existem pedidos, pagamentos ou jobs comerciais no staging; em seguida remove apenas fingerprints de webhook com `expires_at` vencido.
- Os IDs originais de eventos, dados do comprador e o corpo de webhook não são persistidos nessa tabela. A rotina registra a contagem de hashes expirados removidos em `maintenance_runs`.
- A configuração do Cron Trigger foi confirmada por API em 21/11/2026. A primeira execução real dependerá do próximo horário após a propagação da Cloudflare; **a execução agendada ainda não foi observada** nesta implantação.
- Não reaproveitar esta tarefa como política completa de retenção para pedidos reais. Produção exige inventário LGPD, prazos por finalidade e testes de exclusão.
- O D1 disponibiliza Time Travel/recuperação pontual (Free: 7 dias; Paid: 30 dias). Antes de produção, definir exportação independente, testar restauração e documentar RPO/RTO. Fonte: https://developers.cloudflare.com/d1/reference/time-travel/

**Segurança de segredos:** após cadastrá-los no Cloudflare, revisar o procedimento de deploy para preservar os bindings existentes, conferir nomes e evitar expor valores. No momento não há credenciais Mercado Pago instaladas; o Worker de staging só aceita simulações assinadas após configuração. O CI de GitHub compila e testa, mas não executa deploy nem troca Secrets.


## Migração 0005 — integridade financeira (22/11/2026)

- Migrada para a base D1 de homologação após conferir ausência de pedidos e pagamentos. Não liga comércio.
- Novos triggers: `commerce_order_financial_snapshot_immutable`, `commerce_order_line_delete_guard`, `commerce_payment_financial_snapshot_immutable` e `commerce_payment_delete_guard`.
- Valores, moeda, entrega, vínculo e referência de pedidos ficam imutáveis após persistência; itens de pedidos não podem ser excluídos diretamente.
- Identificadores do provedor podem ser preenchidos uma única vez, e alterações posteriores ficam bloqueadas.
- Registros financeiros não podem ser apagados diretamente até existir procedimento de retenção/descarte juridicamente aprovado. O processo de descarte deverá ser especificado antes da produção.
- O endpoint `/api/health/ready` verifica os nomes exatos dos **15 gatilhos de segurança obrigatórios**, a versão 5 do esquema e os bloqueios comerciais; contar apenas gatilhos por prefixo era insuficiente.
- `tests/schema-integrity.test.mjs` usa SQLite local, somente com dados sintéticos e sem rede, para exercitar migrações e tentativas de adulteração. Executa no Node 22+; não modifica o D1.
- Primeiro cron de limpeza de fingerprints observado: **22/11/2026 às 03:00:32 UTC**, resultado `success`, 0 fingerprints expirados. Não é prova de política completa de retenção.
- Permanecem pendentes: Cloudflare Access, dados e documentos do cliente, provedor Pix de teste, logística iFood, operação de reembolsos, restauração de backup validada e aceite jurídico.

## Iteração de confiabilidade — V7 (22/11/2026)

- `domain/outbox.mjs` inclui `recoverExpiredOutboxLeases`: tarefas cuja oitava tentativa foi interrompida e cujo lease expirou passam a `failed`, com erro genérico `OUTBOX_LEASE_EXHAUSTED`; tarefas em lease ativo e tarefas ainda recuperáveis permanecem intactas.
- A recuperação é limitada por lote (1–500), valida o relógio, confere o número de registros afetados e não envia requisições a provedores.
- O código de recuperação **não está ligado ao cron ou a rotas HTTP**. A base de homologação não aceita criar tarefas de entregas/pagamento.
- Novos testes em SQLite isolado (`tests/outbox-recovery.test.mjs` e `tests/order-persistence-sqlite.test.mjs`) verificam recuperação de tarefas, versões otimistas, eventos atômicos, replay idempotente e rollback de pedido se o preço do produto mudar.
- O CI usa Node 22 para executar os testes SQLite reais. Em Node 20, esses testes são ignorados por falta do módulo `node:sqlite`; as demais verificações continuam.
- **Ainda pendente para produção:** exercício da fila em execução distribuída, observabilidade dos processadores, testes de carga/recuperação, integrações e credenciais legítimas dos provedores, Cloudflare Access e validações LGPD.
