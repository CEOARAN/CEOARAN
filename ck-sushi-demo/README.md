# CK Sushi Delivery — Protótipo V5

**Site de demonstração:** https://ck-sushi-demo.ceoaran-dev.workers.dev/

## Design e interface
- Paleta refinada: preto #121212 / branco #FFFFFF / cinza #FAFAFA / vermelho #BD2535 como acento;
- Loader SVG de poke com hashis, animação em loop e tempo mínimo aproximado de 3,05 segundos; movimento reduzido respeitado;
- Carrossel de categorias em arco, com sete opções, transições suaves, gestos de arrastar, controles e indicadores;
- Destaques deslizantes, entrada de seções por scroll, busca e layout mobile-first;
- Ícones SVG de traço uniforme, botões compactos, cards e navegação inferior organizada;
- Fotos de catálogo ilustrativas e otimizadas para dispositivos móveis.

## Funcionalidades front-end
- Cardápio com 37 produtos demonstrativos, pesquisa, filtro, ordenação e lista/grade;
- Favoritos, visualização de produto, notas, quantidade e carrinho;
- Checkout fictício com entrega/retirada e escolha ilustrativa de pagamento;
- Pedidos de exemplo, timeline e mapa esquemático com motinha animada.

## Limitações
- **Nenhum pedido ou pagamento real.** Não há backend, banco, integração Pix, WhatsApp ou iFood.
- **Mapa fictício**, sem rastreamento ou coordenadas reais.
- Fotografias de acervo ilustrativo, não oficiais do restaurante.
- Produtos e preços de referência precisam ser validados com a CK Sushi.

## Infraestrutura
- Conta GitHub: CEOARAN; projeto em `CEOARAN/CEOARAN`, branch `ck-sushi-demo`, pasta `ck-sushi-demo/`.
- Cloudflare Worker: `ck-sushi-demo`, conta CEOARAN.
- Front-end estático em HTML/CSS/JavaScript sem build.
- Projetos Fine Form e Lince não foram alterados.
