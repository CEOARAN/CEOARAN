# CK Sushi Delivery — Front-end Premium (V3)

**Demo online:** https://ck-sushi-demo.ceoaran-dev.workers.dev/

Projeto de demonstração UI/UX mobile-first, baseado nas referências enviadas pelo proponente. Identidade com superfícies claras, vinho/vermelho pontual, fotografia editorial e navegação compacta.

## Funcionalidades disponíveis
- Loader de entrada animado, transições, hover, feedback de ações e suporte a reduced motion;
- Homepage com hero editorial, categorias fotográficas e produtos em destaque;
- Catálogo com 37 produtos de referência, busca em tempo real, categorias, ordenação e visualização lista/grade;
- Detalhes de produto em modal (desktop) ou bottom sheet (mobile), quantidade e observação;
- Favoritos;
- Carrinho reativo em drawer/bottom sheet, controle de quantidades, persistência local quando disponível e resumo;
- Checkout fictício com entrega/retirada, formulário, formas de pagamento ilustrativas;
- Pedido fictício e timeline de acompanhamento com avanço manual (simulação);
- Layout responsivo para celular e desktop.

## Limitações obrigatórias
- **Não recebe pedidos reais:** sem API/backend e sem envio de mensagens ao restaurante.
- **Não processa pagamentos nem despacha entregadores:** Pix/cartão/dinheiro e etapas da entrega são somente opções visuais.
- O frete usado no checkout é um valor **ilustrativo**, não calculado conforme endereço.
- Fotografias são de acervo ilustrativo (Unsplash), **não fotos oficiais do CK Sushi**.
- Os 37 produtos e preços foram baseados no inventário anterior da página pública, **não constituem catálogo comercial validado**.
- Formulários não transmitem dados a servidor; no exemplo o pedido salvo localmente contém apenas itens/total/etapa, sem nome, telefone ou endereço.

## Código e publicação
- Diretório do projeto: `ck-sushi-demo/`, branch: `ck-sushi-demo` do repositório `CEOARAN/CEOARAN`.
- Aplicação estática de arquivo único: `index.html` com HTML, CSS e JavaScript puro, sem build e sem backend.
- Servida pela Cloudflare Worker `ck-sushi-demo` da conta CEOARAN.
- Contas Fine Form e aplicações Lince **não foram alteradas**.

## Continuidade
Revisar fotografias e catálogo com autorização do restaurante; aprovar a UI; depois criar repositório próprio e definir um backend com cobrança Pix vinculada ao pedido e integração logística autorizada.
