# CK Sushi Delivery — Interface V8 (demonstração)

## Links publicados
- Vitrine demonstrativa: https://ck-sushi-demo.ceoaran-dev.workers.dev/
- Homologação integrada ao catálogo D1: https://ck-sushi-backend-staging.ceoaran-dev.workers.dev/

## Interface
- Interface mobile-first, paleta branca/preta/vermelha e catálogo com 103 produtos de referência.
- Header que oculta enquanto o visitante desce a página e reaparece ao parar ou subir; sem barra de progresso.
- Footer institucional retirado; os avisos de preços e imagens não validados permanecem onde forem relevantes.
- Botões de coração alinhados, com estados acessíveis de favorito e não favorito.
- Carrossel em arco de categorias no começo da página, sem segunda seção duplicada.
- Busca, filtros, detalhes, favoritos, notas e carrinho de demonstração.

## Finalização animada
- Ao concluir o **checkout demonstrativo**, até seis imagens de produtos animam até o carrinho, com contador de unidades e breve reação visual do carrinho.
- A interface abre automaticamente **Pedidos**, preservando um resumo da seleção no armazenamento local.
- Entregas demonstrativas exibem uma rota SVG ilustrativa, totalmente fictícia, com sinalização explícita de ausência de GPS.
- A área iFood informa que o link oficial de rastreamento só será exibido quando houver integração e despacho autorizados.
- Usuários com preferência por movimento reduzido recebem uma transição sem animações.

## Segurança e limites
- Não gera pedidos reais, não cobra Pix/cartão, não aciona entregadores e não cria coordenadas.
- O ID prefixado por `#DEMO-`, a timeline e o mapa representam **simulações**.
- A versão de homologação usa o banco `ck-sushi-staging` via `CATALOG_DB`, com pedidos e pagamentos desabilitados por configurações e gatilhos SQL.
- Dados do restaurante, preços, disponibilidade, entrega, fotos e autorizações de uso exigem validação antes de produção.
- A publicação do frontend não altera o status de aprovação jurídica, LGPD, Cloudflare Access ou integrações financeiras.

## Código e publicação
- Repositório: `CEOARAN/CEOARAN`.
- Branch: `ck-sushi-demo`.
- Frontend: `ck-sushi-demo/index.html`.
- Backend: `ck-sushi-demo/backend/`.
- Build de homologação: `cd ck-sushi-demo/backend && npm test && npm run build`.
- O Worker demonstrativo e o Worker de staging são publicados separadamente.
