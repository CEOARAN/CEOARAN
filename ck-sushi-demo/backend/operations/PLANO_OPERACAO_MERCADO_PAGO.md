# CK Sushi × Mercado Pago — Plano de operação da integração Pix

**Projeto:** CK Sushi Delivery / **Executora técnica:** CEOARAN
**Revisão:** 21/11/2026 — plano de homologação, não autorização para cobranças reais.
**Arquitetura recomendada em 2026:** Mercado Pago **Checkout Transparente — Orders API**, pagamento Pix (`POST /v1/orders`). A API de Payments continua suportada para integrações existentes, mas o fornecedor recomenda Orders para novos projetos.

> O dono da conta Mercado Pago é a CK Sushi. A CEOARAN não precisa de senha, acesso ao saldo, chaves Pix bancárias nem de conta compartilhada. O cliente configura os dados financeiros **sozinho antes da reunião**. Chaves de API e assinatura devem entrar diretamente em Cloudflare Secrets ou pelo mecanismo oficial e revogável "Compartilhar credenciais com um desenvolvedor", nunca em WhatsApp, e-mail, chat, planilhas, código, prints ou gravações.

## 1. Plano do CLIENTE — o que ele prepara sozinho ANTES da reunião

- [ ] Entrar na conta Mercado Pago do próprio restaurante, autenticação de dois fatores ativa, titularidade correta.
- [ ] Finalizar dados cadastrais exigidos para recebimento (pessoa responsável, dados empresariais, situação da conta).
- [ ] Confirmar que a conta pode receber por Pix, cadastrando a **chave Pix no Mercado Pago** diretamente. **Chave Pix bancária ≠ Public Key/Access Token de API**.
- [ ] Conferir sozinho conta de liquidação, taxas, recebimento, limites, saques e eventuais verificações do Mercado Pago.
- [ ] Escolher quem será o responsável interno por reembolsos, estornos, reclamações e conciliação.
- [ ] Preparar o nome comercial, site de referência, setor de atuação e canais de suporte que poderão ser solicitados ao ativar a aplicação.
- [ ] Providenciar computador com navegador atualizado, acesso à conta Mercado Pago e acesso ao e-mail/2FA; jamais fornecer senha ou códigos OTP à CEOARAN.
- [ ] Solicitar que o cliente **não projete/compartilhe** tela de saldo, dados bancários, token completo ou QR Pix pessoal durante a chamada.
- [ ] Não criar pagamentos reais nem habilitar produção antecipadamente.

**O que o cliente NÃO deve passar:** senha, confirmação por aplicativo, códigos 2FA, cartão, dados bancários completos, login de administração da conta e saldo.

### Resultado esperado do cliente
Conta empresarial preparada, verificações de recebimento e chave Pix concluídas, sem conceder a terceiros controle financeiro.

## 2. Plano da CEOARAN — preparação técnica ANTES da reunião

- [x] Worker de homologação: `ck-sushi-backend-staging` + D1 isolado `ck-sushi-staging`.
- [x] 103 produtos; consulta de preços pelo servidor; checkout demonstrativo incapaz de cobrar.
- [x] Migrações de pedidos e pagamentos, auditoria e travas de transações reais no D1.
- [x] Verificador de assinatura HMAC e idempotência para eventos de Mercado Pago.
- [x] Adaptador puro de **Orders API Pix** no repositório (`integrations/mercadopago-orders.mjs`) com validação de comerciante, referência e montante.
- [x] Endpoint específico para **notificações de teste**, com assinatura válida e deduplicação, que **não aprova pedidos ou movimenta dinheiro**:
  `https://ck-sushi-backend-staging.ceoaran-dev.workers.dev/api/webhooks/mercadopago/test`
- [x] Endpoint de situação da configuração, protegido pela autenticação administrativa:
  `GET /api/admin/integrations/mercadopago` — informa apenas se cada componente foi configurado, **nunca revela valores**.
- [ ] Habilitar Cloudflare Access / Zero Trust com MFA e usuários aprovados. Atualmente Access não está ativado nessa conta; portanto a consulta administrativa fica fechada.
- [ ] Validar aprovações contratuais e de privacidade: controlador e operador, política de retenção, prestador, resposta a incidentes.
- [ ] Planejar produção **separada** de staging, com domínio definitivo, banco próprio e aceite formal do restaurante.
- [ ] Garantir que o webhook de produção não use a URL de staging, e que nenhum secret de produção seja salvo nos Workers de demonstração.
- [ ] Preparar testes de transação duplicada, idempotência, timeout, estorno, concorrência, adulteração de total, fraude e conciliação.

### Nomes EXATOS das configurações na Cloudflare

| Ambiente | Nome | Tipo | Origem / finalidade | Situação |
|---|---|---|---|---|
| Homologação | `MP_TEST_ACCESS_TOKEN` | **Secret** | App do cliente > Teste > Credenciais > Access Token | **Não cadastrado** |
| Homologação | `MP_TEST_WEBHOOK_SECRET` | **Secret** | App > Teste > Configuração de Webhooks > Assinatura secreta | **Não cadastrado** |
| Homologação | `MP_TEST_APPLICATION_ID` | Variável simples | Identificador da aplicação criada pelo cliente | **Não cadastrado** |
| Homologação | `MP_TEST_MERCHANT_ID` | Variável simples (quando necessário) | Identificação do vendedor, para conciliação | **A validar** |
| Produção, **em outro Worker** | `MP_PROD_ACCESS_TOKEN` | **Secret** | App > Produção > Credenciais > Access Token | **Não cadastrar até homologação** |
| Produção, **em outro Worker** | `MP_PROD_WEBHOOK_SECRET` | **Secret** | App > Produção > Configuração de Webhooks | **Não cadastrar até homologação** |
| Produção | `MP_PROD_APPLICATION_ID` | Variável simples | Identificador da aplicação | **A validar** |

A **Public Key** não é segredo. Para Pix pela Orders API com chamadas exclusivamente no servidor, o Access Token é o segredo essencial. Se usarmos no futuro MercadoPago.js, um Brick ou cartão, a Public Key de cada ambiente será incorporada apenas ao frontend adequado, nunca o Access Token. **Client ID/Client Secret são relevantes para fluxos como OAuth** e não precisam ser solicitados para uma integração direta de um único restaurante, salvo exigência específica do provedor.

## 3. Plano CONJUNTO — roteiro para a reunião, em ordem

### Bloco A — confirmar conta e titularidade
1. Cliente acessa [Mercado Pago Developers — Integrações](https://www.mercadopago.com.br/developers/panel/app).
2. Confirmamos que ele está na conta **dele**, não em conta CEOARAN; não olhamos saldos nem tela bancária.
3. Confirmamos que a chave Pix e o cadastro empresarial já foram preparados **antes**, pelo próprio cliente.
4. Confirmamos se já existe uma aplicação para CK Sushi; se sim, revisar para evitar duplicar integrações.

### Bloco B — criar a aplicação (cliente na tela, CEOARAN orienta)
5. Em **Integrações / Suas integrações**, selecionar **Criar aplicação** ou fluxo equivalente do Painel de integração.
6. Preencher nome identificável: **CK Sushi Delivery — Site próprio** (nome sugerido, confirmar com o cliente).
7. Selecionar pagamento on-line, **Checkout Transparente / Orders API** se a tela apresentar opções; seguir o assistente oficial.
8. Registrar o **Application ID** (não é senha). Não copiar Client Secret sem necessidade.
9. Em caso de perguntas sobre o site, informar o **domínio definitivo real** quando disponível, não inventar um domínio comercial. Para testes, usar o endpoint HTTPS de homologação quando a tela pedir URL de testes.

### Bloco C — credenciais de TESTE, diretamente no Cloudflare
10. No Mercado Pago, abrir a aplicação > seletor **Teste** > **Credenciais** (ou Início > Credenciais).
11. Localizar o **Access Token de teste** e conferir visualmente o seletor **Teste**; não copiar a chave de produção por engano.
12. No Cloudflare: **Workers & Pages > ck-sushi-backend-staging > Settings > Variables and Secrets > Add**.
13. Selecionar **Secret**, nome `MP_TEST_ACCESS_TOKEN`. **O cliente cola o valor no campo protegido**, sem expor a tela/clipboard a gravações; salvar/deploy da configuração.
14. Voltar ao Mercado Pago, localizar o **Application ID** e configurar `MP_TEST_APPLICATION_ID` como variável simples, sem revelar credenciais.
15. A Public Key de teste é opcional para o Pix server-side por Orders; guardar apenas se o componente frontend escolhido exigir.

### Bloco D — Webhook de TESTE
16. Na aplicação, selecionar **Configuração de Webhooks**, modo **Teste**.
17. Cadastrar a URL:
`https://ck-sushi-backend-staging.ceoaran-dev.workers.dev/api/webhooks/mercadopago/test`
18. Selecionar **Order (Mercado Pago)** / tópico `order` (não `payment` legado, se usamos Orders API).
19. Salvar. Revelar a **Assinatura secreta** e cadastrar diretamente como Secret Cloudflare `MP_TEST_WEBHOOK_SECRET`.
20. Simular notificação no Painel Mercado Pago. Validar resposta **HTTP 200** e comportamento de requisição repetida; o callback confirma assinatura e deduplica, mas **não muda pagamentos/pedidos**.
21. Se a notificação falhar, conferir Application ID, seleção Teste, URL HTTPS e segredo; jamais desativar HMAC como atalho.

### Bloco E — teste Pix e homologação
22. Usar o ambiente **Teste** e o exemplo oficial Pix Orders API; a documentação menciona um cenário com `payer.first_name = APRO` para simulação predefinida. Não realizar Pix real.
23. Conferir `external_reference`, valor decimal coerente com o total do pedido, `X-Idempotency-Key` e resposta da API `POST /v1/orders`; consultar ordem pela API `GET /v1/orders/{id}`.
24. Confirmar que webhook, valor, beneficiário, status aprovado e idempotência são verificados **no servidor**; não confirmar um pedido apenas por mensagem do navegador ou QR.
25. Simular evento repetido e ordem pendente. Conferir reembolso e conciliação do lado do fornecedor, antes de liberar transações.
26. Registrar aceite da homologação em checklist, **sem** salvar os valores dos tokens.

### Bloco F — produção (outra ocasião, após homologação)
27. Cliente acessa aplicação > **Credenciais** > **Produção** > **Ativar ambiente de produção**, preenche setor e site e aceita os termos **ele mesmo**.
28. Cliente confirma dados empresariais, chave Pix, taxa e condições; a CEOARAN não precisa de acesso financeiro.
29. Somente após verificação jurídica, antifraude, identidade e testes, criar **Worker de produção separado**, com `MP_PROD_ACCESS_TOKEN` e `MP_PROD_WEBHOOK_SECRET` em Secrets, banco próprio e política de acesso.
30. Configurar URL de webhook **de produção**, separada da de teste; não reaproveitar a URL staging.
31. Realizar microtransação real apenas com consentimento expresso, registrar conciliação e estorno, confirmar recebimento pela própria tela do cliente.
32. Após testes finais e assinatura do aceite, habilitar recursos gradualmente. **Jamais simplesmente mudar flags em staging e chamar de produção**.

## Quadro de responsabilidade / aceite

| Marco | Cliente | CEOARAN | Aprovação |
|---|---|---|---|
| Cadastro empresarial, chave Pix, recebimento | Faz antes, sozinho | Não acessa | Cliente |
| Aplicação e integração correta | Cria em conta própria | Direciona e confere | Ambos |
| Credenciais de teste | Fornece de forma segura/digita em Secret | Configura binding e valida sem exibir | Ambos |
| Webhook de teste | Configura aplicação e gera segredo | Constrói/verifica callback | Ambos |
| Testes de simulação | Acompanha na própria aplicação | Executa casos técnicos | Ambos |
| Avisos LGPD, contrato e política de retenção | Aprova com responsável jurídico | Implementa e documenta medidas | Jurídico + ambos |
| Produção, Pix real e cobrança | Aprova explicitamente | Publica ambiente separado e monitora | Ambos |

## Perguntas de conferência na reunião

1. A conta Mercado Pago do restaurante está completa e apta a receber por Pix?
2. O cliente quer **somente Pix** nesta fase? (Escopo recomendado inicial: apenas Pix.)
3. Já existe aplicativo próprio para a CK Sushi ou criaremos novo?
4. O site já possui domínio definitivo? Caso contrário, não ativar produção.
5. Qual é o responsável por reembolso, contestação, conciliação e suporte?
6. O cliente entendeu quais dados mínimos do comprador serão enviados ao Mercado Pago e aceitou os avisos legais?
7. O cliente deseja administrar a infraestrutura na própria conta Cloudflare ou autoriza formalmente a hospedagem na conta CEOARAN?
8. O cliente confirma que senhas, 2FA, saldo e banco ficam exclusivamente com ele?

## Atenção: titularidade financeira e infraestrutura

**Ter a aplicação e a conta bancária em nome do cliente não impede que um Access Token de produção seja usado pelo administrador do código que o acessa em runtime.** Se o Worker e o código estiverem sob uma conta Cloudflare administrada pela CEOARAN, a empresa operadora terá capacidade técnica de executar chamadas de pagamento via token, mesmo sem saber a senha do Mercado Pago ou visualizar o saldo no aplicativo.

Por isso, para produção, a opção de menor dependência é: **Cloudflare em conta controlada pelo cliente**, papéis de equipe com privilégios mínimos para a CEOARAN, credenciais guardadas como Secret, revisão de mudanças e contrato formal de prestação de serviços com responsabilidade, revogação e auditoria. Se o cliente escolher operar em infraestrutura CEOARAN, isso precisa de **consentimento comercial explícito, responsabilidades documentadas, restrição de acessos e revisão jurídica**. Não prometer ausência absoluta de acesso financeiro apenas porque o token está em Secret.

Na chamada de configuração: o cliente deve inserir os valores em campo protegido **de preferência dentro da própria conta Cloudflare**, sem compartilhar a tela enquanto o token está visível. A CEOARAN orienta os menus e os nomes de variáveis. Nenhuma credencial deve ser transcrita para chat ou nota de reunião.

## Regras de segurança inegociáveis

- Não colocar tokens em GitHub, logs, query strings, frontend, IA/chat, e-mail, gravações, prints ou planilhas.
- Secrets devem ser digitados pelo titular em campo protegido. Se usar **Compartilhar credenciais com desenvolvedor**, fazer pela função oficial com acesso revogável, nunca por cópia de senha.
- Não usar `MP_PROD_ACCESS_TOKEN` em staging; não usar credenciais de teste para receber dinheiro real.
- A idempotência é obrigatória para qualquer criação de order (`X-Idempotency-Key`).
- Webhook é aviso de mudança, não prova suficiente do dinheiro. Consultar a Orders API autenticada; comparar conta recebedora, referência, valor, status e pagamento.
- No staging atual, mesmo com credenciais de teste, o webhook **somente valida e responde**, sem criar Pix ou pedidos.
- Não armazenar identificações pessoais de compradores sem base legal, finalidade, segurança, retenção e direitos devidamente implementados.
- O envio de dados pessoais à API e a hospedagem em serviços internacionais devem constar do mapeamento LGPD e dos contratos.
- A aplicação e as credenciais pertencem ao restaurante, com revogação/rotação após encerramento do contrato.

## Fontes oficiais consultadas em 21/11/2026

- [Mercado Pago — visão geral do Checkout Transparente e recomendação da Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/overview)
- [Mercado Pago — criar aplicação](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/create-application)
- [Mercado Pago — credenciais de teste/produção e compartilhamento seguro](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/credentials)
- [Mercado Pago — testar Pix com Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix)
- [Mercado Pago — configurar notificações Orders e simular webhook](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications)
- [Mercado Pago — requisitos produção e chave Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-test/go-to-production-requirements)
- [Cloudflare — configurar Secrets nos Workers](https://developers.cloudflare.com/workers/configuration/secrets/)

**Nota:** O painel de integrações pode alterar nomes e passos. Revisar os rótulos na tela durante a reunião; nunca supor que o pagamento está homologado sem confirmação técnica do fornecedor.
