// ==UserScript==
// @name         I.G.P.A.S — iGP Analytics & Study System
// @namespace    https://github.com/Cnagnn/igpas
// @version      0.7.1
// @description  Race strategy study calculators + read-only snapshot autoload for iGP Manager (account, car, supply, manufacturers). Study tool only, no live-race assistance, no automation.
// @description:id Kalkulator analisis & studi strategi iGP Manager (fuel, ban, pit window, stint) + autoload snapshot read-only (akun, mobil, supply, manufacturers). Alat studi, bukan bantuan saat balapan, tanpa otomasi.
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

    const VERSION = '0.7.1';

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

        /**
         * Prioritas alokasi design points (v0.7.0 Advisor).
         * Eksplisit: heuristik selisih (gap) antara nilai atribut mobil dan max
         * atribut rival liga (#leagueDesignData). BUKAN rumus game — porsi DP
         * yang diusulkan = share gap terbesar, dan tetap harus diuji user.
         * @param {object} p { attrs:{key:{label,val}}, best:{key:{max}}, designPoints }
         */
        designPriority(p) {
            const attrs = (p && p.attrs && typeof p.attrs === 'object') ? p.attrs : null;
            if (!attrs || !Object.keys(attrs).length) {
                return { ok: false, error: 'Atribut mobil belum terbaca di halaman ini' };
            }
            const best = (p && p.best && typeof p.best === 'object') ? p.best : {};
            const numOrNull = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
            const rows = [];
            let totalGap = 0;
            for (const key of Object.keys(attrs)) {
                const a = attrs[key];
                const val = a ? numOrNull(a.val) : null;
                if (val == null) continue;
                const maxEntry = best[key];
                const max = maxEntry ? numOrNull(maxEntry.max) : null;
                const effMax = (max != null) ? Math.max(max, val) : null;
                const gap = (effMax != null) ? Math.max(0, effMax - val) : null;
                if (gap != null) totalGap += gap;
                rows.push({ key: key, label: a.label || key, val: val, max: effMax, gap: gap });
            }
            if (!rows.length) return { ok: false, error: 'Tidak ada atribut yang terbaca' };
            if (totalGap <= 0) {
                return { ok: false, error: 'Tidak ada gap terhadap max liga (sudah ≥ max, atau benchmark liga tidak tersedia)' };
            }
            const ranked = rows.filter(r => r.gap != null)
                .sort((a, b) => (b.gap - a.gap) || String(a.key).localeCompare(String(b.key)));
            for (const r of ranked) {
                r.sharePct = Math.round((r.gap / totalGap) * 1000) / 10;
            }
            return {
                ok: true,
                values: {
                    ranked: ranked,
                    totalGap: totalGap,
                    designPoints: (Number.isFinite(Number(p.designPoints))) ? Number(p.designPoints) : null,
                    unbenchmarked: rows.filter(r => r.gap == null).length,
                },
            };
        },

        /**
         * Urutkan supplier dari dialog Supply (v0.7.0 Advisor).
         * Heuristik transparan: Σ bonus stat vs biaya per balapan; "nilai/biaya"
         * = bonus per 1M. Stat berbeda tidak disetarakan rumus game — hasil tetap
         * berupa perbandingan, bukan kepastian performa.
         * @param {object} p { items:[{supplierId,eId,costPerRace,bonuses:[{stat,value}]}] }
         */
        rankSuppliers(p) {
            const items = (p && Array.isArray(p.items)) ? p.items : null;
            if (!items || !items.length) return { ok: false, error: 'Tidak ada supplier yang terbaca dari dialog' };
            const rows = items.map(it => {
                const costRaw = it ? it.costPerRace : null;
                const cost = (costRaw != null && Number.isFinite(Number(costRaw))) ? Number(costRaw) : null;
                const value = (it && Array.isArray(it.bonuses))
                    ? it.bonuses.reduce((s, b) => s + (b && b.value != null && Number.isFinite(Number(b.value)) ? Number(b.value) : 0), 0)
                    : (it && it.value != null && Number.isFinite(Number(it.value)) ? Number(it.value) : null);
                return {
                    id: it ? it.supplierId : null,
                    eId: it ? it.eId : null,
                    value: value,
                    cost: cost,
                    valuePerCost: (value != null && cost != null && cost > 0)
                        ? Math.round((value / cost) * 1e6 * 100) / 100
                        : null,
                };
            });
            const ranked = rows.slice().sort((a, b) =>
                (((b.valuePerCost == null) ? -Infinity : b.valuePerCost) - ((a.valuePerCost == null) ? -Infinity : a.valuePerCost)) ||
                (((b.value == null) ? -Infinity : b.value) - ((a.value == null) ? -Infinity : a.value)) ||
                String(a.id).localeCompare(String(b.id)));
            const withCost = rows.filter(r => r.cost != null).sort((x, y) => x.cost - y.cost);
            return {
                ok: true,
                values: {
                    ranked: ranked,
                    bestValueId: (ranked.find(r => r.valuePerCost != null) || ranked[0]).id,
                    cheapestId: withCost.length ? withCost[0].id : null,
                    withoutCost: rows.filter(r => r.cost == null).length,
                },
            };
        },

        /**
         * Urutkan baris manufacturer (engine/chassis) berdasarkan rating (v0.7.0).
         * Engine punya biaya: efisiensi = rating per 1M biaya. Chassis: rating saja.
         * @param {object} p { items:[{id,name,ratingPct,costPerRace,customers}], withCost }
         */
        rankManufacturerItems(p) {
            const items = (p && Array.isArray(p.items)) ? p.items : null;
            if (!items || !items.length) return { ok: false, error: 'Tidak ada baris manufacturer yang terbaca' };
            const withCost = !!p.withCost;
            const rows = items.map(it => {
                const ratingRaw = it ? it.ratingPct : null;
                const costRaw = it ? it.costPerRace : null;
                const rating = (ratingRaw != null && Number.isFinite(Number(ratingRaw))) ? Number(ratingRaw) : null;
                const cost = (costRaw != null && Number.isFinite(Number(costRaw))) ? Number(costRaw) : null;
                return {
                    id: it ? it.id : null,
                    name: it ? it.name : null,
                    rating: rating,
                    cost: cost,
                    ratingPerCost: (withCost && rating != null && cost != null && cost > 0)
                        ? Math.round((rating / cost) * 1e6 * 100) / 100
                        : null,
                };
            });
            const ranked = rows.filter(r => r.rating != null).sort((a, b) =>
                (b.rating - a.rating) ||
                (((b.ratingPerCost == null) ? -Infinity : b.ratingPerCost) - ((a.ratingPerCost == null) ? -Infinity : a.ratingPerCost)) ||
                String(a.name).localeCompare(String(b.name)));
            if (!ranked.length) return { ok: false, error: 'Rating manufacturer tidak terbaca' };
            const byEff = withCost ? rows.filter(r => r.ratingPerCost != null)
                .sort((x, y) => y.ratingPerCost - x.ratingPerCost) : [];
            return {
                ok: true,
                values: {
                    ranked: ranked,
                    bestRatingId: ranked[0].id,
                    bestValueId: byEff.length ? byEff[0].id : null,
                    noData: rows.filter(r => r.rating == null).length,
                },
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
        snapshots: 'igpas:snapshots', // { [kind]: { data, ts } } — hasil Capture
        advisor: 'igpas:advisor',     // { hidden: Boolean } — preferensi UI advisor in-page
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
        getSnapshot(kind) {
            const all = gm.get(Keys.snapshots, {}) || {};
            return all[kind] || null;
        },
        saveSnapshot(kind, data) {
            const all = gm.get(Keys.snapshots, {}) || {};
            all[kind] = { data, ts: Date.now() };
            gm.set(Keys.snapshots, all);
        },
        /** Gabungkan patch ke snapshot kind (mis. supply: {engine|fuel|tyre} per capture). */
        mergeSnapshot(kind, patch) {
            const cur = Storage.getSnapshot(kind);
            const data = Object.assign({}, (cur && cur.data) || {}, patch);
            Storage.saveSnapshot(kind, data);
            return data;
        },
        clearSnapshots() {
            gm.del(Keys.snapshots);
        },
    };

    /* =====================================================================
     * 2.5) BRIDGE — struktur dual-tab (pola CommLink/A.C.A.S):
     *      mailbox GM-storage, polling & read-once. Peran tab:
     *      gui (localhost / github.io/igpas/) <-> sensor (igpmanager.com).
     *      v0.5.1: pesan hanya dihapus setelah dikonsumsi penerima — pengirim
     *      tidak menghapus pesannya sendiri (fix race 400 ms); paket basi
     *      >30 dtk dibersihkan oleh poll mana pun.
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
                if (!packet || typeof packet !== 'object') { gm.del(key); continue; } // rusak → bersihkan
                if (now - (packet.ts || 0) > 30000) { gm.del(key); continue; }        // basi → bersihkan (janitor)
                if (packet.from === ROLE + ':' + INSTANCE_ID) continue;              // pesan sendiri: biarkan untuk tab lain
                if (packet.to && packet.to !== '*' && packet.to !== INSTANCE_ID) continue; // bukan untuk kita: jangan hapus
                const list = Mailbox.handlers[packet.type] || [];
                if (!list.length) continue;                                          // tak ada handler di peran ini: biarkan untuk peran lain
                gm.del(key); // read-once: hanya pesan yang benar-benar dikonsumsi yang dihapus (pola A.C.A.S)
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
     * Adapter read-only halaman iGP (Fase 3 — dipetakan dari DOM halaman nyata).
     * Aturan main (ToS § V.F/V.J):
     *  - HANYA membaca; tidak pernah menulis, mengklik, atau mengirim form.
     *  - Berjalan HANYA saat GUI meminta (read-once per klik Capture), tanpa polling.
     *  - pageId gate: adapter mobil hanya aktif di halaman Cars (p=cars) — bukan
     *    halaman balapan/strategi. Adapter akun membaca header global saja.
     */
    const IgpAccountAdapter = {
        id: 'account-data',
        desc: 'snapshot akun (header global iGP)',
        captures(doc) {
            const $ = s => doc.querySelector(s);
            const name = $('#myProfileName'), rankVal = $('#managerRankValue');
            if (!name && !rankVal) return null; // bukan halaman iGP yang sudah login
            const icon = $('#managerRankIcon');
            const tier = icon ? (icon.getAttribute('src') || '').match(/rank\/([a-z0-9-]+)-\d+\.webp/i) : null;
            const level = $('.myProfileStatsStack .teal');
            return {
                manager: name ? name.textContent.trim() : null,
                level: level ? level.textContent.trim() : null,
                rank: rankVal ? rankVal.textContent.trim() : null,
                rankTier: tier ? tier[1] : null,
                balance: $('#balanceText') ? $('#balanceText').textContent.trim() : null,
                tokens: $('#tokens-total') ? $('#tokens-total').textContent.trim() : null,
            };
        },
    };

    const IgpCarsAdapter = {
        id: 'car-data',
        desc: 'atribut mobil + supplier + DP + bonus (halaman Cars)',
        captures(doc) {
            const pid = doc.getElementById('pageId');
            if (!pid || pid.value !== 'cars') return null; // gate: halaman Cars saja
            const txt = (root, sel) => {
                const el = root.querySelector(sel);
                return el ? el.textContent.trim() : null;
            };
            const attrs = {};
            for (const row of doc.querySelectorAll('#carAttributesDisplay .attribute-row')) {
                const key = (row.id || '').replace(/^wrap-/, '');
                if (!key) continue; // baris form edit tidak punya id wrap-*
                attrs[key] = {
                    label: txt(row, '.attribute-rating-header span:not(.ratingVal)'),
                    val: Number(txt(row, '.ratingVal')),
                };
            }
            if (!Object.keys(attrs).length) return null;
            const dpEl = doc.querySelector('#carsDesignPoints');
            const host = doc.querySelector('#carAttributes');
            let best = {};
            try { best = JSON.parse(txt(doc, '#leagueDesignData') || '{}') || {}; } catch (e) { best = {}; }
            const bonuses = [];
            for (const s of doc.querySelectorAll('#carAttributesBonuses .tooltip')) {
                const m = (s.getAttribute('data-tip') || '').match(/^([A-Za-z ]+):\s*([+-]?\d+)$/);
                if (m) bonuses.push({ key: m[1], bonus: parseInt(m[2], 10) });
            }
            const suppliers = [];
            for (const w of doc.querySelectorAll('.carsSuppliers .c-wrap')) {
                const img = w.querySelector('img[src*="/supply/"]');
                const m = img ? (img.getAttribute('src') || '').match(/\/supply\/(?:light\/)?(\d+)\.png/) : null;
                const kind = (w.textContent || '').match(/\b(Engines|Fuel|Tyres)\b/);
                if (m) suppliers.push({ kind: kind ? kind[1].toLowerCase() : null, id: m[1] });
            }
            return {
                carType: txt(host, '.c-head h2 span'),
                dmax: host ? parseInt(host.getAttribute('data-dmax'), 10) || null : null,
                designPoints: dpEl ? parseInt(dpEl.getAttribute('data-dp'), 10) || null : null,
                attrs, best, bonuses, suppliers,
            };
        },
    };

    /**
     * Adapter dialog Supply (engine/fuel/tyre) — read-only, dipetakan dari capture
     * live DOM (fixture test/fixtures/supply-*.html). Dialog dibuka OLEH USER di
     * halaman Cars (klik tile Engines/Fuel/Tyres); adapter tidak pernah membuka
     * dialog, tidak mengklik, tidak submit — hanya membaca DOM yang tampak.
     * Gate: `.supplyDialog` harus ada (dialog terbuka) + judul h2 menentukan tipe —
     * berbasis DOM, BUKAN URL (halaman/varian URL apa pun asal dialog terbuka).
     */
    const IgpSupplyAdapter = {
        id: 'supply-data',
        desc: 'supplier engine/fuel/tyre (dialog Supply di halaman Cars)',
        captures(doc) {
            const root = doc.querySelector('.supplyDialog');
            if (!root) return null; // gate: hanya saat dialog Supply terbuka
            const h2 = root.querySelector('.dialog-subhead-content h2');
            const tm = (h2 ? h2.textContent : '').match(/^\s*(engine|fuel|tyre)s?\s+supply\s*$/i);
            if (!tm) return null;
            const type = tm[1].toLowerCase();

            const money = t => {
                const m = String(t || '').match(/(\d+(?:\.\d+)?)\s*([kmb]?)/i);
                if (!m) return null;
                const suf = m[2].toLowerCase();
                return Math.round(parseFloat(m[1]) * (suf === 'k' ? 1e3 : suf === 'm' ? 1e6 : suf === 'b' ? 1e9 : 1));
            };
            const sid = el => {
                const m = el ? (el.getAttribute('src') || '').match(/\/supply\/(?:light\/)?(\d+)\.png/) : null;
                return m ? parseInt(m[1], 10) : null;
            };
            const bonusesIn = scope => {
                const out = [];
                for (const s of scope.querySelectorAll('.tooltip[data-tip]')) {
                    const v = (s.textContent || '').match(/[+-]?\d+/);
                    if (v) out.push({ stat: s.getAttribute('data-tip'), value: parseInt(v[0], 10) });
                }
                return out;
            };

            const sub = root.querySelector('.dialog-subhead');
            const costMatch = sub ? (sub.textContent || '').match(/Cost:\s*([\d.]+\s*[kmb]?)/i) : null;

            const alternatives = [];
            for (const btn of root.querySelectorAll('a[data-tip*="supplyType="]')) {
                const tip = btn.getAttribute('data-tip') || '';
                const eId = (tip.match(/eId=(\d+)/) || [])[1];
                const supType = (tip.match(/supplyType=([a-z]+)/i) || [])[1];
                if (!eId || (supType && supType.toLowerCase() !== type)) continue;
                const card = btn.closest('.inline-block') || btn.parentElement;
                alternatives.push({
                    eId: parseInt(eId, 10),
                    supplierId: sid(card ? card.querySelector('img[src*="/supply/"]') : null),
                    costPerRace: money(btn.textContent),
                    bonuses: card ? bonusesIn(card) : [],
                });
            }

            return {
                type,
                current: {
                    supplierId: sid(sub ? sub.querySelector('img[src*="/supply/"]') : null),
                    costPerRace: costMatch ? money(costMatch[1]) : null,
                    bonuses: sub ? bonusesIn(sub) : [],
                },
                alternatives,
            };
        },
    };

    /**
     * Adapter halaman Manufacturers — read-only. Dipetakan dari capture live DOM
     * kedua tab (fixture test/fixtures/manufacturers-engines.html &
     * manufacturers-chassis.html). Fakta halaman: KEDUA tabel (engine + chassis)
     * selalu ada di DOM; tab aktif hanya soal display — jadi satu capture membaca
     * keduanya. Gate: #pageId = 'manufacturers' — berbasis DOM, BUKAN URL:
     * varian /app/p=manufacturers, …&tab=engines, dan …&tab=chassis sama-sama lolos.
     * Hanya membaca; tidak pernah klik (termasuk kontrol “Show hidden stats”),
     * tidak submit, tidak membuka dialog.
     */
    const IgpManufacturersAdapter = {
        id: 'manufacturer-data',
        desc: 'daftar manufacturer engine + chassis (halaman Manufacturers)',
        captures(doc) {
            const pid = doc.getElementById('pageId');
            if (!pid || pid.value !== 'manufacturers') return null; // gate: halaman Manufacturers saja
            const engineTable = doc.getElementById('engine-table');
            const chassisTable = doc.getElementById('chassis-table');
            if (!engineTable && !chassisTable) return null;

            const money = t => {
                const m = String(t || '').match(/(\d+(?:\.\d+)?)\s*([kmb]?)/i);
                if (!m) return null;
                const suf = m[2].toLowerCase();
                return Math.round(parseFloat(m[1]) * (suf === 'k' ? 1e3 : suf === 'm' ? 1e6 : suf === 'b' ? 1e9 : 1));
            };
            const clean = s => String(s || '').replace(/\s+/g, ' ').trim(); // nama punya spasi nyasar di DOM
            const num = t => {
                const n = parseInt(String(t || '').replace(/[^\d]/g, ''), 10);
                return Number.isFinite(n) ? n : null;
            };
            /** Stats terlihat? ikon #ios-eye = ya; #ios-eye-off (red) = disembunyikan. */
            const statsVisible = td => {
                const use = td ? td.querySelector('svg use') : null;
                if (!use) return null;
                const ref = use.getAttribute('xlink:href') || use.getAttribute('href') || '';
                if (/#ios-eye-off$/.test(ref)) return false;
                if (/#ios-eye$/.test(ref)) return true;
                return null;
            };
            const totalPages = pagerId => {
                const pgr = doc.getElementById(pagerId);
                const last = pgr ? pgr.querySelector('.pager-last') : null;
                return last ? num(last.getAttribute('rel')) : null;
            };

            /** Baris tabel: engine = 5 kolom (name/rating/cost/stats/customers), chassis = 3. */
            const parseRows = (table, withCost) => {
                const out = [];
                if (!table) return out;
                for (const tr of table.querySelectorAll('tbody tr')) {
                    const tds = tr.querySelectorAll('td');
                    if (tds.length < 2) continue;
                    const a = tds[0].querySelector('a[href]');
                    const idm = a ? (a.getAttribute('href') || '').match(/id=(\d+)/) : null;
                    const tip = tds[1] ? tds[1].querySelector('.tooltip[data-tip]') : null;
                    const rm = tip ? (tip.getAttribute('data-tip') || '').match(/^Rating:\s*(\d+)%$/) : null;
                    const row = {
                        id: idm ? parseInt(idm[1], 10) : null,
                        name: clean(tds[0].textContent), // teks saja — <a> kosong + <img> flag tidak menghasilkan teks
                        nationality: tr.getAttribute('data-nationality') || null,
                        ratingPct: rm ? parseInt(rm[1], 10) : null,
                    };
                    if (withCost) {
                        const costTd = (tds[2] && tds[2].classList.contains('currency')) ? tds[2] : null;
                        row.costPerRace = costTd ? money(costTd.textContent) : null;
                        row.statsVisible = statsVisible(tds[3]);
                    }
                    row.customers = num(tds[tds.length - 1].textContent);
                    out.push(row);
                }
                return out;
            };

            return {
                engines: parseRows(engineTable, true),
                chassis: parseRows(chassisTable, false),
                totalPages: { engines: totalPages('engine-pager'), chassis: totalPages('chassis-pager') },
            };
        },
    };

    /**
     * Registry adapter data. Status dipublikasikan apa adanya: ':ready' = adapter
     * read-only terpasang; ':menunggu-map' = pemetaan DOM halaman belum dilakukan.
     */
    const AdapterRegistry = {
        defs: [
            { id: 'account-data', adapter: IgpAccountAdapter },
            { id: 'car-data', adapter: IgpCarsAdapter },
            { id: 'supply-data', adapter: IgpSupplyAdapter },
            { id: 'manufacturer-data', adapter: IgpManufacturersAdapter },
            { id: 'race-strategy', desc: 'strategi balapan (input manual, selalu)' },
        ],
        capture(kind, doc) {
            const d = AdapterRegistry.defs.find(x => x.id === kind);
            if (!d || !d.adapter) return { ok: false, error: 'adapter belum tersedia: ' + kind };
            const target = doc || (typeof document !== 'undefined' ? document : null);
            if (!target) return { ok: false, error: 'dokumen tidak tersedia' };
            try {
                const data = d.adapter.captures(target);
                if (!data) {
                    // Gagal jujur + konteks: sebut halaman yang SEDANG aktif (dari #pageId DOM,
                    // bukan URL) agar user tahu kenapa tidak cocok.
                    let where = '';
                    try {
                        const pid = target.getElementById ? target.getElementById('pageId') : null;
                        if (pid && pid.value) where = ' (halaman aktif: ' + pid.value + ')';
                    } catch (e2) { /* biarkan tanpa konteks */ }
                    return { ok: false, error: 'halaman tidak cocok untuk ' + kind + where };
                }
                return { ok: true, data };
            } catch (e) {
                return { ok: false, error: String(e && e.message || e) };
            }
        },
        status() {
            return AdapterRegistry.defs.map(d => d.id + (d.adapter ? ':ready' : ':menunggu-map')).join(', ');
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
            const fresh = Array.from(reports.values()).some(r => Date.now() - (r.ts || 0) < 60000);
            const hb = fresh
                ? '<span class="badge ok">● sensor terdeteksi</span>'
                : '<span class="badge off">○ sensor belum terdeteksi</span>';
            let html = hb;
            if (reports.size === 0) {
                html += ' <span class="badge">buka tab iGP (userscript aktif)</span>';
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

        function snapRow(k, v) {
            return '<div class="row"><span>' + esc(k) + '</span><span>' +
                esc(v === null || v === undefined || v === '' ? '—' : String(v)) + '</span></div>';
        }

        const fmtMoney = n => (n === null || n === undefined) ? '–' :
            n >= 1e6 ? (Math.round(n / 1e5) / 10) + 'M' :
            n >= 1e3 ? (Math.round(n / 100) / 10) + 'k' : String(n);

        const bonusStr = bs => (bs || [])
            .map(b => b.stat + ' ' + (b.value > 0 ? '+' : '') + b.value).join(' · ') || '—';

        function supplyHtml(s) {
            if (!s) return '<span class="hint">belum ada — buka dialog Supply (klik tile Engines/Fuel/Tyres di halaman Cars), lalu klik “Capture supply”.</span>';
            const names = { engine: 'Engine', fuel: 'Fuel', tyre: 'Tyres' };
            let html = '';
            for (const tp of ['engine', 'fuel', 'tyre']) {
                const d = s.data ? s.data[tp] : null;
                if (!d) { html += '<div class="hint">' + esc(names[tp]) + ': belum tercapture</div>'; continue; }
                const rows = (d.alternatives || []).map(al =>
                    '<tr><td>#' + esc(al.supplierId) + '</td><td>' + esc(bonusStr(al.bonuses)) +
                    '</td><td class="num">' + fmtMoney(al.costPerRace) + '</td></tr>').join('');
                html += '<div class="row"><span>' + esc(names[tp]) + ' — aktif: #' +
                    esc(d.current ? d.current.supplierId : '?') + '</span><span>' +
                    fmtMoney(d.current ? d.current.costPerRace : null) + '/race</span></div>' +
                    '<div class="hint">Bonus: ' + esc(bonusStr(d.current && d.current.bonuses)) + '</div>' +
                    '<table><tr><th>Alt</th><th>Bonus</th><th>Cost/race</th></tr>' + rows + '</table>';
            }
            html += '<div class="hint">tangkap ' + esc(new Date(s.ts).toLocaleTimeString()) + '</div>';
            return html;
        }

        function manufacturerHtml(m) {
            if (!m) return '<span class="hint">belum ada — buka halaman <em>Manufacturers</em> (p=manufacturers) di tab iGP, lalu klik “Capture manufacturers”.</span>';
            const d = m.data || {};
            const pages = d.totalPages || {};
            const head = { engines: 'Engine', chassis: 'Chassis' };
            const tbox = (key, withCost) => {
                const arr = d[key] || [];
                if (!arr.length) return '<div class="hint">' + esc(head[key]) + ': belum tercapture</div>';
                const rows = arr.map(r =>
                    '<tr><td>' + esc(r.name) + '</td><td class="num">' + esc(r.ratingPct) + '%</td>' +
                    (withCost
                        ? '<td class="num">' + fmtMoney(r.costPerRace) + '</td>' +
                          '<td title="stats ' + (r.statsVisible === true ? 'terlihat' : r.statsVisible === false ? 'disembunyikan' : '?') + '">' +
                          (r.statsVisible === true ? '👁' : r.statsVisible === false ? '–' : '?') + '</td>'
                        : '') +
                    '<td class="num">' + esc(r.customers) + '</td></tr>').join('');
                const th = withCost
                    ? '<tr><th>Name</th><th>Rating</th><th>Cost/race</th><th>Stats</th><th>Cust</th></tr>'
                    : '<tr><th>Name</th><th>Rating</th><th>Cust</th></tr>';
                return '<div class="hint">' + esc(head[key]) + ' — ' + arr.length + ' baris · total ' +
                    (pages[key] != null ? pages[key] : '?') + ' halaman</div>' +
                    '<div style="max-height:280px;overflow:auto"><table>' + th + rows + '</table></div>';
            };
            return tbox('engines', true) +
                '<div style="margin-top:10px">' + tbox('chassis', false) + '</div>' +
                '<div class="hint">tangkap ' + esc(new Date(m.ts).toLocaleTimeString()) + '</div>';
        }

        // ---- Autoload & deteksi (v0.5.1) ----
        const KIND_LABEL = { 'account-data': 'akun', 'car-data': 'mobil', 'supply-data': 'supply', 'manufacturer-data': 'manufacturers' };
        let activeReq = null;  // permintaan berjalan: { id, label, kinds, got, details }
        let lastReqAt = 0;     // throttle auto-refresh (≥30 dtk)

        /** Satu permintaan read-once ke tab sensor + laporan deteksi. Tanpa polling DOM game. */
        function requestCollect(kinds, label, note) {
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            activeReq = { id: id, label: label, kinds: kinds, got: {}, details: [], claimedFrom: {} };
            lastReqAt = Date.now();
            Mailbox.send('collect-request', { kinds: kinds, reqId: id });
            Mailbox.send('report-request', {});
            const st = $('igpas-snap-status');
            if (st) {
                st.title = '';
                st.textContent = label + ': permintaan dikirim ke tab iGP (baca-saja, sekali per permintaan)' + (note || '');
            }
            setTimeout(() => {
                if (!activeReq || activeReq.id !== id || Object.keys(activeReq.got).length) return;
                const st2 = $('igpas-snap-status');
                if (st2) st2.textContent = label + ': belum ada respons dari tab iGP — pastikan igpmanager.com terbuka dengan userscript aktif.';
            }, 8000);
        }

        function reqSummary() {
            return activeReq.kinds.map(k =>
                (KIND_LABEL[k] || k) + ' ' + ({ ok: '✓', no: '✗' }[activeReq.got[k]] || '…')).join(' · ');
        }

        function renderSnapshots() {
            const badge = $('igpas-snap-badge');
            const acc = $('igpas-snap-account-body');
            const car = $('igpas-snap-car-body');
            if (!acc || !car) return;
            const a = Storage.getSnapshot('account-data');
            const c = Storage.getSnapshot('car-data');
            const s = Storage.getSnapshot('supply-data');
            const mfr = Storage.getSnapshot('manufacturer-data');
            const sCount = s ? ['engine', 'fuel', 'tyre'].filter(tp => s.data && s.data[tp]).length : 0;
            const mfrCount = mfr ? ['engines', 'chassis'].filter(k => mfr.data && mfr.data[k] && mfr.data[k].length).length : 0;
            if (badge) badge.textContent =
                (a ? 'akun ✓' : 'akun –') + ' · ' + (c ? 'mobil ✓' : 'mobil –') +
                ' · supply ' + sCount + '/3' + ' · mfr ' + mfrCount + '/2';

            if (a) {
                acc.innerHTML =
                    snapRow('Manager', a.data.manager) +
                    snapRow('Level', a.data.level) +
                    snapRow('Rank', (a.data.rank || '') + (a.data.rankTier ? ' (' + a.data.rankTier + ')' : '')) +
                    snapRow('Saldo', a.data.balance) +
                    snapRow('Token', a.data.tokens) +
                    '<div class="hint">tangkap ' + esc(new Date(a.ts).toLocaleTimeString()) + '</div>';
            } else {
                acc.innerHTML = '<span class="hint">belum ada — klik Capture (tab iGP mana pun yang sudah login)</span>';
            }

            if (c) {
                const d = c.data;
                const attrs = Object.keys(d.attrs || {}).map(k =>
                    '<tr><td>' + esc(d.attrs[k].label || k) + '</td><td class="num">' +
                    esc(d.attrs[k].val) + '</td></tr>').join('');
                const bonuses = (d.bonuses || []).map(b =>
                    esc(b.key + ' ' + (b.bonus > 0 ? '+' : '') + b.bonus)).join(' · ') || '—';
                const sup = (d.suppliers || []).map(s =>
                    esc((s.kind || '?') + ' #' + s.id)).join(' · ') || '—';
                car.innerHTML =
                    snapRow('Tipe mobil', d.carType) +
                    snapRow('Design points', d.designPoints) +
                    snapRow('Skala maks (dmax)', d.dmax) +
                    '<table><tr><th>Atribut</th><th>Nilai</th></tr>' + attrs + '</table>' +
                    '<div class="hint">Bonus supplier: ' + bonuses + '</div>' +
                    '<div class="hint">Supplier: ' + sup + '</div>' +
                    '<div class="hint">tangkap ' + esc(new Date(c.ts).toLocaleTimeString()) + '</div>';
            } else {
                car.innerHTML = '<span class="hint">belum ada — buka halaman <em>Cars</em> di tab iGP, lalu klik Capture</span>';
            }

            const sup = $('igpas-snap-supply-body');
            if (sup) sup.innerHTML = supplyHtml(s);

            const mfrBody = $('igpas-snap-manufacturer-body');
            if (mfrBody) mfrBody.innerHTML = manufacturerHtml(mfr);
        }

        let mounted = false;
        function mount() {
            if (mounted) return; // idempoten — aman dari double DOMContentLoaded
            mounted = true;
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

            // Snapshot akun/mobil/supply (Fase 3 — baca-saja, read-once per permintaan)
            const cap = $('igpas-snap-capture');
            if (cap) cap.addEventListener('click', () => requestCollect(['account-data', 'car-data'], 'Capture'));
            const capSup = $('igpas-snap-capture-supply');
            if (capSup) capSup.addEventListener('click', () =>
                requestCollect(['supply-data'], 'Capture supply', ' — buka dialog Supply dulu di tab iGP'));
            const capMfr = $('igpas-snap-capture-manufacturers');
            if (capMfr) capMfr.addEventListener('click', () =>
                requestCollect(['manufacturer-data'], 'Capture manufacturers', ' — buka halaman Manufacturers dulu di tab iGP'));
            const clr = $('igpas-snap-clear');
            if (clr) clr.addEventListener('click', () => {
                Storage.clearSnapshots();
                const st = $('igpas-snap-status');
                if (st) st.textContent = 'snapshot dihapus.';
                renderSnapshots();
            });

            Mailbox.on('collect-result', p => {
                const pay = (p && p.payload) || {};
                const st = $('igpas-snap-status');
                const hasReqId = typeof pay.reqId === 'string' && pay.reqId.length > 0;
                const matchesActive = hasReqId && activeReq && pay.reqId === activeReq.id;
                const requestedKind = matchesActive && activeReq.kinds.indexOf(pay.kind) >= 0;
                const priorState = requestedKind ? activeReq.got[pay.kind] : null;
                // Error dari satu sensor tidak mengunci kind: sensor lain boleh
                // memberi hasil sukses (penting saat beberapa tab sensor broadcast).
                const firstOrSuccessAfterError = requestedKind &&
                    (!priorState || (priorState === 'no' && pay.ok && pay.data));
                const sender = (p && p.from) || 'unknown';
                const claimedSender = requestedKind && activeReq.claimedFrom[pay.kind];
                const senderAllowed = firstOrSuccessAfterError && (!claimedSender || claimedSender === sender);

                if (senderAllowed) {
                    // Authorization penyimpanan dipisahkan dari korelasi UI:
                    // hanya request aktif, kind yang diminta, hasil pertama per kind,
                    // dan sender pertama per kind yang boleh menulis snapshot.
                    if (pay.ok && pay.data) activeReq.claimedFrom[pay.kind] = sender;
                    if (pay.ok && pay.data) {
                        if (pay.kind === 'supply-data') {
                            Storage.mergeSnapshot('supply-data', { [pay.data.type]: pay.data });
                        } else {
                            Storage.saveSnapshot(pay.kind, pay.data);
                        }
                    }
                    activeReq.got[pay.kind] = pay.ok ? 'ok' : 'no';
                    if (!pay.ok && pay.error) activeReq.details.push(pay.kind + ': ' + pay.error);
                    if (st) {
                        const complete = activeReq.kinds.every(k => activeReq.got[k]);
                        st.title = activeReq.details.join(' | ');
                        st.textContent = activeReq.label + ': ' + reqSummary() +
                            (complete ? ' — selesai ' + new Date().toLocaleTimeString() : '');
                    }
                    renderSnapshots();
                } else if (!hasReqId && st) {
                    // Legacy result tanpa reqId: tetap tampilkan status informatif,
                    // tetapi TIDAK boleh mengotorisasi penulisan snapshot.
                    if (pay.ok && pay.data) {
                        st.textContent = pay.kind + ' diterima tanpa reqId — tidak disimpan (' + new Date().toLocaleTimeString() + ').';
                    } else {
                        const extra = pay.kind === 'supply-data' ? ' — buka dialog Supply dulu di tab iGP' : '';
                        st.textContent = '✗ ' + pay.kind + ': ' + (pay.error || 'tidak ada data') + extra;
                    }
                }
                // Result dengan reqId yang stale, duplikat, atau kind tak diminta
                // sengaja diabaikan: tidak mengubah status dan tidak menimpa snapshot.
            });

            Mailbox.on('report', p => {
                reports.set(p.from, {
                    label: (p.payload && p.payload.label) || p.from,
                    url: p.payload && p.payload.url,
                    adapters: p.payload && p.payload.adapters,
                    profiles: p.payload && p.payload.profiles,
                    t: new Date(p.ts).toLocaleTimeString(),
                    ts: p.ts,
                });
                refreshInstances();
                const ls = $('igpas-gui-last-sync');
                if (ls) ls.textContent = 'Last sync: ' + new Date().toLocaleTimeString();
            });

            setInterval(refreshInstances, 2000);
            refreshInstances();

            // Autoload (v0.5.1): satu permintaan read-once saat /app/ dibuka, plus saat
            // kembali ke tab ini (jeda ≥30 dtk). Bukan polling DOM game — sensor hanya
            // membaca halaman saat ada permintaan eksplisit dari GUI.
            if ($('igpas-snap-capture')) {
                requestCollect(['account-data', 'car-data'], 'autoload');
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible' && (Date.now() - lastReqAt) > 30000) {
                        requestCollect(['account-data', 'car-data'], 'auto-refresh');
                    }
                });
            }
        }

        return { mount: mount };
    })();

    /* =====================================================================
     * 3b) ADVISOR IN-PAGE (v0.7.0) — rekomendasi read-only di halaman STUDI iGP.
     *  - HANYA MENAMBAH elemen milik sendiri (id/class prefiks igpas-adv-);
     *    tidak pernah mengubah/menghapus elemen game, tidak mengklik, tidak
     *    submit, tidak fetch/XHR, tidak mengirim packet mailbox apa pun.
     *  - Aktif hanya di #pageId 'cars' (termasuk dialog Supply terbuka) dan
     *    'manufacturers'. Tidak pernah menempel di halaman balapan/strategi.
     *  - Re-render dipicu aksi user (klik/navigasi) — BUKAN polling DOM.
     *  - Semua angka = pembacaan DOM yang memang tampil + heuristik eksplisit
     *    IGPCore, berlabel "estimasi — bukan rumus game".
     * ===================================================================== */
    const Advisor = (() => {
        const PREFIX = 'igpas-adv';
        const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const fmtMoney = n => {
            const v = Number(n);
            if (n == null || !Number.isFinite(v)) return '—';
            if (v >= 1e9) return (Math.round(v / 1e8) / 10) + ' M';
            if (v >= 1e6) return (Math.round(v / 1e5) / 10) + ' jt';
            if (v >= 1e3) return (Math.round(v / 1e2) / 10) + ' rb';
            return String(v);
        };
        const pageId = () => {
            const el = document.getElementById('pageId');
            return el ? String(el.value || '').trim() : null;
        };

        const STYLE = [
            '.igpas-adv-panel{margin:10px 0;padding:10px 12px;background:#0e2a30;color:#eaf6f3;',
            'border:2px solid #0b262b;border-radius:11px;font:12px/1.5 Arial,Helvetica,sans-serif;',
            'box-shadow:0 2px 8px rgba(0,0,0,.25);text-align:left;max-width:720px}',
            '.igpas-adv-panel h3{margin:0 0 6px;font-size:13px}',
            '.igpas-adv-kicker{display:block;margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8fd6c6}',
            '.igpas-adv-panel table{width:100%;border-collapse:collapse;margin:6px 0}',
            '.igpas-adv-panel th,.igpas-adv-panel td{padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.14);text-align:right;vertical-align:top}',
            '.igpas-adv-panel th:first-child,.igpas-adv-panel td:first-child{text-align:left}',
            '.igpas-adv-panel th{font-size:11px;color:#bcd8d2;text-transform:uppercase;letter-spacing:.05em}',
            '.igpas-adv-note{margin:6px 0 0;font-size:11px;color:#bcd8d2}',
            '.igpas-adv-tag{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:8px;background:#8fd6c6;color:#0b262b;font-size:10px;font-weight:700}',
            '.igpas-adv-panel tr.igpas-adv-best td{background:rgba(143,214,198,.16);font-weight:700}',
            '#igpas-adv-toggle{position:fixed;left:12px;bottom:12px;z-index:2147483000;padding:8px 12px;',
            'border:2px solid #0b262b;border-radius:20px;background:#0e2a30;color:#eaf6f3;',
            'font:700 12px Arial,Helvetica,sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.3)}',
            'body.igpas-adv-hide .igpas-adv-panel{display:none!important}',
        ].join('');

        function styleEnsure() {
            if (document.getElementById(PREFIX + '-style')) return;
            const st = document.createElement('style');
            st.id = PREFIX + '-style';
            st.textContent = STYLE;
            document.head.appendChild(st);
        }

        function panelEl(id, kicker, title, bodyHtml, noteHtml) {
            let el = document.getElementById(id);
            if (!el) {
                el = document.createElement('section');
                el.id = id;
                el.className = 'igpas-adv-panel';
                el.setAttribute('role', 'complementary');
                el.setAttribute('aria-label', 'I.G.P.A.S ' + title);
            }
            el.innerHTML = '<span class="igpas-adv-kicker">' + esc(kicker) + '</span>' +
                '<h3>' + esc(title) + '</h3>' + bodyHtml +
                (noteHtml ? '<p class="igpas-adv-note">' + noteHtml + '</p>' : '');
            return el;
        }

        function removeIfAny(ids) {
            for (const id of ids) {
                const el = document.getElementById(id);
                if (el) el.remove();
            }
        }

        /* Halaman Cars: prioritas alokasi design points vs benchmark liga. */
        function mountDesign() {
            const id = PREFIX + '-design';
            const anchor = (pageId() === 'cars') ? document.getElementById('carAttributesDisplay') : null;
            if (!anchor) { removeIfAny([id]); return; }
            const data = IgpCarsAdapter.captures(document);
            const res = IGPCore.designPriority({
                attrs: data && data.attrs,
                best: data && data.best,
                designPoints: data && data.designPoints,
            });
            let body = '';
            let note = '';
            if (res.ok) {
                const rows = res.values.ranked.map(r => {
                    const best = r === res.values.ranked[0];
                    return '<tr' + (best ? ' class="igpas-adv-best"' : '') + '>' +
                        '<td>' + esc(r.label) + '</td><td>' + esc(r.val) + '</td>' +
                        '<td>' + (r.max == null ? '—' : esc(r.max)) + '</td>' +
                        '<td>' + (r.gap == null ? '—' : esc(r.gap)) + '</td>' +
                        '<td>' + (r.sharePct != null ? r.sharePct + '%' : '—') + '</td></tr>';
                }).join('');
                body = '<table><thead><tr><th>Atribut</th><th>Nilai</th><th>Max liga</th><th>Gap</th><th>Usulan DP</th></tr></thead><tbody>' +
                    rows + '</tbody></table>';
                note = 'Total DP: ' + (res.values.designPoints != null ? esc(res.values.designPoints) : '?') +
                    ' · heuristik selisih terhadap max liga — <strong>estimasi, bukan rumus game</strong>; ' +
                    'porsi % = share gap terbesar. Uji hasil alokasimu sendiri di race time non-kritis.' +
                    (res.values.unbenchmarked ? ' · ' + res.values.unbenchmarked + ' atribut tanpa benchmark liga.' : '');
            } else {
                note = esc(res.error) + '.';
            }
            anchor.insertAdjacentElement('afterend', panelEl(id, 'I.G.P.A.S · design points', 'Prioritas alokasi DP (estimasi)', body, note));
        }

        /* Dialog Supply (engine/fuel/tyre): bandingkan supplier aktif vs alternatif. */
        function mountSupply() {
            const id = PREFIX + '-supply';
            const dlg = document.querySelector('.supplyDialog');
            if (!dlg) { removeIfAny([id]); return; }
            const s = IgpSupplyAdapter.captures(document);
            let body = '';
            let note = '';
            if (!s) {
                note = 'Dialog Supply terbuka tapi tidak terbaca (varian DOM baru?). Tidak ada rekomendasi — jangan dianggap data.';
            } else {
                const cur = s.current || {};
                const res = IGPCore.rankSuppliers({ items: s.alternatives });
                if (res.ok) {
                    const rows = res.values.ranked.map(r => {
                        const isBest = r.valuePerCost != null && r.id === res.values.bestValueId;
                        const isCheap = !isBest && res.values.cheapestId != null && r.id === res.values.cheapestId;
                        return '<tr' + (isBest ? ' class="igpas-adv-best"' : '') + '>' +
                            '<td>Supplier #' + esc(r.id != null ? r.id : '?') +
                            (isBest ? '<span class="igpas-adv-tag">terbaik nilai</span>' : '') +
                            (isCheap ? '<span class="igpas-adv-tag">termurah</span>' : '') + '</td>' +
                            '<td>' + (r.value == null ? '—' : esc((r.value > 0 ? '+' : '') + r.value)) + '</td>' +
                            '<td>' + fmtMoney(r.cost) + '</td>' +
                            '<td>' + (r.valuePerCost == null ? '—' : esc(r.valuePerCost)) + '</td></tr>';
                    }).join('');
                    body = '<p class="igpas-adv-note">Aktif: supplier #' +
                        esc(cur.supplierId != null ? cur.supplierId : '?') + ' · ' +
                        fmtMoney(cur.costPerRace) + '/race — dibandingkan dengan alternatif di dialog ini:</p>' +
                        '<table><thead><tr><th>Alternatif</th><th>Σ bonus</th><th>Biaya</th><th>Nilai/1M</th></tr></thead><tbody>' +
                        rows + '</tbody></table>';
                } else {
                    note = esc(res.error) + '. Alternatif mungkin tidak tampil di dialog ini.';
                }
                note += (note ? ' ' : '') +
                    'Σ bonus = jumlah nilai semua stat bonus (stat berbeda tidak disetarakan rumus game). ' +
                    'Nilai/1M = bonus per 1jt biaya — heuristik estimasi; kombinasi terbaik tetap perlu Anda uji.';
            }
            dlg.appendChild(panelEl(id, 'I.G.P.A.S · supply' + (s ? ' · ' + s.type : ''), 'Rekomendasi supplier (estimasi)', body, note));
        }

        /* Halaman Manufacturers: ranking engine & chassis yang tampil di pager ini. */
        function mountManufacturers() {
            const idE = PREFIX + '-mfg-engine';
            const idC = PREFIX + '-mfg-chassis';
            if (pageId() !== 'manufacturers') { removeIfAny([idE, idC]); return; }
            const m = IgpManufacturersAdapter.captures(document);
            const pages = (m && m.totalPages) || {};
            const pagerNote = (m && m.totalPages)
                ? 'Baris yang tampil di pager ini saja' +
                  (pages.engines != null ? ' · engine ' + pages.engines + ' hal.' : '') +
                  (pages.chassis != null ? ' · chassis ' + pages.chassis + ' hal.' : '') + '.'
                : 'Baris yang tampil di pager ini saja.';
            // Engines: rating + biaya/race → rating per 1M.
            const et = document.getElementById('engine-table');
            if (et) {
                const res = IGPCore.rankManufacturerItems({ items: m ? m.engines : [], withCost: true });
                let body = '';
                let note = pagerNote + ' Rating% dari tooltip tabel; rating/1M = heuristik estimasi — bukan rumus game.';
                if (res.ok) {
                    const rows = res.values.ranked.slice(0, 5).map((r, i) => {
                        const tag =
                            (res.values.bestRatingId === r.id ? '<span class="igpas-adv-tag">rating tertinggi</span>' : '') +
                            (res.values.bestValueId === r.id ? '<span class="igpas-adv-tag">nilai terbaik</span>' : '');
                        return '<tr' + (i === 0 ? ' class="igpas-adv-best"' : '') + '>' +
                            '<td>' + (i + 1) + '. ' + esc(r.name) + tag + '</td>' +
                            '<td>' + esc(r.rating) + '%</td><td>' + fmtMoney(r.cost) + '</td>' +
                            '<td>' + (r.ratingPerCost == null ? '—' : esc(r.ratingPerCost)) + '</td></tr>';
                    }).join('');
                    body = '<table><thead><tr><th>Engine</th><th>Rating</th><th>Biaya</th><th>Rating/1M</th></tr></thead><tbody>' +
                        rows + '</tbody></table>';
                } else {
                    body = '<p class="igpas-adv-note">' + esc(res.error) + '.</p>';
                }
                et.insertAdjacentElement('beforebegin',
                    panelEl(idE, 'I.G.P.A.S · manufacturers', 'Ranking engine halaman ini (estimasi)', body, note));
            } else {
                removeIfAny([idE]);
            }
            // Chassis: rating (+customers) — tanpa biaya.
            const ct = document.getElementById('chassis-table');
            if (ct) {
                const res = IGPCore.rankManufacturerItems({ items: m ? m.chassis : [], withCost: false });
                let body = '';
                if (res.ok) {
                    const rows = res.values.ranked.slice(0, 5).map((r, i) => {
                        const tag = res.values.bestRatingId === r.id ? '<span class="igpas-adv-tag">rating tertinggi</span>' : '';
                        return '<tr' + (i === 0 ? ' class="igpas-adv-best"' : '') + '>' +
                            '<td>' + (i + 1) + '. ' + esc(r.name) + tag + '</td>' +
                            '<td>' + esc(r.rating) + '%</td></tr>';
                    }).join('');
                    body = '<table><thead><tr><th>Chassis</th><th>Rating</th></tr></thead><tbody>' + rows + '</tbody></table>';
                } else {
                    body = '<p class="igpas-adv-note">' + esc(res.error) + '.</p>';
                }
                const note = pagerNote + ' Heuristik estimasi — bukan rumus game.';
                const rebuilt = panelEl(idC, 'I.G.P.A.S · manufacturers', 'Ranking chassis halaman ini (estimasi)', body, note);
                ct.insertAdjacentElement('beforebegin', rebuilt);
            } else {
                removeIfAny([idC]);
            }
        }

        function renderAll() {
            if (typeof document === 'undefined' || !document.body) return;
            const pid = pageId();
            if (pid !== 'cars' && pid !== 'manufacturers') {
                // Halaman lain (termasuk balapan/strategi): tanpa jejak UI apa pun.
                removeIfAny([PREFIX + '-toggle', PREFIX + '-design', PREFIX + '-supply', PREFIX + '-mfg-engine', PREFIX + '-mfg-chassis']);
                return;
            }
            styleEnsure();
            if (!document.getElementById(PREFIX + '-toggle')) {
                const btn = document.createElement('button');
                btn.id = PREFIX + '-toggle';
                btn.type = 'button';
                btn.setAttribute('aria-pressed', 'false');
                btn.setAttribute('aria-label', 'Tampilkan atau sembunyikan panel advisor I.G.P.A.S');
                btn.addEventListener('click', () => {
                    const pref = gm.get(Keys.advisor, null) || {};
                    gm.set(Keys.advisor, { hidden: !pref.hidden });
                    applyHidden();
                });
                document.body.appendChild(btn);
            }
            applyHidden();
            try {
                mountDesign();
                mountSupply();
                mountManufacturers();
            } catch (e) {
                if (typeof console !== 'undefined') console.warn('IGPAS advisor', e); // jangan pernah merusak halaman game
            }
        }

        function applyHidden() {
            const pref = gm.get(Keys.advisor, null);
            const hidden = !!(pref && pref.hidden);
            if (hidden) document.body.classList.add('igpas-adv-hide');
            else document.body.classList.remove('igpas-adv-hide');
            const btn = document.getElementById(PREFIX + '-toggle');
            if (btn) {
                btn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
                btn.textContent = (hidden ? '▸ ' : '▾ ') + 'I.G.P.A.S advisor';
            }
        }

        function start() {
            if (typeof document === 'undefined' || !document.body) return;
            renderAll();
            // Re-render dipicu aksi user (buka dialog Supply, ganti tab/pager, pindah halaman).
            let pending = null;
            const schedule = () => {
                if (pending) clearTimeout(pending);
                pending = setTimeout(() => { pending = null; renderAll(); }, 250);
            };
            document.addEventListener('click', schedule, true);
            document.addEventListener('keydown', schedule, true);
            window.addEventListener('popstate', schedule);
            window.addEventListener('hashchange', schedule);
        }

        return { start: start, renderAll: renderAll };
    })();

    /* =====================================================================
     * 3c) PAGE CAPTURE (v0.7.1) — satu-klik salin DOM utk pemetaan fixture.
     *  - Tanpa UI di halaman: hanya entri menu Tampermonkey/Violentmonkey
     *    (GM_registerMenuCommand). Tidak menambah elemen apa pun ke situs,
     *    termasuk di halaman balapan.
     *  - 100% dipicu user; hasil = salinan read-only DOM dengan redaksi PII
     *    tetap (nama, saldo, token, rank), lewat GM_setClipboard. Tidak ada
     *    jaringan, tidak ada mailbox, tidak ada penyimpanan otomatis.
     *  - Tujuan: user bisa kirim capture halaman belum terpetakan (mis.
     *    Develop/Design) agar advisor DP bisa dipasang di tempat yang tepat.
     * ===================================================================== */
    const PageCapture = (() => {
        const REDACT_SELECTORS = ['#myProfileName', '#balanceText', '#tokens-total', '#managerRankValue'];
        function buildCapture(doc) {
            if (!doc || !doc.documentElement) return null;
            const clone = doc.documentElement.cloneNode(true);
            for (const sel of REDACT_SELECTORS) {
                const el = clone.querySelector(sel); // id selalu unik — satu penulisan cukup
                if (el) el.textContent = '[REDACTED]';
            }
            return '<!doctype html>\n<html>' + clone.innerHTML + '</html>';
        }
        function install() {
            if (typeof document === 'undefined') return;
            if (typeof GM_registerMenuCommand !== 'function' || typeof GM_setClipboard !== 'function') return;
            GM_registerMenuCommand('I.G.P.A.S: salin capture DOM halaman ini (fixture mapping)', () => {
                const html = buildCapture(document);
                if (!html) return;
                GM_setClipboard(html, 'text/html');
                if (typeof GM_notification === 'function') {
                    GM_notification({
                        title: 'I.G.P.A.S capture',
                        text: 'DOM halaman (PII teredaksi) disalin ke clipboard. Tempel & kirim untuk pemetaan fixture.',
                    });
                }
            });
        }
        return { buildCapture: buildCapture, install: install };
    })();

    /* =====================================================================
     * 4) BOOT — pasang UI read-only. Elemen game tidak pernah diubah.
     * ===================================================================== */

    function boot() {
        if (typeof document === 'undefined') return; // lingkungan non-browser (tes)

        const startUi = () => {
            // v0.7.0: tab iGP tetap sensor mailbox + MENAMBAH advisor in-page read-only
            // (hanya elemen milik sendiri, halaman studi Cars/Manufacturers — tidak
            // pernah di halaman balapan; elemen game tidak disentuh).
            if (ROLE === 'sensor' && typeof Advisor !== 'undefined') Advisor.start();
            if (ROLE === 'gui' && typeof GuiMaster !== 'undefined') GuiMaster.mount();
            // v0.7.1: menu Tampermonkey utk salin capture DOM (redaksi PII) — tanpa UI halaman.
            if (typeof PageCapture !== 'undefined') PageCapture.install();
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

            Mailbox.on('collect-request', p => {
                // Baca-saja: jalankan adapter atas halaman yang SEDANG terbuka,
                // sekali per permintaan — tanpa polling, tanpa sentuhan elemen game.
                const pay = (p && p.payload) || {};
                const kinds = pay.kinds || ['account-data', 'car-data'];
                for (const kind of kinds) {
                    const res = AdapterRegistry.capture(kind);
                    Mailbox.send('collect-result', {
                        reqId: pay.reqId || null,
                        kind,
                        ok: res.ok,
                        data: res.data || null,
                        error: res.error || null,
                        pageUrl: (typeof location !== 'undefined') ? location.href : '?',
                    });
                }
            });
        }
    }

    boot();

    // Ekspor untuk pengujian Node — tanpa efek di browser (module tak terdefinisi).
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { IGPCore, AdapterRegistry, Storage, Mailbox, Advisor, PageCapture };
    }
})();
