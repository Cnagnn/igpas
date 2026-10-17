// Test GUI Command Center (jsdom, shell nyata docs/app/index.html) — I.G.P.A.S v0.5.1.
// Menguji: mount wiring, autoload saat halaman "dibuka" (collect-request + report-request),
// agregasi hasil per-kind (reqId), simpan snapshot, dan tombol Capture manual.
// Proses terpisah: GM_* + document/location di-stub SEBELUM require (ROLE → 'gui').
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => { store.set(k, v); };
global.GM_deleteValue = (k) => { store.delete(k); };
global.GM_listValues = () => Array.from(store.keys());

const shell = fs.readFileSync(path.join(__dirname, '../docs/app/index.html'), 'utf8');
const dom = new JSDOM(shell, { url: 'https://cnagnn.github.io/igpas/app/' });
global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;

require('../src/igpas.user.js'); // boot() → ROLE 'gui' → GuiMaster.mount()

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ✔ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert gagal'); }
const $ = id => dom.window.document.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms));
const mbPackets = () => Array.from(store.entries())
    .filter(([k]) => k.indexOf('igpas:mb:') === 0)
    .map(([, v]) => v)
    .filter(v => v && typeof v === 'object');

let autoReqId = null;

(async () => {
    await wait(80);
    if (!$('igpas-gui-version').textContent) { // jsdom belum fire DOMContentLoaded — picu manual
        dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
        await wait(80);
    }

    t('mount: badge versi + mode live (userscript aktif)', () => {
        assert($('igpas-gui-version').textContent === 'GUI v0.5.1',
            'versi: ' + $('igpas-gui-version').textContent);
        assert(/live/.test($('igpas-gui-mode').textContent), 'mode tidak live');
    });

    t('autoload: saat dibuka → collect-request (akun+mobil, reqId) + report-request', () => {
        const reqs = mbPackets().filter(p => p.type === 'collect-request');
        const auto = reqs.find(p => p.payload && Array.isArray(p.payload.kinds) &&
            p.payload.kinds.indexOf('account-data') >= 0 && p.payload.kinds.indexOf('car-data') >= 0);
        assert(auto, 'tidak ada collect-request autoload');
        assert(typeof auto.payload.reqId === 'string' && auto.payload.reqId, 'reqId hilang');
        assert(mbPackets().some(p => p.type === 'report-request'), 'report-request (deteksi) tidak terkirim');
        assert($('igpas-snap-status').textContent.indexOf('autoload') === 0,
            'status: ' + $('igpas-snap-status').textContent);
        autoReqId = auto.payload.reqId;
    });

    // Sensor menjawab: akun sukses; mobil gagal (tab iGP bukan di halaman Cars).
    store.set('igpas:mb:res1', {
        id: 'res1', type: 'collect-result', to: '*', from: 'sensor:test', ts: Date.now(),
        payload: { reqId: autoReqId, kind: 'account-data', ok: true,
            data: { manager: 'Tester', level: 'Level 7', rank: '1200', rankTier: 'Gold', balance: '8.4m', tokens: '12' },
            error: null, pageUrl: 'https://igpmanager.com/' } });
    store.set('igpas:mb:res2', {
        id: 'res2', type: 'collect-result', to: '*', from: 'sensor:test', ts: Date.now(),
        payload: { reqId: autoReqId, kind: 'car-data', ok: false, data: null,
            error: 'halaman tidak cocok untuk car-data', pageUrl: 'https://igpmanager.com/' } });

    await wait(900); // mailbox poll 400 ms

    t('hasil masuk: ringkasan per-kind + snapshot akun tersimpan + kartu terisi', () => {
        const s = $('igpas-snap-status').textContent;
        assert(s.indexOf('akun ✓') >= 0, 'ringkasan akun: ' + s);
        assert(s.indexOf('mobil ✗') >= 0, 'ringkasan mobil: ' + s);
        assert(s.indexOf('selesai') >= 0, 'tidak final: ' + s);
        const snaps = store.get('igpas:snapshots') || {};
        assert(snaps['account-data'] && snaps['account-data'].data.manager === 'Tester', 'snapshot akun tidak tersimpan');
        assert($('igpas-snap-account-body').textContent.indexOf('Tester') >= 0, 'kartu akun tidak terisi');
        assert($('igpas-snap-badge').textContent.indexOf('akun ✓') >= 0, 'badge: ' + $('igpas-snap-badge').textContent);
    });

    t('Capture manual: klik tombol → permintaan baru (reqId berbeda)', () => {
        $('igpas-snap-capture').click();
        const reqs = mbPackets().filter(p => p.type === 'collect-request');
        const last = reqs[reqs.length - 1];
        assert(last && last.payload.reqId !== autoReqId, 'tidak ada permintaan manual baru');
        assert($('igpas-snap-status').textContent.indexOf('Capture') === 0,
            'status: ' + $('igpas-snap-status').textContent);
    });

    console.log('\n' + pass + ' test, ' + fail + ' gagal' + (fail ? '' : ' — semua lulus ✔'));
    process.exit(fail ? 1 : 0);
})();
