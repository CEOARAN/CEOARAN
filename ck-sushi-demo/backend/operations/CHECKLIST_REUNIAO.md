# CK Sushi — Cola da reunião: Mercado Pago / Pix

**Somente TESTE na primeira reunião.** O cliente controla sua conta e sua chave Pix. **Nunca anotar tokens, senha ou códigos 2FA.**

| Ordem | O que orientar na tela do CLIENTE | Confirmação que você marca |
|---|---|---|
| 1 | Entrar no **Mercado Pago Developers > Integrações** com a conta dele | [ ] Conta correta, cadastro e Pix já preparados |
| 2 | Ver se já existe aplicação para CK Sushi; senão **Criar aplicação** | [ ] Aplicação de titularidade do cliente |
| 3 | Escolher **Checkout Transparente / Orders API**, nome do projeto e dados reais | [ ] Aplicação configurada |
| 4 | Selecionar ambiente **Teste > Credenciais** | [ ] Seletor em TESTE |
| 5 | Copiar **Access Token TESTE** diretamente para o campo **Secret** do Worker de homologação na Cloudflare | [ ] `MP_TEST_ACCESS_TOKEN` cadastrado, valor não exibido |
| 6 | Identificar **Application ID** da mesma aplicação | [ ] `MP_TEST_APPLICATION_ID` cadastrado |
| 7 | Abrir **Configuração de Webhooks**, escolher **Teste** | [ ] Modo TESTE confirmado |
| 8 | Cadastrar URL HTTPS abaixo; tópico **Order (Mercado Pago)** | [ ] URL e evento corretos |
| 9 | Salvar webhook e inserir assinatura gerada como **Secret** | [ ] `MP_TEST_WEBHOOK_SECRET` cadastrado |
| 10 | Simular notificação no painel do Mercado Pago | [ ] HTTP 200 após configuração; sem mudar pagamento real |
| 11 | Verificar o teste Pix Orders API com os exemplos oficiais, usando credenciais TESTE | [ ] Ordem de teste e estado conferidos |
| 12 | Validar eventos repetidos, idempotência, referência, titular recebedor e valor | [ ] Testes técnicos aprovados |
| 13 | Registrar pendências de produção e responsáveis, sem copiar credenciais | [ ] Aceite de testes e pendências documentados |

## URL EXATA do webhook TESTE

```
https://ck-sushi-backend-staging.ceoaran-dev.workers.dev/api/webhooks/mercadopago/test
```

## Caminho EXATO para adicionar cada secret

Cloudflare > **Workers & Pages** > `ck-sushi-backend-staging` > **Settings** > **Variables and Secrets** > **Add** > **Secret** > informar nome e colar valor oculto > **Deploy**.

**Secrets de teste:** `MP_TEST_ACCESS_TOKEN`, `MP_TEST_WEBHOOK_SECRET`.

**Variável não secreta:** `MP_TEST_APPLICATION_ID`. A Public Key só será necessária se o frontend passar a usar o SDK/Brick correspondente. Não exigir `Client Secret` ou `Client ID` para Pix direto de um único restaurante sem necessidade OAuth.

**Importante:** enquanto faltarem credenciais o webhook responde HTTP 503, como esperado. Não desabilitar assinatura para forçar HTTP 200.

## REGISTRO DA REUNIÃO — NÃO COLOCAR SEGREDOS AQUI

- Data/horário: ______
- Representante autorizado do cliente: ______
- Aplicação criada ou existente? ______
- Teste selecionado e confirmado? ______
- Credenciais colocadas em Secret sem exposição? ______
- Webhook TESTE configurado? ______
- Simulação (HTTP 200)? ______
- Pix Orders API teste conferido? ______
- Aprovação produção? **NÃO — somente após contrato, LGPD, testes e ambiente separado**
- Pendências e responsáveis: ______

> Para o plano completo dividido entre cliente, CEOARAN e ambos, abra [PLANO_OPERACAO_MERCADO_PAGO.md](PLANO_OPERACAO_MERCADO_PAGO.md).
