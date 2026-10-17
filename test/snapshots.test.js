// Test adapter snapshot Fase 3 — DOM nyata hasil capture (fixture jsdom).
// Adapter HARUS lulus di sini karena selektor dipetakan dari halaman iGP asli.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { AdapterRegistry, Storage } = require('../src/igpas.user.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ✔ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
        throw new Error((msg || '') + ' ' + JSON.stringify(a) + ' != ' + JSON.stringify(b));
    }
}

const carsDoc = new JSDOM(fs.readFileSync(path.join(__dirname, 'fixtures/cars.html'), 'utf8')).window.document;
const accDoc = new JSDOM(fs.readFileSync(path.join(__dirname, 'fixtures/account.html'), 'utf8')).window.document;
const blankDoc = new JSDOM('<html><body></body></html>').window.document;

t('car-data: gate pageId — halaman lain ditolak', () => {
    const r = AdapterRegistry.capture('car-data', blankDoc);
    eq(r.ok, false);
});

t('car-data: atribut mobil terbaca (8 kanal kanonis)', () => {
    const r = AdapterRegistry.capture('car-data', carsDoc);
    eq(r.ok, true);
    eq(r.data.carType, 'Sprint car');
    eq(r.data.dmax, 300);
    eq(r.data.designPoints, 200);
    eq(r.data.attrs.acceleration, { label: 'Acceleration', val: 53 });
    eq(r.data.attrs.tyre_economy.val, 47);
    eq(Object.keys(r.data.attrs).length, 8);
});

t('car-data: bonus supplier terurai dari data-tip', () => {
    const r = AdapterRegistry.capture('car-data', carsDoc);
    eq(r.data.bonuses.find(b => b.key === 'Braking').bonus, 15);
    eq(r.data.bonuses.find(b => b.key === 'Fuel economy').bonus, -7);
    eq(r.data.bonuses.length, 8);
});

t('car-data: id supplier dari filename gambar', () => {
    const r = AdapterRegistry.capture('car-data', carsDoc);
    eq(r.data.suppliers, [
        { kind: 'engines', id: '2' },
        { kind: 'fuel', id: '8' },
        { kind: 'tyres', id: '13' },
    ]);
});

t('car-data: best rival dari leagueDesignData', () => {
    const r = AdapterRegistry.capture('car-data', carsDoc);
    eq(r.data.best.acceleration.max, 300);
    eq(r.data.best.braking.max, 300);
});

t('account-data: header akun terbaca penuh', () => {
    const r = AdapterRegistry.capture('account-data', accDoc);
    eq(r.ok, true);
    eq(r.data, {
        manager: 'Tester', level: 'L7', rank: '1200',
        rankTier: 'challenger-i', balance: '8.4m', tokens: '12',
    });
});

t('account-data: halaman kosong ditolak', () => {
    const r = AdapterRegistry.capture('account-data', blankDoc);
    eq(r.ok, false);
});

t('account-data: valid di halaman Cars (header global)', () => {
    const r = AdapterRegistry.capture('account-data', carsDoc);
    eq(r.ok, true);
    eq(r.data.balance, '8.4m');
});

t('adapter belum ada -> pesan error jujur', () => {
    const r = AdapterRegistry.capture('manufacturer-data', carsDoc);
    eq(r.ok, false);
    if (!/belum tersedia/.test(r.error)) throw new Error(r.error);
});

t('status registry jujur (ready vs menunggu-map)', () => {
    eq(AdapterRegistry.status(),
        'account-data:ready, car-data:ready, manufacturer-data:menunggu-map, race-strategy:menunggu-map');
});

t('Storage: snapshot simpan/baca/hapus', () => {
    Storage.saveSnapshot('account-data', { manager: 'X' });
    eq(Storage.getSnapshot('account-data').data.manager, 'X');
    Storage.saveSnapshot('car-data', { carType: 'Y' });
    eq(Storage.getSnapshot('car-data').data.carType, 'Y');
    Storage.clearSnapshots();
    eq(Storage.getSnapshot('account-data'), null);
    eq(Storage.getSnapshot('car-data'), null);
});

console.log(pass + fail + ' test, ' + fail + ' gagal');
if (fail > 0) process.exit(1);
