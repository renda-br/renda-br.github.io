/* Renda BR — interface do site (mapa, consulta individual e planilha). */
(function () {
  'use strict';
  const C = window.CONFIG || {}, BASE = C.dados || 'dados/v1/';
  const $ = (s) => document.querySelector(s);
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const int = new Intl.NumberFormat('pt-BR');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------ dados
  async function gunzip(u8) {
    if (u8[0] !== 0x1f || u8[1] !== 0x8b) return u8;   // servidor ja descompactou
    const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function carregar(caminho) {
    const r = await fetch(BASE + caminho);
    if (!r.ok) throw new Error(`Falha ao carregar ${caminho} (${r.status})`);
    return gunzip(new Uint8Array(await r.arrayBuffer()));
  }
  async function inflateRaw(u8) {
    const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const motor = K8.criarMotor(carregar);

  // ------------------------------------------------------------------ mapa
  const mapa = L.map('mapa', { zoomControl: false, preferCanvas: true }).fitBounds([[-33.8, -74], [5.3, -34.8]]);
  L.control.zoom({ position: 'topright' }).addTo(mapa);
  const fundo = C.cartoApiKey
    ? L.tileLayer('https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=' + encodeURIComponent(C.cartoApiKey),
      { maxZoom: 20, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' })
    : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' });
  fundo.addTo(mapa);
  if (C.satelite && C.satelite.url) {
    const sat = L.tileLayer(C.satelite.url, { maxZoom: C.satelite.maxZoom || 19, attribution: C.satelite.atribuicao || '' });
    L.control.layers({ 'Mapa': fundo, 'Satélite': sat }, null, { position: 'topright' }).addTo(mapa);
  }
  mapa.attributionControl.addAttribution('Dados: <a href="https://www.ibge.gov.br/">IBGE</a>, Censo 2022');
  const camada = L.layerGroup().addTo(mapa), camadaLote = L.layerGroup().addTo(mapa);

  function areaLivre() {
    const p = $('#painel'), mob = window.innerWidth <= 640;
    return mob ? { tl: [20, 20], br: [20, p.offsetHeight + 20] } : { tl: [p.offsetLeft + p.offsetWidth + 24, 24], br: [60, 24] };
  }
  const anelLatLng = (xs, ys) => Array.from(xs, (x, i) => [ys[i] / 1e7, x / 1e7]);

  // ------------------------------------------------------------------ consulta individual
  function lerCoordenada(t) {
    t = String(t || '').trim().replace(/[()]/g, '');
    let m = t.match(/^(-?\d+(?:[.,]\d+)?)\s*[;\s|]\s*(-?\d+(?:[.,]\d+)?)$/);          // "-23,55; -46,63" ou "-23.55 -46.63"
    if (!m) m = t.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);                 // "-23.55, -46.63"
    if (!m) return null;
    const a = parseFloat(m[1].replace(',', '.')), b = parseFloat(m[2].replace(',', '.'));
    return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
  }

  let ultimo = null;
  async function consultar(lat, lon, centralizar) {
    const st = $('#status'); st.className = 'status'; st.textContent = 'Calculando…';
    try {
      const r = await motor.consultar(lat, lon);
      if (r.erro) { st.className = 'status erro'; st.textContent = r.erro; return; }
      st.textContent = ''; ultimo = r; desenhar(r, centralizar); cartao(r);
      $('#coord').value = `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}`;
      history.replaceState(null, '', `#${r.lat.toFixed(6)},${r.lon.toFixed(6)}`);
    } catch (e) { console.error(e); st.className = 'status erro'; st.textContent = 'Não foi possível calcular. Verifique a conexão e tente de novo.'; }
  }

  function desenhar(r, centralizar) {
    camada.clearLayers();
    const contorno = r.contorno.map((rings) => rings.map(([xs, ys]) => anelLatLng(xs, ys)));
    const setor = L.polygon(contorno, { color: getComputedStyle(document.documentElement).getPropertyValue('--setor').trim() || '#d6453d', weight: 2.5, fill: false }).addTo(camada);
    const circ = L.circle([r.lat, r.lon], { radius: r.raio_m, color: '#0f5b4f', weight: 1.5, dashArray: '5 5', fillColor: '#0f5b4f', fillOpacity: 0.05 }).addTo(camada);
    const pmax = Math.max(...r.pontos_vizinhos.map((v) => v.peso));
    for (const v of r.pontos_vizinhos) {
      L.circleMarker([v.lat, v.lon], { radius: 3 + 5 * Math.sqrt(v.peso / pmax), color: '#fff', weight: 1, fillColor: '#0f5b4f', fillOpacity: 0.85 })
        .bindTooltip(`Setor vizinho: ${brl.format(v.renda)}<br>${int.format(Math.round(v.dist))} m · peso ${(100 * v.peso / r.pontos_vizinhos.reduce((s, x) => s + x.peso, 0)).toFixed(0)}%`)
        .addTo(camada);
    }
    L.marker([r.lat, r.lon]).addTo(camada);
    const b = setor.getBounds().extend(circ.getBounds()), f = areaLivre();
    if (centralizar) mapa.fitBounds(b, { paddingTopLeft: f.tl, paddingBottomRight: f.br, maxZoom: 17 });
    else {
      const nw = mapa.latLngToContainerPoint(b.getNorthWest()), se = mapa.latLngToContainerPoint(b.getSouthEast()), sz = mapa.getSize();
      if (nw.x < f.tl[0] || nw.y < f.tl[1] || se.x > sz.x - f.br[0] || se.y > sz.y - f.br[1]) mapa.fitBounds(b, { paddingTopLeft: f.tl, paddingBottomRight: f.br, maxZoom: 17 });
    }
  }

  const raioTxt = (m) => (m >= 1000 ? `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km` : `${int.format(Math.round(m))} m`);
  function textoLaudo(r) {
    const url = (C.enderecoPublico || location.href.split('#')[0]) + `#${r.lat.toFixed(6)},${r.lon.toFixed(6)}`;
    return `Renda de vizinhança (${r.versao}) no ponto ${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}: ${brl.format(r.renda_centavos / 100)}. `
      + `Média geométrica ponderada do rendimento médio do responsável pelo domicílio dos ${r.vizinhos} setores censitários mais próximos `
      + `(raio de ${raioTxt(r.raio_m)}). Fonte: IBGE, Censo Demográfico 2022 (V06004), R$ nominais de 2022. Setor do ponto: ${r.cd_setor} (${r.municipio}/${r.uf}). ${url}`;
  }

  function cartao(r) {
    const al = [];
    if (r.coordenadas_invertidas) al.push('Latitude e longitude estavam invertidas e foram corrigidas automaticamente.');
    if (r.setor_sem_dado) al.push('O setor do ponto não tem dado de rendimento no IBGE; o valor vem apenas dos setores vizinhos.');
    if (r.raio_m > 3000) al.push(`Vizinhança ampla (${raioTxt(r.raio_m)}), típica de área pouco povoada: o valor é menos local.`);
    const el = $('#resultado');
    el.innerHTML = `<button class="fechar" title="Limpar" aria-label="Limpar">×</button>
      <div class="valor">${brl.format(r.renda_centavos / 100)}</div>
      <div class="rotulo">Renda de vizinhança no ponto</div>
      <div class="nota">Rendimento médio do responsável pelo domicílio · R$ nominais de 2022</div>
      ${al.map((a) => `<div class="alerta">${esc(a)}</div>`).join('')}
      <dl class="dados">
        <dt>Vizinhança</dt><dd>${r.vizinhos} setores · raio ${raioTxt(r.raio_m)}</dd>
        <dt>Município</dt><dd>${esc(r.municipio)}/${esc(r.uf)}</dd>
        <dt>Setor censitário</dt><dd>${esc(r.cd_setor)}</dd>
        <dt>Renda do setor (IBGE)</dt><dd>${r.renda_setor == null ? 'sem dado' : brl.format(r.renda_setor)}</dd>
        <dt>Coordenada usada</dt><dd>${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}</dd>
      </dl>
      <div class="acoes"><button data-copiar="laudo">Copiar texto para o laudo</button><button data-copiar="link">Copiar link</button></div>
      <div class="versao-res">${esc(r.versao)}</div>`;
    el.classList.remove('oculto');
    el.querySelector('.fechar').onclick = () => { el.classList.add('oculto'); camada.clearLayers(); history.replaceState(null, '', location.pathname); };
    el.querySelectorAll('[data-copiar]').forEach((b) => b.onclick = async () => {
      const t = b.dataset.copiar === 'laudo' ? textoLaudo(r) : (C.enderecoPublico || location.href.split('#')[0]) + `#${r.lat.toFixed(6)},${r.lon.toFixed(6)}`;
      try { await navigator.clipboard.writeText(t); const o = b.textContent; b.textContent = 'Copiado!'; setTimeout(() => (b.textContent = o), 1500); }
      catch { prompt('Copie o texto:', t); }
    });
  }

  $('#form-busca').addEventListener('submit', (e) => {
    e.preventDefault(); const c = lerCoordenada($('#coord').value);
    if (!c) { $('#status').className = 'status erro'; $('#status').textContent = 'Coordenada inválida. Exemplo: -23.551028, -46.638254'; return; }
    consultar(c[0], c[1], true);
  });
  mapa.on('click', (e) => { if (abaAtual === 'consulta') consultar(e.latlng.lat, e.latlng.lng, false); });

  // ------------------------------------------------------------------ abas e painel
  let abaAtual = 'consulta';
  document.querySelectorAll('.abas button').forEach((b) => b.onclick = () => {
    abaAtual = b.dataset.aba;
    document.querySelectorAll('.abas button').forEach((x) => x.classList.toggle('ativa', x === b));
    document.querySelectorAll('.aba').forEach((s) => s.classList.toggle('oculto', s.id !== 'aba-' + abaAtual));
    if (abaAtual === 'lote') camada.clearLayers(); else if (abaAtual === 'consulta') { camadaLote.clearLayers(); if (ultimo && !$('#resultado').classList.contains('oculto')) desenhar(ultimo, false); }
    $('#painel').classList.remove('recolhido');
  });
  $('#recolher').onclick = () => $('#painel').classList.toggle('recolhido');

  // ------------------------------------------------------------------ planilha
  const normal = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function numero(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let s = String(v).trim().replace(/\s/g, '').replace('−', '-');
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(',', '.');
    const x = Number(s); return s !== '' && Number.isFinite(x) ? x : null;
  }
  function colunas(cab) {
    const mapa = new Map(cab.map((c, i) => [normal(c), i]));
    const achar = (ops) => { for (const o of ops) if (mapa.has(o)) return mapa.get(o); return -1; };
    return {
      id: achar(['dado', 'amostra', 'id', 'identificacao', 'classificacao', 'elemento', 'item', 'numero', 'num', 'nro', 'nr', 'n', 'codigo', 'cod', 'imovel']),
      lat: achar(['latitude', 'lat', 'latitudegraus', 'y']), lon: achar(['longitude', 'lon', 'long', 'lng', 'longitudegraus', 'x']),
      coord: achar(['coordenadas', 'coordenada', 'latitudelongitude', 'latlon', 'latlong', 'coordenadasgeograficas'])
    };
  }

  let resultadoLote = null;
  $('#arquivo').onchange = () => { const f = $('#arquivo').files[0]; $('#arquivo-nome').textContent = f ? f.name : 'Escolher arquivo…'; };
  $('#processar').onclick = async () => {
    const f = $('#arquivo').files[0], st = $('#status-lote'), bt = $('#processar'), pr = $('#progresso');
    st.className = 'status'; $('#baixar').classList.add('oculto');
    if (!f) { st.textContent = 'Escolha um arquivo .xlsx ou .csv.'; return; }
    bt.disabled = true; st.textContent = 'Lendo a planilha…';
    try {
      const { nomeAba, linhas } = await Planilha.lerPlanilha(f.name, await f.arrayBuffer(), inflateRaw);
      let h = linhas.findIndex((l) => l && l.some((v) => v !== null && v !== undefined && String(v).trim() !== ''));
      if (h < 0) throw new Error('A planilha está vazia.');
      const cab = linhas[h].map((v) => (v == null ? '' : String(v))), cols = colunas(cab);
      if (!((cols.lat >= 0 && cols.lon >= 0) || cols.coord >= 0)) throw new Error('Não encontrei as colunas LATITUDE e LONGITUDE (nem uma coluna COORDENADAS).');
      const dados = linhas.slice(h + 1).filter((l) => l && l.some((v) => v !== null && v !== undefined && String(v).trim() !== ''));
      if (dados.length > 20000) throw new Error('Limite de 20.000 linhas por planilha.');
      camadaLote.clearLayers(); pr.classList.remove('oculto'); const barra = pr.firstElementChild;
      const saida = []; let ok = 0, inv = 0, semDado = 0; const lim = [];
      for (let i = 0; i < dados.length; i++) {
        const l = dados[i]; let lat, lon;
        if (cols.lat >= 0 && cols.lon >= 0) { lat = numero(l[cols.lat]); lon = numero(l[cols.lon]); }
        else { const c = lerCoordenada(l[cols.coord]); [lat, lon] = c || [null, null]; }
        const ident = cols.id >= 0 && l[cols.id] != null && l[cols.id] !== '' ? String(l[cols.id]) : String(i + 1);
        let r;
        if (lat === null || lon === null) r = { erro: 'Coordenada inválida' };
        else { try { r = await motor.consultar(lat, lon); } catch (e) { r = { erro: 'Erro ao calcular esta linha' }; } }
        if (!r.erro) { ok++; if (r.coordenadas_invertidas) inv++; if (r.setor_sem_dado) semDado++; }
        saida.push({ ident, r, lat, lon });
        if (r.erro ? lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 : true) {
          const p = r.erro ? [lat, lon] : [r.lat, r.lon]; lim.push(p);
          const cls = r.erro ? 'erro' : (r.coordenadas_invertidas || r.setor_sem_dado || r.raio_m > 3000 ? 'aviso' : '');
          L.marker(p, { icon: L.divIcon({ className: '', html: `<div class="pino ${cls}" title="${esc(ident)}"><span>${esc(ident)}</span></div>`, iconSize: [26, 30], iconAnchor: [13, 28], popupAnchor: [0, -26] }) })
            .bindPopup(r.erro ? `<b>${esc(ident)}</b><br>${esc(r.erro)}` : `<b>${esc(ident)}</b><br><b>${brl.format(r.renda_centavos / 100)}</b><br>${esc(r.municipio)}/${esc(r.uf)} · raio ${raioTxt(r.raio_m)}<br>Setor ${esc(r.cd_setor)}`)
            .addTo(camadaLote);
        }
        if (i % 10 === 0 || i === dados.length - 1) { barra.style.width = `${(100 * (i + 1) / dados.length).toFixed(1)}%`; st.textContent = `Processando ${i + 1} de ${dados.length}…`; await new Promise((s) => setTimeout(s, 0)); }
      }
      if (lim.length) { const fz = areaLivre(); mapa.fitBounds(lim, { paddingTopLeft: fz.tl, paddingBottomRight: fz.br, maxZoom: 16 }); }
      const novas = ['Renda BR K8 (R$)', 'Raio vizinhança (m)', 'Setores na vizinhança', 'Setor censitário', 'Município', 'UF', 'Situação do cálculo'];
      const nc = cab.length, out = [[...cab, ...novas]];
      saida.forEach(({ r }, i) => {
        const base = Array.from({ length: nc }, (_, k) => (dados[i][k] === undefined ? null : dados[i][k]));
        out.push(r.erro ? [...base, null, null, null, null, null, null, r.erro]
          : [...base, r.renda_centavos / 100, Math.round(r.raio_m), r.vizinhos, r.cd_setor, r.municipio, r.uf,
            r.coordenadas_invertidas ? 'OK (lat/lon invertidas, corrigidas)' : (r.setor_sem_dado ? 'OK (setor sem dado IBGE)' : 'OK')]);
      });
      const v = motor.index, agora = new Date();
      const info = [['Campo', 'Valor'], ['Ferramenta', 'Renda BR — variável de localização'], ['Versão', v.nome],
        ['Processado em', agora.toLocaleString('pt-BR')], ['Arquivo de entrada', f.name + ' (aba ' + nomeAba + ')'],
        ['Coluna "Renda BR K8 (R$)"', 'Renda de vizinhança: média geométrica ponderada (kernel quártico, 8 setores mais próximos) do rendimento médio do responsável pelo domicílio, R$ nominais de 2022.'],
        ['Fonte', v.base], ['Coordenadas', 'Arredondadas para 6 casas decimais antes do cálculo.'],
        ['Linhas', `${dados.length} processadas · ${ok} com resultado · ${dados.length - ok} com pendência`],
        ['Metodologia', (C.enderecoPublico || location.href.split('#')[0]).replace(/index\.html$/, '') + 'metodologia.html']];
      const larg = [...cab.map((c) => Math.min(40, Math.max(10, String(c).length + 2))), 18, 18, 12, 18, 22, 6, 34];
      const xlsx = Planilha.escreverXlsx([{ nome: 'Resultados', linhas: out, larguras: larg, formatoMoeda: new Set([nc]) }, { nome: 'Informacoes', linhas: info, larguras: [28, 110] }]);
      resultadoLote = { blob: new Blob([xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nome: f.name.replace(/\.[^.]+$/, '') + '_renda_br.xlsx' };
      st.innerHTML = `${dados.length} linhas · <b>${ok}</b> com resultado · ${dados.length - ok} com pendência`
        + (inv ? `<br>${inv} com latitude/longitude invertidas (corrigidas)` : '') + (semDado ? `<br>${semDado} em setor sem dado do IBGE` : '')
        + (cols.id < 0 ? '<br>Sem coluna de identificação: usei a ordem das linhas.' : '');
      $('#baixar').classList.remove('oculto');
    } catch (e) { console.error(e); st.className = 'status erro'; st.textContent = e.message || 'Erro ao processar a planilha.'; }
    finally { bt.disabled = false; }
  };
  $('#baixar').onclick = () => {
    if (!resultadoLote) return; const a = document.createElement('a'); a.href = URL.createObjectURL(resultadoLote.blob);
    a.download = resultadoLote.nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  // ------------------------------------------------------------------ início
  motor.iniciar().then((idx) => {
    $('#versao').textContent = `${idx.nome} · ${int.format(idx.setores)} setores`;
    const h = decodeURIComponent(location.hash.slice(1)), c = lerCoordenada(h.replace(',', ', '));
    if (c) consultar(c[0], c[1], true);
  }).catch((e) => { console.error(e); $('#versao').textContent = 'Erro ao carregar a base de dados.'; });
})();
