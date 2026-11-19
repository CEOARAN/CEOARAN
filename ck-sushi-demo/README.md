# CK Sushi Delivery — demonstração front-end

Protótipo navegável e responsivo do site CK Sushi, publicado em Cloudflare Workers.

**URL da demonstração:** https://ck-sushi-demo.ceoaran-dev.workers.dev

## O que funciona
- Início, destaques e cardápio filtrável;
- Busca por produtos, categorias e ordenação;
- Detalhes do produto e seleção de quantidade;
- Carrinho persistido somente no navegador;
- Checkout **simulado**, escolha de entrega/retirada e método de pagamento;
- Confirmação de **pedido fictício**.

## Limitações e dados
- Nenhuma API, backend, banco, pagamento, Pix, WhatsApp ou iFood conectado;
- Não é um site apto a receber pedidos reais;
- Produtos e preços são uma amostra revisada de dados públicos indexados do cardápio CK Sushi e precisam ser confirmados;
- Fotografias são ilustrativas (Unsplash), não fotos dos produtos originais;
- Não guarda dados de endereço, nome e telefone depois de fechar a página;
- Frete de R$ 11,00 é **apenas simulado**, não corresponde a uma cotação real.

## Código
Frontend estático de arquivo único `index.html` (HTML + CSS + JavaScript), sem processo de build. A implantação atual embute o arquivo dentro do Worker `ck-sushi-demo` da conta Cloudflare CEOARAN.

## Próximo passo após aprovação
Migrar para repositório exclusivo e implementar integração com pagamento e logística em módulos separados, sujeitos à autorização dos prestadores.
