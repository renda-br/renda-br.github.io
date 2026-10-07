// Teste: o núcleo JS (k8.js) reproduz a implementação de referência (Python) nos vetores de teste.
// Uso: node testes/teste_node.js <pasta dados/v1> <vetores.csv>
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const K8 = require(path.join(__dirname, '..', 'js', 'k8.js'));
const [dir, csvPath] = process.argv.slice(2);
const carregar = async (c) => { let b = fs.readFileSync(path.join(dir, c)); if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b); return new Uint8Array(b); };
(async () => {
  const m = K8.criarMotor(carregar); await m.iniciar();
  const linhas = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
  let ok = 0, falhas = [], maxRel = 0;
  const t0 = Date.now();
  for (const [lat, lon, tipo, cd, renda, rArr, raio] of linhas) {
    const st = await m.setor(+lat, +lon);
    if (!cd) { if (st === null) ok++; else falhas.push(`${lat},${lon} (${tipo}): esperado fora, obtido ${st.cd_setor}`); continue; }
    if (!st || st.cd_setor !== cd) { falhas.push(`${lat},${lon}: setor ${st && st.cd_setor} != ${cd}`); continue; }
    const e = await m.estimar(+lat, +lon), rel = Math.abs(e.renda / +renda - 1);
    maxRel = Math.max(maxRel, rel);
    if ((e.renda_centavos / 100).toFixed(2) === rArr && Math.abs(e.raio_m - +raio) < 0.01) ok++;
    else falhas.push(`${lat},${lon}: renda ${e.renda.toFixed(6)} != ${renda} | raio ${e.raio_m.toFixed(3)} != ${raio}`);
  }
  console.log(`vetores: ${linhas.length}  aprovados: ${ok}  falhas: ${falhas.length}  maior dif. relativa: ${maxRel.toExponential(2)}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  falhas.slice(0, 10).forEach((f) => console.log('  FALHA', f));
  process.exit(falhas.length ? 1 : 0);
})();
