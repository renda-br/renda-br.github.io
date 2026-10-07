/*
 * Configuração do site. Pode ser editada sem mexer no restante do código.
 */
window.CONFIG = {
  // Pasta da base de dados publicada (cada versão fica em sua própria pasta e nunca é alterada).
  dados: 'dados/v1/',

  // Mapa de fundo. Sem chave usa o OpenStreetMap. Para produção, recomenda-se uma chave
  // gratuita do CARTO (https://carto.com/basemaps/apikey/) — cole-a abaixo.
  cartoApiKey: 'cb1_4d4p_1_efdefd76d4241eefe08743e7',

  // Camada de satélite opcional (deixe vazio para não exibir). Use um provedor cujos termos
  // permitam o uso no seu site, por exemplo uma conta gratuita da MapTiler:
  //   satelite: { url: 'https://api.maptiler.com/maps/satellite/{z}/{x}/{y}.jpg?key=SUA_CHAVE',
  //               atribuicao: '&copy; MapTiler &copy; OpenStreetMap contributors', maxZoom: 20 }
  satelite: null,

  // Endereço público do site (usado no texto de citação). Ex.: 'https://renda-br.pages.dev/'
  enderecoPublico: 'https://renda-br.github.io/'
};
