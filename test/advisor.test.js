// Test Advisor in-page (v0.7.0) — userscript sebenarnya atas fixture DOM nyata
// (jsdom, runScripts outside-only). Verifikasi:
//   - panel design (Cars) memakai benchmark leagueDesignData + label "estimasi";
//   - panel supply di dalam .supplyDialog saat dialog terbuka;
//   - panel ranking engine+chassis di halaman Manufacturers;
//   - TIDAK ada jejak UI advisor di halaman lain (race dsb.);
//   - advisor tidak pernah mengirim packet mailbox (request game = 0).
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const load = fixtureFile =>
    fs.readFileSync(path.join(__dirname, 'fixtures', fixtureFile), 'utf8');

function bootOn(html, url) {
    const store = new Map();
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window;
    win.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
    win.GM_setValue = (k, v) => { store.set(k, v); };
    win.GM_deleteValue = k => { store.delete(k); };
    win.GM_listValues = () => [...store.keys()];
    win.eval(fs.readFileSync(path.join(__dirname, '../src/igpas.user.js'), 'utf8'));
    win.document.dispatchEvent(new win.Event('DOMContentLoaded')); // idempoten di sisi userscript
    return { win, doc: win.document, store, close: () => win.close() };
}

function assert(ok, msg) { if (!ok) throw new Error(msg); }

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ✔ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + e.message); }
}

const URL_IGP = 'https://www.igpmanager.com/app/p=cars';

t('Design advisor: panel tampil di halaman Cars dgn benchmark max liga + label estimasi', () => {
    const s = bootOn(load('cars.html'), URL_IGP);
    const panel = s.doc.getElementById('igpas-adv-design');
    assert(panel, 'panel design tidak ada');
    assert(panel.previousElementSibling && panel.previousElementSibling.id === 'carAttributesDisplay',
        'panel tidak ditempel tepat setelah atribut mobil');
    const txt = panel.textContent;
    assert(txt.indexOf('Max liga') >= 0, 'kolom max liga tidak tampil (benchmark leagueDesignData tidak terbaca)');
    assert(/estimasi/i.test(txt), 'label estimasi tidak tampil');
    assert(/bukan rumus game/i.test(txt), 'batasan heuristik tidak dinyatakan');
    assert(/Usulan DP/i.test(txt), 'kolom usulan DP tidak tampil');
    s.close();
});

t('Supply advisor: panel di dalam dialog Supply terbuka (engine) + tanda terbaik', () => {
    const s = bootOn(load('supply-engine.html'), URL_IGP);
    const panel = s.doc.getElementById('igpas-adv-supply');
    assert(panel, 'panel supply tidak ada');
    assert(panel.closest('.supplyDialog'), 'panel tidak berada di dalam dialog Supply');
    const txt = panel.textContent;
    assert(txt.indexOf('Σ bonus') >= 0, 'kolom Σ bonus tidak tampil');
    assert(/aktif:\s*supplier\s*#/i.test(txt), 'supplier aktif tidak disebut');
    assert(/estimasi/i.test(txt), 'label estimasi tidak tampil');
    assert(/terbaik nilai|termurah/.test(txt), 'tanda terbaik/termurah tidak tampil');
    s.close();
});

t('Manufacturers advisor: ranking engine & chassis di halaman manufacturers', () => {
    const s = bootOn(load('manufacturers-engines.html'), 'https://www.igpmanager.com/app/p=manufacturers');
    const pe = s.doc.getElementById('igpas-adv-mfg-engine');
    const pc = s.doc.getElementById('igpas-adv-mfg-chassis');
    assert(pe && pe.nextElementSibling && pe.nextElementSibling.id === 'engine-table',
        'panel engine tidak tepat sebelum tabel engine');
    assert(pc && pc.nextElementSibling && pc.nextElementSibling.id === 'chassis-table',
        'panel chassis tidak tepat sebelum tabel chassis');
    const txtE = pe.textContent;
    assert(txtE.indexOf('Rating/1M') >= 0, 'kolom efisiensi engine tidak tampil');
    assert(/estimasi/i.test(txtE), 'label estimasi tidak tampil');
    assert(/pager/i.test(txtE), 'batasan pager tidak dijelaskan');
    assert(pc.textContent.indexOf('rating tertinggi') >= 0 || pc.textContent.indexOf('Rating') >= 0,
        'konten ranking chassis kosong');
    s.close();
});

t('Keamanan: halaman lain (race/unknown) tidak mendapat UI advisor sedikit pun', () => {
    const s = bootOn('<!doctype html><html><body><input id="pageId" value="race"></body></html>',
        'https://www.igpmanager.com/app/index.php?page=raceStrategy');
    for (const id of ['igpas-adv-toggle', 'igpas-adv-design', 'igpas-adv-supply', 'igpas-adv-mfg-engine', 'igpas-adv-mfg-chassis']) {
        assert(!s.doc.getElementById(id), 'elemen advisor bocor di halaman race: ' + id);
    }
    s.close();
});

t('Advisor read-only: tidak mengirim packet mailbox (tidak memicu request game)', () => {
    const s = bootOn(load('cars.html'), URL_IGP);
    const sent = [...s.store.keys()].filter(k => k.indexOf('igpas:mb:collect-') === 0);
    assert(!sent.length, 'advisor mengirim collect-request: ' + sent.join(','));
    s.close();
});

t('Toggle advisor: sembunyikan/sembunyikan panel, aria-pressed sinkron, preferensi persist', () => {
    const s = bootOn(load('cars.html'), URL_IGP);
    const btn = s.doc.getElementById('igpas-adv-toggle');
    assert(btn, 'tombol toggle tidak ada');
    btn.click();
    assert(s.doc.body.classList.contains('igpas-adv-hide'), 'panel tidak tersembunyi setelah toggle');
    assert(btn.getAttribute('aria-pressed') === 'true', 'aria-pressed tidak true saat sembunyi');
    assert((s.store.get('igpas:advisor') || {}).hidden === true, 'preferensi tidak tersimpan');
    btn.click();
    assert(!s.doc.body.classList.contains('igpas-adv-hide'), 'panel tidak tampil kembali');
    s.close();
});

console.log((fail ? '\n' : '') + (pass + fail) + ' test advisor, ' + fail + ' gagal' + (fail ? '' : ' — semua lulus ✔'));
process.exit(fail ? 1 : 0);
