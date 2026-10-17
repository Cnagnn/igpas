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

function bootOn(html, url, snapshotIds) {
    const store = new Map();
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window;
    win.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
    win.GM_setValue = (k, v) => { store.set(k, v); };
    win.GM_deleteValue = k => { store.delete(k); };
    win.GM_listValues = () => [...store.keys()];
    win.GM_setClipboard = () => {};            // stub; test override utk capture
    win.GM_registerMenuCommand = (label, fn) => { win.__igpasMenuHandler = fn; };
    win.GM_notification = () => {};
    // Snapshot innerHTML SEBELUM userscript jalan (untuk uji "dokumen tak berubah").
    const before = {};
    for (const id of (snapshotIds || [])) {
        const el = win.document.getElementById(id);
        before[id] = el ? el.innerHTML : null;
    }
    win.eval(fs.readFileSync(path.join(__dirname, '../src/igpas.user.js'), 'utf8'));
    win.document.dispatchEvent(new win.Event('DOMContentLoaded')); // idempoten di sisi userscript
    return { win, doc: win.document, store, before, close: () => win.close() };
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

t('Supply advisor: dialog Fuel — panel tampil dengan tipe fuel', () => {
    const s = bootOn(load('supply-fuel.html'), URL_IGP);
    const panel = s.doc.getElementById('igpas-adv-supply');
    assert(panel && panel.closest('.supplyDialog'), 'panel supply fuel tidak ada di dialog');
    assert(/supply\s*·\s*fuel/i.test(panel.textContent), 'tipe fuel tidak tercantum di panel');
    s.close();
});

t('Supply advisor: dialog Tyre — panel tampil dengan tipe tyre', () => {
    const s = bootOn(load('supply-tyre.html'), URL_IGP);
    const panel = s.doc.getElementById('igpas-adv-supply');
    assert(panel && panel.closest('.supplyDialog'), 'panel supply tyre tidak ada di dialog');
    assert(/supply\s*·\s*tyre/i.test(panel.textContent), 'tipe tyre tidak tercantum di panel');
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

t('Keamanan: halaman lain (race tanpa wadah tab/unknown) tidak mendapat UI advisor sedikit pun', () => {
    const s = bootOn('<!doctype html><html><body><input id="pageId" value="race"></body></html>',
        'https://www.igpmanager.com/app/index.php?page=raceStrategy');
    for (const id of ['igpas-adv-toggle', 'igpas-adv-design', 'igpas-adv-supply', 'igpas-adv-mfg-engine', 'igpas-adv-mfg-chassis',
        'igpas-adv-team', 'igpas-adv-tx-driver', 'igpas-adv-tx-staff',
        'igpas-adv-rsetup', 'igpas-adv-rsetup-wrap', 'igpas-adv-rstrategy', 'igpas-adv-rstrategy-wrap']) {
        assert(!s.doc.getElementById(id), 'elemen advisor bocor di halaman race: ' + id);
    }
    assert(!s.doc.querySelector('.igpas-adv-panel'), 'panel advisor bocor di race tanpa wadah tab');
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

t('PageCapture: menu Tampermonkey menyalin DOM dengan PII teredaksi (tanpa UI halaman)', () => {
    const s = bootOn(
        '<!doctype html><html><body>' +
        '<input id="pageId" value="develop">' +
        '<span id="myProfileName">Rahasia Manager</span>' +
        '<span id="balanceText">$12.345.678</span>' +
        '<span id="tokens-total">42</span>' +
        '<span id="managerRankValue">1234</span>' +
        '<div id="design-target">Design page harness</div>' +
        '</body></html>',
        'https://www.igpmanager.com/app/p=develop');
    const captured = [];
    // simulasi menu capture user-driven (tidak ada UI yang di-inject ke halaman)
    s.win.GM_setClipboard = (data, type) => captured.push({ data: data, type: type });
    const handler = s.win.__igpasMenuHandler;
    assert(typeof handler === 'function', 'menu capture tidak terdaftar');
    assert(!s.doc.getElementById('igpas-adv-toggle') && !s.doc.getElementById('igpas-adv-design'),
        'halaman develop belum terpetakan tapi ada UI advisor (harusnya tidak)');
    handler();
    assert(captured.length === 1, 'clipboard tidak terisi');
    assert(captured[0].type === 'text/html', 'tipe clipboard bukan text/html');
    const html = captured[0].data;
    assert(html.indexOf('Rahasia Manager') === -1 && html.indexOf('[REDACTED]') >= 0, 'nama manager tidak teredaksi');
    assert(html.indexOf('$12.345.678') === -1, 'saldo tidak teredaksi');
    assert(html.indexOf('>42<') === -1, 'token tidak teredaksi');
    assert(html.indexOf('1234') === -1, 'angka rank tidak teredaksi');
    assert(html.indexOf('design-target') >= 0, 'isi DOM halaman tidak ikut tersalin');
    s.close();
});

t('Staff advisor: panel kondisi tim di halaman staff (health rendah ditandai, pit crew terkunci disebut)', () => {
    const s = bootOn(load('staff.html'), 'https://www.igpmanager.com/app/p=staff');
    const panel = s.doc.getElementById('igpas-adv-team');
    assert(panel, 'panel team tidak ada');
    assert(panel.previousElementSibling && panel.previousElementSibling.id === 'drivers',
        'panel tidak ditempel tepat setelah blok driver');
    const txt = panel.textContent;
    assert(txt.indexOf('Syarif Hartono') >= 0, 'nama driver 1 tidak tampil');
    assert(txt.indexOf('Kevin Yudhoyono') >= 0, 'nama driver 2 tidak tampil');
    assert(txt.indexOf('sehat rendah') >= 0, 'peringatan health rendah tidak tampil (health 2%)');
    assert(txt.indexOf('Chief Designer') >= 0 && txt.indexOf('Technical Director') >= 0 && txt.indexOf('Doctor') >= 0,
        'kartu staff/roleId tidak tampil');
    assert(txt.indexOf('unlock at level 5') >= 0, 'status pit crew terkunci tidak disebut');
    assert(/estimasi/i.test(txt), 'label estimasi tidak tampil');
    s.close();
});

t('Transfers advisor: panel driver pasar (rank, overall, fee, special ability)', () => {
    const s = bootOn(load('transfers.html'), 'https://www.igpmanager.com/app/p=transfers');
    const panel = s.doc.getElementById('igpas-adv-tx-driver');
    assert(panel, 'panel driver transfer tidak ada');
    assert(panel.nextElementSibling && panel.nextElementSibling.id === 'driver-table',
        'panel tidak tepat sebelum tabel driver');
    const txt = panel.textContent;
    assert(txt.indexOf('Breno Maur') >= 0, 'driver terbaik (39.51) tidak di baris atas');
    assert(txt.indexOf('rating tertinggi') >= 0 && txt.indexOf('nilai terbaik') >= 0, 'tanda belum lengkap');
    assert(txt.indexOf('Street circuits') >= 0, 'special ability tidak tampil');
    assert(txt.indexOf('Overall/1M') >= 0, 'kolom heuristik value tidak tampil');
    assert(/estimasi/i.test(txt), 'label estimasi tidak tampil');
    const firstRowRank = panel.querySelector('tbody tr td');
    assert(firstRowRank && firstRowRank.textContent.indexOf('Breno') > -1, 'urutan #1 bukan overall tertinggi');
    s.close();
});

t('Transfers advisor: panel staff pasar per peran (CD/TD/DR + spesialisasi hijau/merah)', () => {
    const s = bootOn(load('transfers.html'), 'https://www.igpmanager.com/app/p=transfers');
    const panel = s.doc.getElementById('igpas-adv-tx-staff');
    assert(panel, 'panel staff transfer tidak ada');
    assert(panel.nextElementSibling && panel.nextElementSibling.id === 'staff-table',
        'panel tidak tepat sebelum tabel staff');
    const txt = panel.textContent;
    assert(txt.indexOf('Chief Designer') >= 0 && txt.indexOf('Technical Director') >= 0 && txt.indexOf('Doctor') >= 0,
        'kelompok peran tidak tampil');
    assert(txt.indexOf('+Tyre economy') >= 0 && txt.indexOf('−Braking') >= 0,
        'trait hijau/merah CD terbaik tidak tampil');
    assert(txt.indexOf('Kerekes') === -1, 'data yang tidak ada di fixture tidak boleh muncul');
    assert(/heuristik estimasi/i.test(txt), 'label heuristik tidak tampil');
    s.close();
});

/* ---------- Race (v0.7.3; v0.7.4: capture practice nyata): estimasi Setup & Strategy ---------- */

const URL_RACE = 'https://www.igpmanager.com/app/index.php?page=race&tab=race';

t('Race: panel estimasi setup dari capture practice nyata (ideal menyempit + arah game + lap terakhir)', () => {
    const s = bootOn(load('race.html'), URL_RACE);
    const panel = s.doc.getElementById('igpas-adv-rsetup');
    assert(panel, 'panel setup race tidak ada');
    assert(panel.closest('#setup'), 'panel setup tidak berada di dalam #setup');
    const wrap = s.doc.getElementById('igpas-adv-rsetup-wrap');
    assert(wrap && wrap.contains(panel) && wrap.parentNode === s.doc.getElementById('setup'),
        'wrapper setup race salah tempat');
    const txt = panel.textContent;
    const tblTxt = panel.querySelector('table').textContent; // tabel slider
    assert(txt.indexOf('Estimasi ideal setup') >= 0, 'judul panel setup tidak ada');
    // Car 1: bar ideal menyempit (85%, kiri 0/15/0) → mid-bar + selisih + arah label game
    assert(tblTxt.indexOf('≈ 42.5') >= 0, 'mid ideal ride/wing (0 + 85/2 = 42.5) tidak tampil');
    assert(tblTxt.indexOf('≈ 57.5') >= 0, 'mid ideal suspension (15 + 85/2 = 57.5) tidak tampil');
    assert(txt.indexOf('+7.5') >= 0 && txt.indexOf('-7.5') >= 0, 'selisih arah (+7.5/−7.5) tidak tampil');
    assert(txt.indexOf('↓ kurangi') >= 0 && txt.indexOf('↑ tambah') >= 0,
        'arah game dari kelas label decrease/increase tidak tampil');
    // Car 2: tanpa lap practice → bar penuh = "belum dipelajari" ×3, tanpa angka karangan
    const und = tblTxt.split('belum dipelajari').length - 1;
    assert(und === 3, 'ketiga slider car 2 harus "belum dipelajari", dapat ' + und);
    assert(tblTxt.split('≈').length - 1 === 3, 'hanya 3 mid-bar (car 1) yang boleh muncul — ada angka ideal karangan');
    // Nama generik dari fixture ternsanitasi (blok nama car 2 = driver2Include tersembunyi)
    assert(txt.indexOf('Andi Pratama') >= 0 && txt.indexOf('Budi Santoso') >= 0, 'nama driver generik tidak terbaca');
    // Kondisi: game hanya merender blok health untuk mobil yang rusak (car 2: 8%)
    assert(txt.indexOf('kritis — repair dulu') >= 0 && txt.indexOf('8%') >= 0, 'health 8% tidak ditandai kritis');
    // Komentar engineer dua mobil (kata game)
    assert(txt.indexOf('much too high') >= 0 && txt.indexOf('bad shape') >= 0, 'komentar engineer tidak dikutip');
    // Cuaca dari c-head form setup (.waterLevelText + .weatherTemp "5°C")
    assert(txt.indexOf('kering') >= 0 && txt.indexOf('0mm') >= 0 && txt.indexOf('5°C') >= 0, 'cuaca tidak terbaca');
    // Lap practice terakhir dari tabel game (waktu + pemakaian bensin/ban)
    assert(txt.indexOf('1:22.512') >= 0 && txt.indexOf('-2.4') >= 0 && txt.indexOf('-8%') >= 0,
        'lap practice terakhir (waktu/bensin/ban) tidak tampil');
    assert(txt.indexOf('jalankan practice untuk mempersempit ideal') >= 0,
        'car 2 tanpa practice harus diminta jalankan practice');
    assert(/Estimasi — bukan rumus game/.test(txt), 'label estimasi tidak ada');
    s.close();
});

t('Race: panel ringkasan strategi dari capture practice nyata (fuel 2.460, push level, umur ban)', () => {
    const s = bootOn(load('race.html'), URL_RACE);
    const panel = s.doc.getElementById('igpas-adv-rstrategy');
    assert(panel, 'panel strategi race tidak ada');
    assert(panel.closest('#strategy'), 'panel strategi tidak berada di dalam #strategy');
    const txt = panel.textContent;
    assert(txt.indexOf('Ringkasan strategi') >= 0, 'judul panel strategi tidak ada');
    assert(txt.indexOf('64/63 lap') >= 0, 'alokasi lap 4 stint (64) vs laps balapan (63) salah');
    // Car 1: fuel prediction presisi game 2.460 L/lap → 63 × 2.46 = 154.98 → ±155 L
    assert(txt.indexOf('174 L vs ±155 L') >= 0 && txt.indexOf('sisa 19 L') >= 0 && txt.indexOf('≈7.7 lap') >= 0,
        'hitungan bensin car 1 (2.460 L/lap) tidak sesuai');
    // Car 2: fuel prediction 2.5 L/lap → 157.5 / buffer 16.5 / ≈6.6 lap
    assert(txt.indexOf('±157.5 L') >= 0 && txt.indexOf('16.5 L') >= 0 && txt.indexOf('6.6 lap') >= 0,
        'hitungan bensin car 2 (2.5 L/lap) tidak sesuai');
    assert(txt.indexOf('M, M, M, S') >= 0, 'susunan ban stint tidak terbaca dari JSON game');
    assert(txt.indexOf('2 compound kering ✓') >= 0, 'cek dua-compound (two_tyres=1) gagal');
    assert(txt.indexOf('risiko 60') >= 0, 'risk_level game tidak ditampilkan');
    assert(txt.indexOf('push 60') >= 0, 'push level (select game) tidak ditampilkan');
    assert(txt.indexOf('umur ban game: SS ±12 lap') >= 0, '#d1TyreLife {"SS":12} tidak dikonsumsi');
    assert(txt.indexOf('Driver utama') >= 0, 'label driver utama tidak ada');
    assert(txt.indexOf('snapshot') >= 0, 'catatan snapshot (data bisa berubah) tidak ada');
    s.close();
});

t('Race: tab Race LIVE tetap 100% bersih — tanpa node advisor & elemen game tak berubah', () => {
    const s = bootOn(load('race.html'), URL_RACE, ['race']);
    const liveTab = s.doc.getElementById('race');
    assert(liveTab, 'tab #race hilang dari fixture');
    assert(s.before.race === liveTab.innerHTML,
        'innerHTML tab Race LIVE berubah setelah boot — pelanggaran read-only');
    assert(!s.doc.querySelector('#race .igpas-adv-panel, #race [id^="igpas-adv"]'),
        'ada elemen advisor di dalam tab #race');
    assert(s.doc.getElementById('igpas-adv-rsetup') && s.doc.getElementById('igpas-adv-rstrategy'),
        'panel race harusnya tetap terpasang di #setup/#strategy (bukan dihapus seluruhnya)');
    s.close();
});

t('Race: zero panel lain + mailbox tetap senyap di halaman race', () => {
    const s = bootOn(load('race.html'), URL_RACE);
    for (const id of ['igpas-adv-design', 'igpas-adv-supply', 'igpas-adv-mfg-engine',
        'igpas-adv-mfg-chassis', 'igpas-adv-team', 'igpas-adv-tx-driver', 'igpas-adv-tx-staff']) {
        assert(!s.doc.getElementById(id), 'panel halaman studi bocor ke race: ' + id);
    }
    assert(s.doc.getElementById('igpas-adv-toggle'), 'toggle advisor harus ada saat panel race tampil');
    const sent = [...s.store.keys()].filter(k => k.indexOf('igpas:mb:collect-') === 0);
    assert(!sent.length, 'advisor race mengirim collect-request: ' + sent.join(','));
    s.close();
});

console.log((fail ? '\n' : '') + (pass + fail) + ' test advisor, ' + fail + ' gagal' + (fail ? '' : ' — semua lulus ✔'));
process.exit(fail ? 1 : 0);
