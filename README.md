# Renda BR — variável de localização (Censo 2022)

Renda de vizinhança interpolada a partir do Censo Demográfico 2022 do IBGE (V06004), para uso como
variável de localização em avaliação de imóveis em todo o Brasil.

**Ferramenta:** https://renda-br.github.io/ · **Metodologia:** [metodologia.html](metodologia.html)

Valor no ponto: média geométrica ponderada (kernel quártico adaptativo) do rendimento médio do responsável
pelo domicílio dos 8 setores censitários mais próximos. Site estático: o cálculo é feito no navegador.

- `dados/v1/` — base da versão v1 (não alterar; novas versões em `dados/v2/`, ...)
- `js/k8.js` — núcleo do cálculo · `testes/` — verificação contra a implementação de referência

Fonte dos dados: IBGE, Censo Demográfico 2022.
