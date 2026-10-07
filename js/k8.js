/*
 * Renda BR · Censo 2022 · método K8 v1 — núcleo do cálculo (navegador e Node).
 * Mesma definição da implementação de referência (preparacao/metodo_k8.py):
 *  1. coordenada arredondada a 6 casas;  2. ponto precisa estar dentro de um setor censitário;
 *  3. distância euclidiana em coordenadas geocêntricas (GRS80);  4. H = 9ª menor distância;
 *  5. w = (1-(d/H)^2)^2 para d < H;  6. renda = exp(Σ w·ln r / Σ w).
 */
(function (raiz) {
  'use strict';
  const K = 8, A = 6378137.0, F = 1 / 298.257222101, E2 = F * (2 - F), RAD = Math.PI / 180;

  function ecef(lon, lat) {
    const lo = lon * RAD, la = lat * RAD, sl = Math.sin(la), cl = Math.cos(la);
    const n = A / Math.sqrt(1 - E2 * sl * sl);
    return [n * cl * Math.cos(lo), n * cl * Math.sin(lo), n * (1 - E2) * sl];
  }
  const arred6 = (x) => Number(Number(x).toFixed(6));

  function lerVarint(b, o) {
    let x = 0, s = 0, c;
    do { c = b[o++]; x += (c & 0x7f) * Math.pow(2, s); s += 7; } while (c >= 0x80);
    return [x, o];
  }
  const zz = (u) => (u % 2 === 0 ? u / 2 : -(u + 1) / 2);

  function lerQuadricula(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'RBP1') throw new Error('arquivo de pontos inválido');
    const n = dv.getUint32(4, true), lon = new Int32Array(n), lat = new Int32Array(n), r = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      lon[i] = dv.getInt32(8 + 4 * i, true); lat[i] = dv.getInt32(8 + 4 * (n + i), true); r[i] = dv.getUint32(8 + 4 * (2 * n + i), true);
    }
    const xyz = new Float64Array(3 * n), ln = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = ecef(lon[i] / 1e7, lat[i] / 1e7); xyz[3 * i] = p[0]; xyz[3 * i + 1] = p[1]; xyz[3 * i + 2] = p[2];
      ln[i] = Math.log(r[i] / 100);
    }
    return { n, lon, lat, renda: r, xyz, ln };
  }

  function lerBloco(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'RBG1') throw new Error('arquivo de contornos inválido');
    const n = dv.getUint32(4, true); let o = 8; const out = [];
    for (let k = 0; k < n; k++) {
      let cd = ''; for (let i = 0; i < 15; i++) cd += String.fromCharCode(b[o + i]); o += 15;
      const rv = dv.getUint32(o, true), sit = b[o + 4]; o += 5;
      let npol; [npol, o] = lerVarint(b, o);
      const polys = []; let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
      for (let p = 0; p < npol; p++) {
        let nr; [nr, o] = lerVarint(b, o); const rings = [];
        for (let q = 0; q < nr; q++) {
          let nv; [nv, o] = lerVarint(b, o); const xs = new Float64Array(nv), ys = new Float64Array(nv); let x = 0, y = 0, u;
          for (let i = 0; i < nv; i++) {
            [u, o] = lerVarint(b, o); x += zz(u); [u, o] = lerVarint(b, o); y += zz(u); xs[i] = x; ys[i] = y;
            if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y;
          }
          rings.push([xs, ys]);
        }
        polys.push(rings);
      }
      out.push({ cd, renda: rv === 0xFFFFFFFF ? null : rv / 100, sit, polys, bbox: [xmin, ymin, xmax, ymax] });
    }
    return out;
  }

  function contem(polys, px, py) {
    let dentro = false;
    for (const rings of polys) for (const [xs, ys] of rings) {
      const n = xs.length; let j = n - 1;
      for (let i = 0; i < n; i++) {
        const yi = ys[i], yj = ys[j];
        if ((yi > py) !== (yj > py)) {
          const xi = xs[i], xj = xs[j];
          if (px < (xj - xi) * (py - yi) / (yj - yi) + xi) dentro = !dentro;
        }
        j = i;
      }
    }
    return dentro;
  }

  /** carregar(caminhoRelativo) -> Promise<Uint8Array> (bytes já descompactados) */
  function criarMotor(carregar) {
    let idx = null, mun = null; const cacheQ = new Map(), cacheB = new Map();
    const json = async (c) => JSON.parse(new TextDecoder('utf-8').decode(await carregar(c)));
    async function iniciar() {
      if (!idx) { [idx, mun] = await Promise.all([json('index.json'), json('municipios.json')]); }
      return idx;
    }
    function quadricula(nome) {
      if (!cacheQ.has(nome)) cacheQ.set(nome, carregar(`p/${nome}.bin`).then(lerQuadricula));
      return cacheQ.get(nome);
    }
    function bloco(nome) {
      if (!cacheB.has(nome)) cacheB.set(nome, carregar(`g/${nome}.bin`).then(lerBloco));
      return cacheB.get(nome);
    }

    async function setor(lat, lon) {
      await iniciar(); lat = arred6(lat); lon = arred6(lon);
      const px = Math.round(lon * 1e7), py = Math.round(lat * 1e7);
      for (const [nome, x0, y0, x1, y1] of idx.blocos) {
        if (x0 <= lon && lon <= x1 && y0 <= lat && lat <= y1) {
          for (const s of await bloco(nome)) {
            const b = s.bbox;
            if (b[0] <= px && px <= b[2] && b[1] <= py && py <= b[3] && contem(s.polys, px, py)) {
              const m = mun[s.cd.slice(0, 7)] || ['?', '?'];
              return { cd_setor: s.cd, municipio: m[0], uf: m[1], renda_setor: s.renda, situacao: s.sit, contorno: s.polys };
            }
          }
          return null;
        }
      }
      return null;
    }

    async function estimar(lat, lon) {
      await iniciar(); lat = arred6(lat); lon = arred6(lon);
      const p = ecef(lon, lat); let r = 5000; const carregadas = new Set(); const cand = [];
      for (let volta = 0; volta < 40; volta++) {
        const dlat = r / 111000 * 1.02 + 1e-6, dlon = r / (111000 * Math.cos(Math.min(89, Math.abs(lat) + dlat) * RAD)) * 1.02 + 1e-6;
        const novos = [];
        for (let cx = Math.floor(lon - dlon); cx <= Math.floor(lon + dlon); cx++)
          for (let cy = Math.floor(lat - dlat); cy <= Math.floor(lat + dlat); cy++) {
            const nome = `${cx}_${cy}`;
            if (!carregadas.has(nome)) { carregadas.add(nome); if (idx.quadriculas[nome]) novos.push(quadricula(nome)); }
          }
        for (const q of await Promise.all(novos)) {
          for (let i = 0; i < q.n; i++) {
            const dx = q.xyz[3 * i] - p[0], dy = q.xyz[3 * i + 1] - p[1], dz = q.xyz[3 * i + 2] - p[2];
            cand.push([Math.sqrt(dx * dx + dy * dy + dz * dz), q.ln[i], q.lon[i], q.lat[i], q.renda[i]]);
          }
        }
        if (cand.length > K) {
          cand.sort((a, b) => a[0] - b[0]); cand.length = Math.min(cand.length, 4096);
          const H = cand[K][0];
          if (H <= r) {   // todo centroide a menos de H ja esta carregado
            let sw = 0, swl = 0; const viz = [];
            if (H > 0) {
              for (const c of cand) { if (c[0] >= H) break; const t = c[0] / H, w = (1 - t * t) * (1 - t * t); sw += w; swl += w * c[1]; viz.push({ lon: c[2] / 1e7, lat: c[3] / 1e7, renda: c[4] / 100, dist: c[0], peso: w }); }
            } else {
              for (const c of cand) { if (c[0] > 0) break; sw += 1; swl += c[1]; viz.push({ lon: c[2] / 1e7, lat: c[3] / 1e7, renda: c[4] / 100, dist: 0, peso: 1 }); }
            }
            const v = Math.exp(swl / sw);
            return { lat, lon, renda: v, renda_centavos: Math.round(v * 100), raio_m: H, vizinhos: viz.length, pontos_vizinhos: viz };
          }
          r = Math.max(r * 2, H * 1.05);
        } else r *= 2;
      }
      throw new Error('vizinhos não encontrados');
    }

    async function consultar(lat, lon) {
      lat = arred6(lat); lon = arred6(lon);
      if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return { erro: 'Coordenada inválida.' };
      let st = await setor(lat, lon), invertida = false;
      if (!st && lon >= -90 && lon <= 90) { const s2 = await setor(lon, lat); if (s2) { st = s2; [lat, lon] = [lon, lat]; invertida = true; } }
      if (!st) return { erro: 'A coordenada não está dentro de um setor censitário do Brasil.' };
      const e = await estimar(lat, lon);
      return { ...e, ...st, coordenadas_invertidas: invertida, setor_sem_dado: st.renda_setor === null, versao: idx.nome };
    }
    return { iniciar, estimar, setor, consultar, get index() { return idx; } };
  }

  const api = { criarMotor, ecef, lerBloco, lerQuadricula, contem, arred6, K };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.K8 = api;
})(typeof self !== 'undefined' ? self : this);
