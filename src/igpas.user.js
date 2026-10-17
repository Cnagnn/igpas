// ==UserScript==
// @name         I.G.P.A.S — iGP Analytics & Study System
// @namespace    https://github.com/Cnagnn/igpas
// @version      0.3.0
// @description  Race strategy study calculators for iGP Manager (fuel, tyres, pit window, stints). Manual input — study tool only, no live-race assistance, no automation.
// @description:id Kalkulator analisis & studi strategi iGP Manager (fuel, ban, pit window, stint). Input manual — alat studi, bukan bantuan saat balapan, tanpa otomasi.
// @license      GPL-3.0-or-later
// @homepageURL  https://github.com/Cnagnn/igpas
// @supportURL   https://github.com/Cnagnn/igpas/issues
// @match        https://igpmanager.com/*
// @match        https://*.igpmanager.com/*
// @match        http://localhost/*
// @match        https://cnagnn.github.io/igpas/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @run-at       document-idle
// ==/UserScript==

(function IGPAS() {
    'use strict';

    const VERSION = '0.3.0';

    /* =====================================================================
     * 1) CORE — fungsi murni, tanpa DOM. Teruji di Node (test/core.test.js).
     *    Semua perhitungan hanya aritmetika atas input pengguna.
     * ===================================================================== */

    const r1 = v => Math.round(v * 10) / 10;

    const IGPCore = Object.freeze({

        /**
         * Perencanaan fuel.
         * @param {object} p { lapsRemaining, fuelPerLap, currentFuel, reserveLaps, tankCapacity }
         * @returns {object} { ok, rows:[ {key,label,text} ], values:{...} }
         */
        calcFuel(p) {
            const lapsRemaining = Number(p.lapsRemaining);
            const fuelPerLap = Number(p.fuelPerLap);
            const currentFuel = Number(p.currentFuel);
            const reserveLaps = Number(p.reserveLaps);
            const tank = p.tankCapacity === '' || p.tankCapacity == null
                ? Infinity : Number(p.tankCapacity);

            if (!(lapsRemaining >= 0)) return { ok: false, error: 'Laps remaining harus >= 0' };
            if (!(fuelPerLap > 0)) return { ok: false, error: 'Fuel/lap harus > 0' };
            if (!(currentFuel >= 0)) return { ok: false, error: 'Fuel kini harus >= 0' };

            const reserve = reserveLaps > 0 ? reserveLaps : 0;
            const fuelNeeded = lapsRemaining * fuelPerLap;
            const totalRequired = fuelNeeded + reserve * fuelPerLap;
            const fuelToAdd = Math.max(0, totalRequired - currentFuel);
            const lapsLeftOnFuel = currentFuel / fuelPerLap;
            const totalWithAdd = currentFuel + fuelToAdd;
            const overCapacity = (totalWithAdd > tank)
                ? r1(totalWithAdd - tank) : 0;

            return {
                ok: true,
                values: { fuelNeeded: r1(fuelNeeded), fuelToAdd: r1(fuelToAdd), lapsLeftOnFuel: r1(lapsLeftOnFuel), overCapacity },
                rows: [
                    ['Total kebutuhan ('+lapsRemaining+' lap)', r1(fuelNeeded) + ' L'],
                    ['+ Reserve ('+reserve+' lap)', r1(reserve * fuelPerLap) + ' L'],
                    ['Fuel ditambahkan', r1(fuelToAdd) + ' L'],
                    ['Jarak fuel sekarang', r1(lapsLeftOnFuel) + ' lap'],
                    ...(overCapacity > 0 ? [['⚠ Melebihi tangki', overCapacity + ' L']] : []),
                ],
            };
        },

        /**
         * Proyeksi keausan ban per lap.
         * @param {object} p { currentWearPct, wearPerLapPct, lapsCount }
         */
        projectTireWear(p) {
            const cur = Number(p.currentWearPct);
            const wpl = Number(p.wearPerLapPct);
            const laps = Number(p.lapsCount);

            if (!(cur >= 0 && cur <= 100)) return { ok: false, error: 'Wear kini harus 0–100' };
            if (!(wpl >= 0)) return { ok: false, error: 'Wear/lap harus >= 0' };
            if (!(laps >= 1 && laps <= 200)) return { ok: false, error: 'Horizon 1–200 lap' };

            const rows = [];
            for (let n = 0; n <= laps; n++) {
                rows.push([ 'lap +' + n, r1(Math.min(100, cur + n * wpl)) + ' %' ]);
            }
            const lapsTo100 = wpl > 0 ? Math.floor((100 - cur) / wpl) : Infinity;
            return {
                ok: true,
                values: { lapsTo100 },
                rows,
            };
        },

        /**
         * Lap sampai wear mencapai threshold.
         * @param {object} p { currentWearPct, wearPerLapPct, thresholdPct }
         */
        lapsToThreshold(p) {
            const cur = Number(p.currentWearPct);
            const wpl = Number(p.wearPerLapPct);
            const thr = Number(p.thresholdPct);

            if (!(cur >= 0 && cur <= 100)) return { ok: false, error: 'Wear kini harus 0–100' };
            if (!(wpl >= 0)) return { ok: false, error: 'Wear/lap harus >= 0' };
            if (!(thr > cur)) return { ok: false, error: 'Threshold harus > wear kini' };

            const laps = wpl > 0 ? Math.floor((thr - cur) / wpl) : Infinity;
            return {
                ok: true,
                values: { laps },
                rows: [
                    ['Lap sampai ' + thr + '%', (laps === Infinity ? '∞ (tidak terbatas)' : laps + ' lap')],
                ],
            };
        },

        /**
         * Jendela pit: berapa lap lagi maksimal sebelum wajib pit.
         * @param {object} p { lapsLeftOnFuel, reserveLaps, tireLaps, marginLaps }
         */
        pitWindow(p) {
            const fuelLaps = Number(p.lapsLeftOnFuel);
            const reserveLaps = Number(p.reserveLaps) || 0;
            const tireLaps = (p.tireLaps === '' || p.tireLaps == null) ? Infinity : Number(p.tireLaps);
            const margin = Number(p.marginLaps) || 0;

            if (!(fuelLaps >= 0)) return { ok: false, error: 'Laps left on fuel >= 0' };
            if (!(tireLaps > 0)) return { ok: false, error: 'Tire laps harus > 0' };

            const fuelLatest = Math.max(0, Math.floor(fuelLaps - reserveLaps));
            const latest = Math.min(fuelLatest, tireLaps);
            const recommended = Math.max(0, latest - margin);
            const needPitNow = latest < 1;

            return {
                ok: true,
                values: { fuelLatest, tireLatest: (tireLaps === Infinity ? Infinity : tireLaps), latest, recommended },
                rows: [
                    ['Batas oleh fuel', fuelLatest + ' lap'],
                    ['Batas oleh ban', (tireLaps === Infinity ? '∞' : tireLaps + ' lap')],
                    ['Latest pit setelah', latest + ' lap'],
                    ['Rekomendasi (−margin)', recommended + ' lap'],
                    ...(needPitNow ? [['⚠', 'Pit sekarang — tidak bisa menunggu 1 lap penuh']] : []),
                ],
            };
        },

        /**
         * Pembagian stint merata.
         * @param {object} p { totalLaps, tireLifeLaps, pitLossLaps }
         */
        stintSplit(p) {
            const total = Number(p.totalLaps);
            const life = Number(p.tireLifeLaps);
            const pitLoss = Number(p.pitLossLaps) || 0;

            if (!(total >= 1)) return { ok: false, error: 'Total lap >= 1' };
            if (!(life > 0)) return { ok: false, error: 'Umur ban harus > 0' };

            const segments = Math.ceil(total / life);
            const stops = segments - 1;
            const rem = total % segments;
            const base = (total - rem) / segments;
            const stints = Array.from({ length: segments }, (_, i) => base + (i < rem ? 1 : 0));
            const timeCostLaps = r1(stops * pitLoss);

            return {
                ok: true,
                values: { stops, segments, stints, timeCostLaps },
                rows: [
                    ['Stop minimum', stops + '×'],
                    ['Distribusi stint', stints.join(' / ') + ' lap'],
                    ['Total cost pit', timeCostLaps + ' lap-equivalent'],
                ],
            };
        },

        /**
         * Rekomendasi keputusan pit — deterministik dan transparan.
         * @param {object} p { lapsLeftOnFuel, tyreLapsLeft, reserveLaps, pitLossLaps, marginLaps }
         */
        strategyRecommendation(p) {
            const fuelLaps = Number(p.lapsLeftOnFuel);
            const tyreRaw = (p.tyreLapsLeft === '' || p.tyreLapsLeft == null) ? Infinity : Number(p.tyreLapsLeft);
            const reserve = Number(p.reserveLaps) || 0;
            const pitLoss = Number(p.pitLossLaps) || 0;
            const margin = Number(p.marginLaps) || 0;

            if (!(fuelLaps >= 0)) return { ok: false, error: 'Laps left on fuel >= 0' };
            if (!(tyreRaw > 0)) return { ok: false, error: 'Tyre laps harus > 0' };
            if (!(reserve >= 0) || !(pitLoss >= 0) || !(margin >= 0)) {
                return { ok: false, error: 'Reserve/pit-loss/margin >= 0' };
            }

            const fuelLatest = Math.max(0, Math.floor(fuelLaps - reserve));
            const latest = Math.min(fuelLatest, tyreRaw);
            const limiting = fuelLatest < tyreRaw ? 'fuel' : (tyreRaw < fuelLatest ? 'tyre' : 'tie');
            const recommended = Math.max(0, latest - margin);

            const decision = latest < 1 ? 'pit-now' : (recommended <= 1 ? 'pit-soon' : 'plan');

            return {
                ok: true,
                values: { decision, latest, recommended, limiting, pitLoss },
                rows: [
                    ['Keputusan', decision],
                    ['Faktor pembatas', limiting],
                    ['Latest pit setelah', latest + ' lap'],
                    ['Rekomendasi (−margin)', recommended + ' lap'],
                    ['Biaya pit', pitLoss + ' lap-equivalent'],
                    ...(latest < 1 ? [['⚠', 'Tidak bisa menunggu 1 lap penuh']] : []),
                ],
            };
        },

        /**
         * Peringkat opsi (manufaktur / mobil / bagian) dengan bobot kriteria.
         * Asumsi eksplisit: rating 0–10 dari pengguna; skor = Σ(rating·bobot)/Σbobot.
         * @param {object} p { items:[{name, ratings:{k:v}}], weights:{k:w} }
         */
        rankOptions(p) {
            const items = (p && Array.isArray(p.items)) ? p.items : null;
            const weights = (p && p.weights && typeof p.weights === 'object') ? p.weights : {};
            if (!items || items.length < 1) return { ok: false, error: 'Minimal 1 item' };
            if (items.length > 50) return { ok: false, error: 'Maksimal 50 item' };
            for (const it of items) {
                if (!it || typeof it.name !== 'string' || !it.name.trim()) {
                    return { ok: false, error: 'Setiap item butuh "name"' };
                }
            }

            const keys = new Set();
            for (const it of items) {
                for (const k of Object.keys((it && it.ratings) || {})) keys.add(k);
            }
            const criteria = Array.from(keys);
            if (criteria.length === 0) return { ok: false, error: 'ratings kosong' };

            const w = {};
            let totalW = 0;
            for (const k of criteria) {
                const ww = Number(weights[k]);
                w[k] = (Number.isFinite(ww) && ww > 0) ? ww : 0;
                totalW += w[k];
            }
            if (totalW <= 0) return { ok: false, error: 'Total bobot harus > 0' };

            const scored = [];
            for (const it of items) {
                let s = 0;
                let incomplete = false;
                for (const k of criteria) {
                    if (!(k in (it.ratings || {}))) { incomplete = true; continue; }
                    const v = Number(it.ratings[k]);
                    if (!Number.isFinite(v) || v < 0 || v > 10) {
                        return { ok: false, error: 'Rating harus angka 0–10 (' + it.name + '.' + k + ')' };
                    }
                    s += v * w[k];
                }
                scored.push({
                    name: it.name,
                    score: Math.round((s / totalW) * 100) / 100,
                    incomplete: incomplete,
                });
            }
            scored.sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));

            const rows = scored.map((sc, i) =>
                [(i + 1) + '. ' + sc.name + (sc.incomplete ? ' *' : ''), sc.score.toFixed(2)]);

            return {
                ok: true,
                values: { ranking: scored, best: scored[0].name },
                rows: rows,
                criteria: criteria,
                weightsUsed: w,
            };
        },
    });

    // helper kecil (di luar freeze agar statis):

    /* =====================================================================
     * 2) STORAGE — GM storage dengan fallback memori (agar bisa dites).
     * ===================================================================== */

    const memStore = new Map();
    const gm = typeof GM_getValue === 'function'
        ? {
            get: (k, d) => { try { return GM_getValue(k, d); } catch (e) { return d; } },
            set: (k, v) => { try { GM_setValue(k, v); } catch (e) { memStore.set(k, v); } },
            del: (k) => { try { GM_deleteValue(k); } catch (e) { memStore.delete(k); } },
            keys: () => { try { return GM_listValues() || []; } catch (e) { return []; } },
        }
        : {
            get: (k, d) => (memStore.has(k) ? memStore.get(k) : d),
            set: (k, v) => { memStore.set(k, v); },
            del: (k) => { memStore.delete(k); },
            keys: () => Array.from(memStore.keys()),
        };

    const Keys = Object.freeze({
        profiles: 'igpas:profiles',   // { [name]: { fieldId: value } }
    });

    const Storage = {
        getProfiles() { return gm.get(Keys.profiles, {}) || {}; },
        saveProfile(name, snapshot) {
            const all = Storage.getProfiles();
            all[name] = snapshot;
            gm.set(Keys.profiles, all);
        },
        deleteProfile(name) {
            const all = Storage.getProfiles();
            delete all[name];
            gm.set(Keys.profiles, all);
        },
    };

    /* =====================================================================
     * 2.5) BRIDGE — struktur dual-tab (pola CommLink/A.C.A.S):
     *      mailbox GM-storage, polling & read-once. Peran tab:
     *      gui (localhost / github.io/igpas/) <-> sensor (igpmanager.com).
     * ===================================================================== */

    const ROLE = (() => {
        if (typeof location === 'undefined') return 'test';
        const h = location.hostname || '';
        if (h === 'localhost' || h === '127.0.0.1') return 'gui';
        if (h.endsWith('.github.io') && (location.pathname || '').startsWith('/igpas/')) return 'gui';
        if (h.includes('igpmanager.com')) return 'sensor';
        return 'unknown';
    })();

    const INSTANCE_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

    const Mailbox = {
        PREFIX: 'igpas:mb:',
        HEARTBEAT_KEY: 'igpas:gui:heartbeat',
        handlers: {},
        timer: null,
        on(type, fn) {
            Mailbox.handlers[type] = Mailbox.handlers[type] || [];
            Mailbox.handlers[type].push(fn);
        },
        send(type, payload, to) {
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            const packet = {
                id: id,
                type: type,
                to: to || '*',
                from: ROLE + ':' + INSTANCE_ID,
                ts: Date.now(),
                payload: payload || {},
            };
            gm.set(Mailbox.PREFIX + id, packet);
        },
        pollOnce() {
            const now = Date.now();
            for (const key of gm.keys()) {
                if (typeof key !== 'string' || key.indexOf(Mailbox.PREFIX) !== 0) continue;
                const packet = gm.get(key, null);
                gm.del(key); // read-once: pesan dihapus begitu dibaca (pola A.C.A.S)
                if (!packet || typeof packet !== 'object') continue;
                if (now - (packet.ts || 0) > 30000) continue; // paket basi
                if (packet.from === ROLE + ':' + INSTANCE_ID) continue; // pesan sendiri
                if (packet.to && packet.to !== '*' && packet.to !== INSTANCE_ID) continue;
                const list = Mailbox.handlers[packet.type] || [];
                for (const fn of list) {
                    try { fn(packet); } catch (e) { if (typeof console !== 'undefined') console.warn('IGPAS listener', e); }
                }
            }
        },
        start(intervalMs) {
            if (Mailbox.timer) return;
            Mailbox.timer = setInterval(() => Mailbox.pollOnce(), intervalMs || 400);
            if (ROLE === 'gui') {
                gm.set(Mailbox.HEARTBEAT_KEY, Date.now());
                setInterval(() => gm.set(Mailbox.HEARTBEAT_KEY, Date.now()), 2000);
            }
        },
        guiConnected() {
            const hb = Number(gm.get(Mailbox.HEARTBEAT_KEY, 0));
            return hb > 0 && (Date.now() - hb) < 10000;
        },
    };

    /**
     * Registry adapter data (mobil, manufaktur, strategi). Status dipublikasikan
     * apa adanya: 'selectors-tbd' = kerangka siap, pemetaan DOM belum dilakukan
     * (butuh sesi validasi halaman nyata). Tidak ada selector fiktif.
     */
    const AdapterRegistry = {
        defs: [
            { id: 'car-data', desc: 'data mobil' },
            { id: 'manufacturer-data', desc: 'data manufaktur' },
            { id: 'race-strategy', desc: 'strategi balapan (v0.2: input manual)' },
        ],
        status() {
            return AdapterRegistry.defs.map(d => d.id + ':selectors-tbd').join(', ');
        },
    };

    /* =====================================================================
     * 3) UI — panel studi floating. Input manual, output live.
     * ===================================================================== */

    const CALCULATORS = [
        {
            id: 'fuel', title: '⛽ Fuel planner',
            inputs: [
                ['lapsRemaining', 'Laps remaining', '20'],
                ['fuelPerLap', 'Fuel per lap (L)', '1.2'],
                ['currentFuel', 'Fuel sekarang (L)', '10'],
                ['reserveLaps', 'Reserve (lap)', '1'],
                ['tankCapacity', 'Kapasitas tangki (L, kosong = ∞)', ''],
            ],
            compute: v => IGPCore.calcFuel(v),
        },
        {
            id: 'tireproj', title: '🛞 Proyeksi ban',
            inputs: [
                ['currentWearPct', 'Wear sekarang (%)', '10'],
                ['wearPerLapPct', 'Wear per lap (%)', '2.5'],
                ['lapsCount', 'Horizon (lap)', '20'],
            ],
            compute: v => IGPCore.projectTireWear(v),
        },
        {
            id: 'tirelife', title: '⏳ Umur ban',
            inputs: [
                ['currentWearPct', 'Wear sekarang (%)', '10'],
                ['wearPerLapPct', 'Wear per lap (%)', '2.5'],
                ['thresholdPct', 'Threshold (%)', '80'],
            ],
            compute: v => IGPCore.lapsToThreshold(v),
        },
        {
            id: 'pitwindow', title: '🅿️ Pit window',
            inputs: [
                ['lapsLeftOnFuel', 'Laps left on fuel', '12'],
                ['reserveLaps', 'Reserve (lap)', '1'],
                ['tireLaps', 'Laps sampai threshold ban', '30'],
                ['marginLaps', 'Margin pengaman (lap)', '1'],
            ],
            compute: v => IGPCore.pitWindow(v),
        },
        {
            id: 'stint', title: '🔧 Stint splitter',
            inputs: [
                ['totalLaps', 'Total lap balapan', '30'],
                ['tireLifeLaps', 'Umur ban (lap)', '18'],
                ['pitLossLaps', 'Biaya pit (lap-equiv)', '0.5'],
            ],
            compute: v => IGPCore.stintSplit(v),
        },
    ];


    const UI = (() => {
        let fields = []; // input elemen kalkulator (mode embedded)

        const esc = s => String(s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

        function calcHtml(calc) {
            const inputs = calc.inputs.map(([id, label, def]) =>
                `<div class="igpas-row"><label for="igpas-${calc.id}-${id}">${esc(label)}</label>` +
                `<input id="igpas-${calc.id}-${id}" data-calc="${calc.id}" data-field="${id}" value="${esc(def)}"></div>`
            ).join('');
            return `<fieldset class="igpas-calc"><legend>${esc(calc.title)}</legend>${inputs}` +
                `<div class="igpas-out" id="igpas-out-${calc.id}"></div></fieldset>`;
        }

        function snapshot() {
            const snap = {};
            for (const { inputEl } of fields) {
                snap[inputEl.dataset.calc + '.' + inputEl.dataset.field] = inputEl.value;
            }
            return snap;
        }

        function restore(snap) {
            for (const { inputEl } of fields) {
                const key = inputEl.dataset.calc + '.' + inputEl.dataset.field;
                if (snap[key] !== undefined) inputEl.value = snap[key];
            }
        }

        function computeAll() {
            for (const calc of CALCULATORS) {
                const out = document.getElementById('igpas-out-' + calc.id);
                if (!out) continue;
                const values = {};
                for (const { inputEl } of fields) {
                    if (inputEl.dataset.calc === calc.id) {
                        values[inputEl.dataset.field] = inputEl.value.trim() === '' ? null : inputEl.value;
                    }
                }
                const res = calc.compute(values);
                if (!res.ok) {
                    out.innerHTML = `<div class="row"><span class="igpas-err">✗ ${esc(res.error)}</span></div>`;
                    continue;
                }
                out.innerHTML = res.rows.map(([k, v]) => {
                    let cls = '';
                    if (String(k).includes('⚠')) cls = 'igpas-warn';
                    return `<div class="row"><span>${esc(k)}</span><span class="${cls}">${esc(v)}</span></div>`;
                }).join('');
            }
        }

        function profilesHtml() {
            const names = Object.keys(Storage.getProfiles());
            const opts = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
            return `<div id="igpas-prof">
                <select id="igpas-prof-sel"><option value="">— profil —</option>${opts}</select>
                <input id="igpas-prof-name" placeholder="nama profil" size="10">
                <button id="igpas-prof-save">Simpan</button>
                <button id="igpas-prof-load">Muat</button>
                <button id="igpas-prof-del">Hapus</button>
            </div>`;
        }

        function mountInto(container) {
            if (!container) return;
            fields = [];
            container.innerHTML =
                profilesHtml() +
                CALCULATORS.map(calcHtml).join('') +
                `<div class="igpas-foot">angka = aritmetika input Anda</div>`;

            container.querySelectorAll('input').forEach(inputEl => {
                if (!inputEl.closest('.igpas-calc')) return;
                fields.push({ inputEl });
                inputEl.addEventListener('input', computeAll);
            });

            const sel = container.querySelector('#igpas-prof-sel');
            const nameIn = container.querySelector('#igpas-prof-name');

            function refreshProfileOptions() {
                const names = Object.keys(Storage.getProfiles());
                sel.innerHTML = '<option value="">— profil —</option>' +
                    names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
            }

            document.getElementById('igpas-prof-save').addEventListener('click', () => {
                const name = (nameIn.value || sel.value || '').trim();
                if (!name) { alert('Isi nama profil dulu.'); return; }
                Storage.saveProfile(name, snapshot());
                nameIn.value = '';
                refreshProfileOptions();
            });
            document.getElementById('igpas-prof-load').addEventListener('click', () => {
                const name = (sel.value || nameIn.value || '').trim();
                const all = Storage.getProfiles();
                if (!name || !all[name]) { alert('Pilih profil yang ada.'); return; }
                restore(all[name]);
                computeAll();
            });
            document.getElementById('igpas-prof-del').addEventListener('click', () => {
                const name = (sel.value || '').trim();
                if (!name || !Storage.getProfiles()[name]) { alert('Pilih profil dari daftar.'); return; }
                Storage.deleteProfile(name);
                refreshProfileOptions();
            });

            computeAll();
        }

        return { mountInto };
    })();

    /* =====================================================================
     * 3.5) GUI MASTER — widget untuk tab Command Center (peran 'gui').
     *      Me-render ke elemen shell di docs/app/index.html.
     * ===================================================================== */

    const GuiMaster = (() => {
        const reports = new Map(); // instanceId -> laporan terakhir
        let labData = null;

        const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const $ = id => document.getElementById(id);
        const $v = id => { const el = $(id); return el ? el.value : ''; };

        const san = s => String(s).replace(/\W+/g, '_');

        function refreshInstances() {
            const box = $('igpas-gui-instances');
            if (!box) return;
            const hb = Mailbox.guiConnected()
                ? '<span class="badge ok">● heartbeat live</span>'
                : '<span class="badge off">○ heartbeat idle</span>';
            let html = hb;
            if (reports.size === 0) {
                html += ' <span class="badge">no sensor tab yet</span>';
            } else {
                for (const [id, r] of reports) {
                    html += '<div class="rec"><div><strong>' + esc(r.label) + '</strong>' +
                        ' <span class="hint">' + esc(r.url || '') + '</span></div>' +
                        '<div class="why">adapters: ' + esc(r.adapters || '—') +
                        ' · profiles: ' + esc(r.profiles) + ' · ' + esc(r.t) +
                        ' · instance ' + esc(id.slice(0, 14)) + '…</div></div>';
                }
            }
            box.innerHTML = html;
        }

        function strategy() {
            const out = $('ig-str-out');
            if (!out) return;
            const r = IGPCore.strategyRecommendation({
                lapsLeftOnFuel: $v('ig-str-fuel'),
                tyreLapsLeft: $v('ig-str-tyre'),
                reserveLaps: $v('ig-str-res'),
                pitLossLaps: $v('ig-str-loss'),
                marginLaps: $v('ig-str-margin'),
            });
            if (!r.ok) {
                out.innerHTML = '<div class="warn">✗ ' + esc(r.error) + '</div>';
                return;
            }
            const titles = { 'pit-now': '🅿️ PIT SEKARANG', 'pit-soon': '🅿️ Pit dalam ±1 lap', 'plan': '🗓️ Rencanakan pit' };
            const title = titles[r.values.decision] || r.values.decision;
            out.innerHTML = '<div class="rec"><div><strong>' + esc(title) + '</strong></div>' +
                r.rows.map(row => '<div class="why">' + esc(row[0]) + ': <strong>' + esc(row[1]) + '</strong></div>').join('') +
                '</div>';
        }

        function strategyDemo() {
            const demo = { 'ig-str-fuel': '9.5', 'ig-str-tyre': '14', 'ig-str-res': '1', 'ig-str-loss': '0.5', 'ig-str-margin': '1' };
            for (const id of Object.keys(demo)) { const el = $(id); if (el) el.value = demo[id]; }
            strategy();
        }

        function criteriaOf(items) {
            const s = new Set();
            for (const it of items) for (const k of Object.keys(it.ratings || {})) s.add(k);
            return Array.from(s);
        }

        function labLoad(parse) {
            const ta = $('ig-lab-json');
            const out = $('ig-lab-out');
            if (!ta || !out) return;
            if (!parse) {
                try {
                    const obj = JSON.parse(ta.value);
                    if (!obj || !Array.isArray(obj.items)) throw new Error('butuh {"type":…,"items":[…]}');
                    labData = obj;
                } catch (e) {
                    out.innerHTML = '<div class="warn">✗ JSON: ' + esc(e.message) + '</div>';
                    return false;
                }
            }
            const box = $('ig-lab-weights');
            if (box && labData) {
                box.innerHTML = criteriaOf(labData.items).map(k =>
                    '<div class="row"><label style="flex:1">' + esc(k) + '</label>' +
                    '<input type="number" min="0" max="5" step="0.5" value="3" id="ig-lab-w-' + esc(san(k)) + '"></div>').join('');
            }
            if (out && labData) {
                out.innerHTML = '<span class="hint">' + esc(labData.type || 'data') + ': ' +
                    labData.items.length + ' item dimuat — atur bobot lalu <em>Rank</em>.</span>';
            }
            return true;
        }

        function labExample() {
            const ta = $('ig-lab-json');
            if (!ta) return;
            ta.value = JSON.stringify({
                type: 'manufacturer',
                items: [
                    { name: 'Alpha Aero', ratings: { aero: 8, power: 5, reliability: 7, cost: 4 } },
                    { name: 'Beta Drive', ratings: { aero: 6, power: 8, reliability: 6, cost: 6 } },
                    { name: 'Gamma Tech', ratings: { aero: 7, power: 7, reliability: 8, cost: 3 } },
                ],
            }, null, 2);
            labLoad(false);
        }

        function labRank() {
            const out = $('ig-lab-out');
            if (!out) return;
            if (!labData) { out.innerHTML = '<span class="hint">Load JSON dulu.</span>'; return; }
            const weights = {};
            for (const k of criteriaOf(labData.items)) {
                weights[k] = Number($v('ig-lab-w-' + san(k))) || 3;
            }
            const r = IGPCore.rankOptions({ items: labData.items, weights: weights });
            if (!r.ok) { out.innerHTML = '<div class="warn">✗ ' + esc(r.error) + '</div>'; return; }
            out.innerHTML = '<table><tr><th>Opsi</th><th>Skor</th></tr>' +
                r.rows.map(row => '<tr><td>' + esc(row[0]) + '</td><td class="num">' + esc(row[1]) + '</td></tr>').join('') +
                '</table><div class="why" style="color:#8fa1b8;font-size:12px;margin-top:6px">Best: <strong>' +
                esc(r.values.best) + '</strong> · * = rating belum lengkap · skor = Σ(rating×bobot)/Σbobot (0–10)</div>';
        }

        function mount() {
            // Kalkulator & profil (dipindah dari panel floating lama)
            const calcShell = $('igpas-calc-panel');
            if (calcShell && typeof UI !== 'undefined') UI.mountInto(calcShell);

            const ver = $('igpas-gui-version');
            if (ver) ver.textContent = 'GUI v' + VERSION;
            const mode = $('igpas-gui-mode');
            if (mode) { mode.textContent = '● live (userscript aktif)'; mode.className = 'badge ok'; }

            const req = $('igpas-gui-request-report');
            if (req) req.addEventListener('click', () => Mailbox.send('report-request', {}));

            const sc = $('ig-str-calc');   if (sc) sc.addEventListener('click', strategy);
            const sd = $('ig-str-demo');   if (sd) sd.addEventListener('click', strategyDemo);
            const ll = $('ig-lab-load');   if (ll) ll.addEventListener('click', () => labLoad(false));
            const le = $('ig-lab-example'); if (le) le.addEventListener('click', labExample);
            const lr = $('ig-lab-rank');   if (lr) lr.addEventListener('click', labRank);

            Mailbox.on('report', p => {
                reports.set(p.from, {
                    label: (p.payload && p.payload.label) || p.from,
                    url: p.payload && p.payload.url,
                    adapters: p.payload && p.payload.adapters,
                    profiles: p.payload && p.payload.profiles,
                    t: new Date(p.ts).toLocaleTimeString(),
                });
                refreshInstances();
                const ls = $('igpas-gui-last-sync');
                if (ls) ls.textContent = 'Last sync: ' + new Date().toLocaleTimeString();
            });

            setInterval(refreshInstances, 2000);
            refreshInstances();
        }

        return { mount: mount };
    })();

    /* =====================================================================
     * 4) BOOT — hanya memasang panel. Tidak menyentuh elemen game.
     * ===================================================================== */

    function boot() {
        if (typeof document === 'undefined') return; // lingkungan non-browser (tes)

        const startUi = () => {
            // v0.3.0: TIDAK ADA UI di tab igpmanager (sensor senyap).
            // Seluruh antarmuka hanya di tab Command Center (peran 'gui').
            if (ROLE === 'gui' && typeof GuiMaster !== 'undefined') GuiMaster.mount();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startUi);
        } else {
            startUi();
        }

        // ======== Jembatan antar-tab (dual-tab) ========
        Mailbox.start();

        if (ROLE !== 'gui') {
            // Tab sensor: tanggapi permintaan data GUI dengan laporan status.
            Mailbox.on('report-request', () => {
                Mailbox.send('report', {
                    label: 'iGP tab (' + (typeof location !== 'undefined' ? location.pathname : '?') + ')',
                    url: (typeof location !== 'undefined') ? location.href : '?',
                    adapters: AdapterRegistry.status(),
                    profiles: Object.keys(Storage.getProfiles()).length,
                });
            });
        }
    }

    boot();

    // Ekspor untuk pengujian Node — tanpa efek di browser (module tak terdefinisi).
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { IGPCore };
    }
})();
