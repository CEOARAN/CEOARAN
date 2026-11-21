# CK Sushi — Segurança, privacidade e conformidade (checklist de homologação)
**Status em 21/11/2026:** projeto de homologação, não apto a processar pedidos ou pagamentos reais. Este documento é técnico e não constitui parecer jurídico.

## Base normativa consultada
- LGPD, Lei 13.709/2018: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- CDC, Lei 8.078/1990: https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm
- Decreto 7.962/2013, comércio eletrônico: https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm
- Marco Civil da Internet, Lei 12.965/2014: https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm
- ANPD Resolução 2/2022, agentes de pequeno porte: https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022
- ANPD Resolução 15/2024, incidentes: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis
- ANPD Resolução 18/2024, encarregado: https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-aprova-norma-sobre-a-atuacao-do-encarregado-pelo-tratamento-de-dados-pessoais
- ANPD Resolução 19/2024, transferência internacional: https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados
- Estatuto da Criança e do Adolescente, art. 243 (bebidas alcoólicas): https://www.planalto.gov.br/ccivil_03/leis/l8069compilado.htm
- Estatuto Digital da Criança e do Adolescente, Lei 15.211/2025: https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15211.htm
- Guia ANPD de Cookies: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_cookies_e_protecao_de_dados_pessoais
- OWASP ASVS: https://asvs.owasp.org/

## Implementado em homologação
- [x] D1 segregado: `ck-sushi-staging` (não compartilha dados com outros projetos da conta).
- [x] Migração SQL versionada e restrições estruturais; preços armazenados em centavos.
- [x] Importação de 103 produtos públicos, com categorias, imagens, promoções e IDs.
- [x] API pública apenas de catálogo, sem dados de clientes.
- [x] Backend de operações do catálogo, com prepared statements, validação de URL e tamanho, registro de alteração e bloqueio de conflito de versão.
- [x] Servidor exige autenticação Cloudflare Access com assinatura JWT RS256, emissor, audiência, expiração e lista explícita de usuários permitidos.
- [x] Sem configuração Access, todas as operações administrativas são recusadas (fail-closed).
- [x] Mutação exige Origin de mesma origem, JSON e header anti-CSRF derivado da sessão autenticada.
- [x] Checkout/pagamentos/captação de dados pessoais de clientes bloqueados com HTTP 503.
- [x] Painel responsivo com catálogo em modo público de leitura e edição disponível apenas após identidade autorizada.
- [x] Configurações de features perigosas mantidas desligadas.

## Pontos pendentes e proibidos de ativar automaticamente
- [ ] Cloudflare Zero Trust / Access não está habilitado nesta conta (API devolveu `access.api.error.not_enabled`). Exige decisão sobre domínio da equipe, administrador e autenticação multifator. **Não utilizar senha hardcoded nem bypass**.
- [ ] Confirmar identificação formal do restaurante: razão social, CNPJ, endereço, contatos oficiais, dados de faturamento e responsável por atendimento.
- [ ] Formalizar contrato controlador/operador (por exemplo, restaurante como controlador e prestador técnico como operador, conforme realidade de tratamento); responsabilidade, instruções, fornecedores, auditoria, suboperadores e incidentes.
- [ ] Mapear finalidades e bases legais **por fluxo** (execução contratual para pedido, obrigação legal fiscal, consentimento específico quando aplicável a marketing etc.), dados necessários, acesso interno, transferência e prazo de retenção.
- [ ] Elaborar e aprovar Aviso de Privacidade, Termos de Uso, política de cookies e canal do titular/encarregado conforme enquadramento e aprovação jurídica.
- [ ] Implementar processo verificável de autenticação de pedidos do titular; acesso, correção, bloqueio, eliminação e portabilidade nos casos aplicáveis, registro de respostas, política de retenção e descarte.
- [ ] Documentar processos de backup, restauração testada, monitoramento, WAF, rate limit, segregação de ambientes, gestão de segredos e teste de intrusão / OWASP ASVS.
- [ ] Incident response com papéis, evidências, triagem, notificação e registro de incidentes por **no mínimo cinco anos** conforme Resolução 15/2024; prazos dependem da classificação e enquadramento.
- [ ] Confirmar contratos/cloud region/subprocessadores e fluxo de transferência internacional; a D1 da conta não teve residência exclusivamente brasileira garantida.
- [ ] Garantir política de registro de acesso à aplicação conforme Marco Civil, **na medida em que o agente se enquadrar como provedor de aplicações**. Não equiparar `admin_audit` a logs de acesso obrigatórios.
- [ ] Dados de cartão **nunca** devem passar pelo backend; integrar provedor de pagamento com tokenização e contratos adequados (PCI DSS e legislação aplicável).
- [ ] Definir mecanismos de autenticação de webhooks, idempotência e conciliação financeira/estorno antes do pagamento real.
- [ ] Conferir frete, horário, região de entrega, formas de cancelamento, atendimento ao consumidor e confirmação de pedidos (CDC + Decreto 7.962/2013).
- [ ] Art. 49 do CDC: analisar direito de arrependimento e suas consequências para os cenários específicos de alimentação e perecíveis, por advogado especializado; não assumir exceção genérica automática.
- [ ] Conferir se promoções e preços anteriores são verídicos e demonstráveis (17 produtos com preço de comparação no catálogo).
- [ ] Confirmar autorização de uso de imagens originais e eventuais recriações; conteúdo do cardápio não é automaticamente licenciado a terceiros.
- [ ] Validar ingredientes, alérgenos, pesos, disponibilidade e cuidados sanitários em conjunto com a loja; RDC 216/2004 conforme aplicação.
- [ ] Restringir produtos alcoólicos a maiores de idade com verificação operacional na compra/entrega e avaliação do ECA Digital; não implementar checagem superficial.
- [ ] Homologar permissões por função (proprietário/gestor/editor/atendimento), MFA, revogação, monitoramento de abuso, teste com identidade real.
- [ ] Homologar UX acessível, mensagens, proteção anti-spam, escalabilidade, testes automatizados e resposta a erros.

## Garantias e limites
Nenhum código elimina a possibilidade de vazamento, sanção ou processo. O serviço não deve ser tratado como LGPD-compliant apenas por empregar TLS, banco de dados, autenticação ou este checklist. A conformidade depende dos processos reais, finalidade, contratos, governança, auditorias, aprovação de produtos e revisão jurídica.

## Lançamento
O projeto público atual `ck-sushi-demo` permanece sem integração real de backend. O backend de homologação é `ck-sushi-backend-staging`, acessível no caminho `/admin`. Integração de checkout real permanece deliberadamente desabilitada. A promoção para produção exige revisão de arquitetura, chave de criptografia, autorização administrativa real, testes de restauração, assinaturas e aceite formal.
