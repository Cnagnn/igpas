// ==UserScript==
// @name         I.G.P.A.S — iGP Analytics & Study System
// @namespace    IGPAS
// @version      0.1.0
// @description  Kalkulator analisis & studi strategi iGP Manager (fuel, ban, pit window, stint). Input manual — bukan alat bantu saat balapan, tanpa otomasi.
// @license      GPL-3.0
// @match        https://igpmanager.com/*
// @match        https://*.igpmanager.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @run-at       document-idle
// ==/UserScript==

(function IGPAS() {
    'use strict';

    const VERSION = '0.1.0';

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
    });

    // helper kecil (di luar freeze agar statis):
    function fuelPerLapExplorer(fuelPerLap) { return fuelPerLap; }

    /* =====================================================================
     * 2) STORAGE — GM storage dengan fallback memori (agar bisa dites).
     * ===================================================================== */

    const memStore = new Map();
    const gm = typeof GM_getValue === 'function'
        ? {
            get: (k, d) => { try { return GM_getValue(k, d); } catch (e) { return d; } },
            set: (k, v) => { try { GM_setValue(k, v); } catch (e) { memStore.set(k, v); } },
            del: (k) => { try { GM_deleteValue(k); } catch (e) { memStore.delete(k); } },
        }
        : {
            get: (k, d) => (memStore.has(k) ? memStore.get(k) : d),
            set: (k, v) => { memStore.set(k, v); },
            del: (k) => { memStore.delete(k); },
        };

    const Keys = Object.freeze({
        profiles: 'igpas:profiles',   // { [name]: { fieldId: value } }
        ui: 'igpas:ui',               // { open: bool }
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
        getUi() { return gm.get(Keys.ui, {}) || {}; },
        setUi(state) { gm.set(Keys.ui, state); },
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

    const CSS = `
        #igpas-btn{position:fixed;right:14px;bottom:14px;z-index:2147483000;
            background:#101826;color:#9fd0ff;border:1px solid #2b3b55;border-radius:999px;
            padding:8px 14px;font:600 12px/1 system-ui,sans-serif;cursor:pointer;
            box-shadow:0 4px 14px rgba(0,0,0,.35);user-select:none}
        #igpas-panel{position:fixed;right:14px;bottom:56px;width:340px;max-height:78vh;
            overflow:auto;z-index:2147483000;background:#0d1420;color:#dbe6f5;border-radius:12px;
            border:1px solid #2b3b55;box-shadow:0 8px 30px rgba(0,0,0,.5);
            font:12px/1.45 system-ui,sans-serif;padding:12px}
        #igpas-panel h3{margin:0 0 4px;font-size:13px;color:#9fd0ff}
        #igpas-panel .sub{color:#7b8ba1;margin:0 0 10px;font-size:11px}
        .igpas-calc{border:1px solid #22314a;border-radius:8px;padding:8px;margin-bottom:10px;background:#111b2c}
        .igpas-calc legend{color:#9fd0ff;font-weight:600;padding:0 4px}
        .igpas-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0}
        .igpas-row label{flex:1;color:#a9b8cd}
        .igpas-row input{flex:1;background:#0d1420;border:1px solid #2b3b55;color:#dbe6f5;
            border-radius:6px;padding:4px 6px;font:12px system-ui;max-width:110px;text-align:right}
        .igpas-out{margin-top:6px;border-top:1px dashed #22314a;padding-top:6px}
        .igpas-out .row{display:flex;justify-content:space-between;gap:8px;margin:2px 0}
        .igpas-out .row span:first-child{color:#8fa1b8}
        .igpas-out .row span:last-child{color:#eaf2ff;font-weight:600}
        .igpas-err{color:#ff9d9d}
        .igpas-warn{color:#ffce6b}
        #igpas-prof{display:flex;gap:6px;margin:8px 0 2px;align-items:center;flex-wrap:wrap}
        #igpas-prof input,#igpas-prof select{background:#0d1420;border:1px solid #2b3b55;color:#dbe6f5;
            border-radius:6px;padding:4px 6px;font:12px system-ui}
        #igpas-prof button{background:#1c2b44;color:#9fd0ff;border:1px solid #2b3b55;border-radius:6px;
            padding:4px 8px;cursor:pointer;font:12px system-ui}
        .igpas-foot{color:#6a788d;font-size:10px;margin-top:8px;text-align:center}
    `;

    const UI = (() => {
        let panel = null, btn = null;
        const fields = []; // { id, inputEl }

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

        function mount() {
            if (document.getElementById('igpas-panel')) return;

            const style = document.createElement('style');
            style.textContent = CSS;
            document.head.appendChild(style);

            btn = document.createElement('button');
            btn.id = 'igpas-btn';
            btn.textContent = '📊 IGPAS ' + VERSION;
            document.body.appendChild(btn);

            panel = document.createElement('div');
            panel.id = 'igpas-panel';
            panel.innerHTML =
                `<h3>I.G.P.A.S <small style="color:#5d6f88">v${VERSION}</small></h3>` +
                `<p class="sub">Alat studi — input manual. Tidak otomasi apa pun.</p>` +
                profilesHtml() +
                CALCULATORS.map(calcHtml).join('') +
                `<div class="igpas-foot">GPL-3.0 · angka = aritmetika input Anda</div>`;
            document.body.appendChild(panel);

            panel.querySelectorAll('input').forEach(inputEl => {
                if (!inputEl.closest('.igpas-calc')) return;
                fields.push({ inputEl });
                inputEl.addEventListener('input', computeAll);
            });

            const sel = document.getElementById('igpas-prof-sel');
            const nameIn = document.getElementById('igpas-prof-name');
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

            function refreshProfileOptions() {
                const names = Object.keys(Storage.getProfiles());
                sel.innerHTML = '<option value="">— profil —</option>' +
                    names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
            }

            btn.addEventListener('click', panelToggle);

            const ui = Storage.getUi();
            panel.style.display = ui.open === false ? 'none' : 'block';
            computeAll();
        }

        function panelToggle() {
            if (!panel) return;
            const shown = panel.style.display !== 'none';
            panel.style.display = shown ? 'none' : 'block';
            Storage.setUi({ open: !shown });
        }

        return { mount, panelToggle };
    })();

    /* =====================================================================
     * 4) BOOT — hanya memasang panel. Tidak menyentuh elemen game.
     * ===================================================================== */

    function boot() {
        if (typeof document === 'undefined') return; // lingkungan non-browser (tes)
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => UI.mount());
        } else {
            UI.mount();
        }
        document.addEventListener('keydown', e => {
            if (e.altKey && (e.key === 'i' || e.key === 'I')) {
                e.preventDefault();
                UI.panelToggle();
            }
        });
    }

    boot();

    // Ekspor untuk pengujian Node — tanpa efek di browser (module tak terdefinisi).
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { IGPCore };
    }
})();
