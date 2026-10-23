// ==UserScript==
// @name         I.G.P.A.S — iGP Analytics & Study System
// @namespace    https://github.com/Cnagnn/igpas
// @version      0.11.0
// @description  Read-only in-page study advisor for iGP Manager: #1..#n sorted design-point priorities, color-coded supply and parts/engine repair buttons, supplier/manufacturer rankings, staff/transfer notes, and sponsor-offer value rankings written only as text/title/style on original page elements. Includes a menu command to copy a PII-redacted DOM capture. Study tool only, no automation, no network.
// @description:id Penasihat studi read-only in-page untuk iGP Manager: prioritas design terurut #1..#n, warna tombol Supply dan ganti parts/engine, peringkat supplier/manufacturer, catatan staff/transfers, dan peringkat nilai penawaran sponsor — hanya teks/title/style pada elemen asli. Termasuk menu salin capture DOM dengan redaksi PII. Alat studi, tanpa otomasi, tanpa jaringan.
// @license      GPL-3.0-or-later
// @homepageURL  https://github.com/Cnagnn/igpas
// @supportURL   https://github.com/Cnagnn/igpas/issues
// @match        https://igpmanager.com/*
// @match        https://*.igpmanager.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function IGPAS() {
    'use strict';

    const VERSION = '0.11.0';

    /* =====================================================================
     * 1) CORE — fungsi murni, tanpa DOM. Teruji di Node (test/core.test.js).
     *    Semua perhitungan hanya aritmetika atas input pengguna.
     * ===================================================================== */

    const r1 = v => Math.round(v * 10) / 10;

    /* -- utils bersama (dedup helper) -- */
    const Utils = Object.freeze({
      numOrNull(v) {
        // Trim dulu: field DOM yang hanya berisi spasi ("   ") bukan angka 0.
        const s = (v == null) ? '' : String(v).trim();
        return s !== '' && Number.isFinite(Number(s)) ? Number(s) : null;
      },
      clean(s) {
        return String(s || '').replace(/\s+/g, ' ').trim();
      },
      parseMoney(t) {
        const m = String(t || '').match(/(\d+(?:\.\d+)?)\s*([kmb]?)/i);
        if (!m) return null;
        const suf = m[2].toLowerCase();
        return Math.round(parseFloat(m[1]) * (suf === 'k' ? 1e3 : suf === 'm' ? 1e6 : suf === 'b' ? 1e9 : 1));
      },
      fmtMoney(n) {
        const v = Number(n);
        if (n == null || !Number.isFinite(v)) return '—';
        if (v >= 1e9) return (Math.round(v / 1e8) / 10) + ' M';
        if (v >= 1e6) return (Math.round(v / 1e5) / 10) + ' jt';
        if (v >= 1e3) return (Math.round(v / 1e2) / 10) + ' rb';
        return String(v);
      },
      pitWindowCore(fuelLaps, reserveLaps, tyreLaps, marginLaps) {
        const fuelLatest = Math.max(0, Math.floor(fuelLaps - reserveLaps));
        const latest = Math.min(fuelLatest, tyreLaps);
        const recommended = Math.max(0, latest - marginLaps);
        return { fuelLatest, latest, recommended };
      },
      isSafeKind(k) {
        return typeof k === 'string' && k.length > 0 && k.length < 80 && !/(__proto__|constructor|prototype)/i.test(k);
      },
      /**
       * Indeks 12-stat dari CSV `data-driver`/`data-staff` halaman iGP
       * (v0.8.0). Rata-rata 12 angka pertama CSV — dipakai IDENTIK di sisi
       * roster maupun pasar, jadi keduanya bisa dibandingkan. Ini BUKAN
       * overall game: game menghitung dari angka internal yang tidak
       * dipublikasikan (CSV dibulatkan per stat), jadi angkanya berbeda
       * tipis dari kolom "Overall/Fee" — selalu dilabeli heuristik.
       * 12 angka tidak lengkap → null (tidak dikarang).
       */
      statIndex(csv) {
        const parts = String(csv == null ? '' : csv).split(',');
        const vals = [];
        for (let i = 0; i < 12 && i < parts.length; i++) {
          const v = Utils.numOrNull(parts[i]);
          if (v != null) vals.push(v);
        }
        if (vals.length < 12) return null;
        const mean = vals.reduce((s, v) => s + v, 0) / 12;
        return Math.round(mean * 100) / 100;
      },
      /**
       * Normalisasi label peran staff ke kode (CD/TD/DR) agar roster & pasar
       * sebanding. Penanda non-staff (mis. 'DRV' untuk driver) diteruskan apa
       * adanya — huruf besar dipertahankan supaya label UI tetap rapi.
       */
      roleCode(s) {
        const raw = Utils.clean(s);
        if (!raw) return null;
        const t = raw.toLowerCase();
        if (/chief\s*designer|^cd$/.test(t)) return 'CD';
        if (/technical\s*director|^td$/.test(t)) return 'TD';
        if (/^doctor$|^dr$/.test(t)) return 'DR';
        if (t === 'drv') return 'DRV';
        return t.slice(0, 40);
      },
    });


    const IGPCore = Object.freeze({

        /**
         * Perencanaan fuel.
         * @param {object} p { lapsRemaining, fuelPerLap, currentFuel, reserveLaps, tankCapacity }
         * @returns {object} { ok, rows:[ {key,label,text} ], values:{...} }
         */
        calcFuel(p) {
            const numOrNull = Utils.numOrNull;
            const src = p || {};
            const lapsRemaining = numOrNull(src.lapsRemaining);
            const fuelPerLap = numOrNull(src.fuelPerLap);
            const currentFuel = numOrNull(src.currentFuel);
            const reserveLaps = numOrNull(src.reserveLaps);
            const tank = (src.tankCapacity == null || String(src.tankCapacity).trim() === '')
                ? Infinity : numOrNull(src.tankCapacity);

            // null = field belum diisi/tak terbaca. JANGAN dianggap 0
            // (Number(null) === 0 pernah menghasilkan "butuh 0 L" yang percaya diri).
            if (lapsRemaining == null) return { ok: false, error: 'Laps remaining wajib diisi' };
            if (fuelPerLap == null) return { ok: false, error: 'Fuel/lap wajib diisi' };
            if (currentFuel == null) return { ok: false, error: 'Fuel kini wajib diisi' };
            if (!(lapsRemaining >= 0)) return { ok: false, error: 'Laps remaining harus >= 0' };
            if (!(fuelPerLap > 0)) return { ok: false, error: 'Fuel/lap harus > 0' };
            if (!(currentFuel >= 0)) return { ok: false, error: 'Fuel kini harus >= 0' };
            if (reserveLaps != null && reserveLaps < 0) return { ok: false, error: 'Reserve harus >= 0' };
            if (tank !== Infinity && !(tank > 0)) return { ok: false, error: 'Kapasitas tangki harus > 0' };

            const reserve = reserveLaps != null ? reserveLaps : 0;
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
            const numOrNull = Utils.numOrNull;
            const src = p || {};
            const cur = numOrNull(src.currentWearPct);
            const wpl = numOrNull(src.wearPerLapPct);
            const laps = numOrNull(src.lapsCount);

            if (cur == null) return { ok: false, error: 'Wear kini wajib diisi' };
            if (wpl == null) return { ok: false, error: 'Wear/lap wajib diisi' };
            if (laps == null) return { ok: false, error: 'Horizon wajib diisi' };
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
            const numOrNull = Utils.numOrNull;
            const src = p || {};
            const cur = numOrNull(src.currentWearPct);
            const wpl = numOrNull(src.wearPerLapPct);
            const thr = numOrNull(src.thresholdPct);

            if (cur == null) return { ok: false, error: 'Wear kini wajib diisi' };
            if (wpl == null) return { ok: false, error: 'Wear/lap wajib diisi' };
            if (thr == null) return { ok: false, error: 'Threshold wajib diisi' };
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
            const numOrNull = Utils.numOrNull;
            const src = p || {};
            const fuelLaps = numOrNull(src.lapsLeftOnFuel);
            const reserveLaps = numOrNull(src.reserveLaps);
            const tireLaps = (src.tireLaps == null || String(src.tireLaps).trim() === '')
                ? Infinity : numOrNull(src.tireLaps);
            const margin = numOrNull(src.marginLaps);

            if (fuelLaps == null) return { ok: false, error: 'Laps left on fuel wajib diisi' };
            if (!(fuelLaps >= 0)) return { ok: false, error: 'Laps left on fuel >= 0' };
            // Nilai negatif tidak boleh "diam-diam jadi 0": reserve/margin negatif
            // membalik arah rekomendasi (pit lebih lambat dari batas aman).
            if (reserveLaps != null && reserveLaps < 0) return { ok: false, error: 'Reserve harus >= 0' };
            if (margin != null && margin < 0) return { ok: false, error: 'Margin harus >= 0' };
            if (tireLaps !== Infinity && !(tireLaps > 0)) return { ok: false, error: 'Tire laps harus > 0' };

            const core = Utils.pitWindowCore(fuelLaps, reserveLaps != null ? reserveLaps : 0,
                tireLaps, margin != null ? margin : 0);
            const needPitNow = core.latest < 1;

            return {
                ok: true,
                values: { fuelLatest: core.fuelLatest, tireLatest: (tireLaps === Infinity ? Infinity : tireLaps), latest: core.latest, recommended: core.recommended },
                rows: [
                    ['Batas oleh fuel', core.fuelLatest + ' lap'],
                    ['Batas oleh ban', (tireLaps === Infinity ? '∞' : tireLaps + ' lap')],
                    ['Latest pit setelah', core.latest + ' lap'],
                    ['Rekomendasi (−margin)', core.recommended + ' lap'],
                    ...(needPitNow ? [['⚠', 'Pit sekarang — tidak bisa menunggu 1 lap penuh']] : []),
                ],
            };
        },

        /**
         * Pembagian stint merata.
         * @param {object} p { totalLaps, tireLifeLaps, pitLossLaps }
         */
        stintSplit(p) {
            const numOrNull = Utils.numOrNull;
            const src = p || {};
            const total = numOrNull(src.totalLaps);
            const life = numOrNull(src.tireLifeLaps);
            const pitLoss = numOrNull(src.pitLossLaps);

            if (total == null) return { ok: false, error: 'Total lap wajib diisi' };
            if (life == null) return { ok: false, error: 'Umur ban wajib diisi' };
            if (!(total >= 1)) return { ok: false, error: 'Total lap >= 1' };
            if (!(life > 0)) return { ok: false, error: 'Umur ban harus > 0' };
            // Umur < 1 lap = data rusak; tanpa batas ini Array.from membuat
            // puluhan ribu stint dan membekukan render.
            if (life < 1) return { ok: false, error: 'Umur ban minimal 1 lap' };
            if (pitLoss != null && !(pitLoss >= 0)) return { ok: false, error: 'Pit loss harus >= 0' };
            const loss = pitLoss != null ? pitLoss : 0;

            const segments = Math.ceil(total / life);
            const stops = segments - 1;
            const rem = total % segments;
            const base = (total - rem) / segments;
            const stints = Array.from({ length: segments }, (_, i) => base + (i < rem ? 1 : 0));
            const timeCostLaps = r1(stops * loss);

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
            const numOrNull = Utils.numOrNull;
            const src = p || {};
            const fuelLaps = numOrNull(src.lapsLeftOnFuel);
            const tyreRaw = (src.tyreLapsLeft == null || String(src.tyreLapsLeft).trim() === '')
                ? Infinity : numOrNull(src.tyreLapsLeft);
            const reserve = numOrNull(src.reserveLaps);
            const pitLoss = numOrNull(src.pitLossLaps);
            const margin = numOrNull(src.marginLaps);

            if (fuelLaps == null) return { ok: false, error: 'Laps left on fuel wajib diisi' };
            if (!(fuelLaps >= 0)) return { ok: false, error: 'Laps left on fuel >= 0' };
            if (tyreRaw !== Infinity && !(tyreRaw > 0)) return { ok: false, error: 'Tyre laps harus > 0' };
            if ((reserve != null && !(reserve >= 0)) || (pitLoss != null && !(pitLoss >= 0)) ||
                (margin != null && !(margin >= 0))) {
                return { ok: false, error: 'Reserve/pit-loss/margin >= 0' };
            }

            const res = reserve != null ? reserve : 0;
            const loss = pitLoss != null ? pitLoss : 0;
            const mar = margin != null ? margin : 0;
            const core = Utils.pitWindowCore(fuelLaps, res, tyreRaw, mar);
            const limiting = core.fuelLatest < tyreRaw ? 'fuel' : (tyreRaw < core.fuelLatest ? 'tyre' : 'tie');
            const decision = core.latest < 1 ? 'pit-now' : (core.recommended <= 1 ? 'pit-soon' : 'plan');

            return {
                ok: true,
                values: { decision, latest: core.latest, recommended: core.recommended, limiting, pitLoss: loss },
                rows: [
                    ['Keputusan', decision],
                    ['Faktor pembatas', limiting],
                    ['Latest pit setelah', core.latest + ' lap'],
                    ['Rekomendasi (−margin)', core.recommended + ' lap'],
                    ['Biaya pit', loss + ' lap-equivalent'],
                    ...(core.latest < 1 ? [['⚠', 'Tidak bisa menunggu 1 lap penuh']] : []),
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
                    // null / '' / boolean = BELUM dinilai, bukan 0 (terburuk) atau 1.
                    const v = Utils.numOrNull(it.ratings[k]);
                    if (v == null) { incomplete = true; continue; }
                    if (v < 0 || v > 10) {
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
            const numOrNull = Utils.numOrNull;
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
                    designPoints: numOrNull(p ? p.designPoints : null),
                    unbenchmarked: rows.filter(r => r.gap == null).length,
                },
            };
        },

        /**
         * Saran ganti parts/engine dari kondisi mobil (v0.9.4 Advisor).
         * Membaca kondisi yang MEMANG tampil di halaman + biaya tombol
         * Fix/Replace + stok gudang. Ambang eksplisit (bukan rumus game):
         *   ≤50% = ganti sekarang, 50–60% = siap-siap, >60% = tunda.
         * "enough" hanya dihitung bila biaya DAN stok terbaca; null = tidak
         * diketahui (jangan dikarang menjadi cukup/kurang).
         * @param {object} p {
         *   condition, engine, partCost, engineCost,
         *   partsStock, engineStock, restockRaces
         * }
         */
        repairAdvice(p) {
            const numOrNull = Utils.numOrNull;
            const src = p || {};
            const condition = numOrNull(src.condition);
            const engine = numOrNull(src.engine);
            if (condition == null && engine == null) {
                return { ok: false, error: 'Kondisi parts/engine belum terbaca' };
            }
            if (condition != null && (condition < 0 || condition > 100)) {
                return { ok: false, error: 'Kondisi parts harus 0–100' };
            }
            if (engine != null && (engine < 0 || engine > 100)) {
                return { ok: false, error: 'Kondisi engine harus 0–100' };
            }
            const partsStock = numOrNull(src.partsStock);
            const engineStock = numOrNull(src.engineStock);
            const partCost = numOrNull(src.partCost);
            const engineCost = numOrNull(src.engineCost);
            const restockRaces = numOrNull(src.restockRaces);
            const judge = (value, cost, stock) => {
                if (value == null) {
                    return { value: null, status: 'unknown', cost: cost, stock: stock, enough: null };
                }
                const status = (value <= 50) ? 'now' : (value <= 60) ? 'soon' : 'hold';
                const enough = (cost == null || stock == null) ? null : (stock >= cost);
                return { value: value, status: status, cost: cost, stock: stock, enough: enough };
            };
            return {
                ok: true,
                values: {
                    parts: judge(condition, partCost, partsStock),
                    engine: judge(engine, engineCost, engineStock),
                    partsStock: partsStock,
                    engineStock: engineStock,
                    restockRaces: restockRaces,
                    thresholds: { now: 50, soon: 60 },
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

        /**
         * Peringkat penawaran sponsor (v0.11.0) — dialog Sign Primary & Secondary.
         * Model eksplisit (bonus dibayar PER RACE saat objektif tercapai):
         *  - Secondary (income CASH): income dijamin tiap league race; bonus
         *    hanya bila objektif race itu tercapai. Peringkat = income
         *    (jaminan) tertinggi; bonus tunai tertinggi jadi alternatif amber
         *    (trade-off) + break-even peluang objektif. Tidak ada bonus yang
         *    dianggap sekali per kontrak.
         *  - Primary (income TOKEN): token dan cash BEDA SATUAN — tidak pernah
         *    dijumlahkan/dikonversi. Peringkat = token/race tertinggi (nilai
         *    utama), tie-break bonus tunai; bonus tunai terbaik jadi alternatif.
         *  - Total kontrak hanya ditampilkan bila term terbaca (income × term
         *    dan potensi maks (income + bonus) × term); term tak terbaca →
         *    total = null. Term dibaca dari kartu Primary sponsor di halaman.
         * @param {object} p { offers:[{eId,income,tokens,bonus}],
         *   termRaces:Number|null, incomeKind:'cash'|'token' }
         * @returns {{ok:Boolean, values?:{ranked:Array,incomeKind:String,
         *   bestEId:String|null,bestGuaranteeEId:String|null,
         *   bestBonusEId:String|null,bestPotentialEId:String|null,
         *   alternativeEId:String|null,breakEvenP:Number|null,
         *   termRaces:Number|null,unreadable:Number}, error?:String}}
         */
        rankSponsors(p) {
            const offers = (p && Array.isArray(p.offers)) ? p.offers : null;
            if (!offers || !offers.length) {
                return { ok: false, error: 'Penawaran sponsor tidak terbaca dari dialog' };
            }
            const termRaw = p && p.termRaces;
            const term = (termRaw != null && Number.isFinite(Number(termRaw)) && Number(termRaw) > 0)
                ? Math.floor(Number(termRaw)) : null;
            const incomeKind = (p && p.incomeKind === 'token') ? 'token' : 'cash';
            const tokenMode = incomeKind === 'token';
            const bonusVal = r => (r.bonus == null ? -Infinity : r.bonus);
            const rows = [];
            for (const o of offers) {
                if (!o) continue;
                const bonus = Utils.numOrNull(o.bonus);
                const eId = o.eId != null ? String(o.eId) : null;
                if (tokenMode) {
                    const tokens = Utils.numOrNull(o.tokens);
                    // 0/tak terbaca = penawaran tak bisa dinilai.
                    if (tokens == null || tokens <= 0) continue;
                    rows.push({
                        eId: eId,
                        tokens: tokens,
                        income: null,
                        bonus: bonus,
                        guaranteePerRace: null,
                        potentialPerRace: null,
                        guaranteeTotal: null,
                        potentialTotal: null, // token & cash tidak dicampur
                    });
                    continue;
                }
                const income = Utils.numOrNull(o.income);
                if (income == null || income <= 0) continue;
                const bonusCash = bonus == null ? 0 : bonus;
                rows.push({
                    eId: eId,
                    tokens: null,
                    income: income,
                    bonus: bonus,
                    guaranteePerRace: income,
                    potentialPerRace: income + bonusCash,
                    guaranteeTotal: term != null ? income * term : null,
                    potentialTotal: term != null ? (income + bonusCash) * term : null,
                });
            }
            if (!rows.length) {
                return {
                    ok: false,
                    error: tokenMode ? 'Income token sponsor tidak terbaca' : 'Income sponsor tidak terbaca',
                };
            }
            const byEId = (a, b) => String(a.eId).localeCompare(String(b.eId));
            if (tokenMode) {
                rows.sort((a, b) =>
                    (b.tokens - a.tokens) || (bonusVal(b) - bonusVal(a)) || byEId(a, b));
            } else {
                // Income = jaminan; potentialPerRace = bonus dianggap tercapai.
                rows.sort((a, b) =>
                    (b.income - a.income) ||
                    (b.potentialPerRace - a.potentialPerRace) ||
                    (bonusVal(b) - bonusVal(a)) ||
                    byEId(a, b));
            }
            const ranked = rows.map((r, i) => Object.assign({}, r, { rank: i + 1 }));
            const bestEId = ranked[0].eId;
            let bestBonus = null;
            let bestPotential = null;
            for (const r of ranked) {
                if (!bestBonus || bonusVal(r) > bonusVal(bestBonus)) bestBonus = r;
                if (!tokenMode && (!bestPotential || r.potentialPerRace > bestPotential.potentialPerRace)) {
                    bestPotential = r;
                }
            }
            const alternative = tokenMode
                ? (bestBonus && bestBonus.eId !== bestEId ? bestBonus.eId : null)
                : (bestPotential && bestPotential.eId !== bestEId ? bestPotential.eId : null);
            let breakEvenP = null;
            if (!tokenMode && alternative) {
                const best = ranked[0];
                const alt = ranked.find(r => r.eId === alternative);
                // Alt (income lebih rendah, bonus lebih tinggi) unggul bila
                // peluang objektif > (income_best - income_alt)/(bonus_alt - bonus_best).
                const dIncome = best.income - alt.income;
                const dBonus = bonusVal(alt) - bonusVal(best);
                if (dIncome > 0 && dBonus > 0) {
                    breakEvenP = Math.round((dIncome / dBonus) * 100) / 100;
                }
            }
            return {
                ok: true,
                values: {
                    ranked: ranked,
                    incomeKind: incomeKind,
                    bestEId: bestEId,
                    bestGuaranteeEId: tokenMode ? null : bestEId,
                    bestBonusEId: bestBonus ? bestBonus.eId : null,
                    bestPotentialEId: !tokenMode && bestPotential ? bestPotential.eId : null,
                    alternativeEId: alternative,
                    breakEvenP: breakEvenP,
                    termRaces: term,
                    unreadable: offers.length - rows.length,
                },
            };
        },

        /* ------------------------------------------------------------------
         * PERBANDINGAN KEPUTUSAN (v0.8.0) — "lebih bagus / lebih buruk /
         * sama" antara roster Anda dan pilihan di luar (bursa transfer,
         * supplier alternatif, max liga). Aturan disiplin:
         *  - verdict SELALU pada sumbu eksplisit (nilai atau biaya), dengan
         *    toleransi "≈ sama" yang dinyatakan;
         *  - sisi yang tidak punya angka → 'unknown'; tidak pernah mengarang
         *    nilai agar verdict bisa keluar;
         *  - pemanggil (Advisor/GUI) wajib memberi label
         *    "estimasi — bukan rumus game".
         * ------------------------------------------------------------------ */

        /**
         * Verdict satu angka (sisi Anda) vs satu angka pembanding pada satu sumbu.
         * @param {*} now nilai sisi Anda
         * @param {*} ref nilai sisi pembanding
         * @param {object} [opts] { lowerIsBetter:Boolean, tolerance:Number(rasio) }
         * @returns {{verdict:'better'|'worse'|'equal'|'unknown', delta:Number|null, pct:Number|null}}
         */
        numberVerdict(now, ref, opts) {
            const a = Utils.numOrNull(now);
            const b = Utils.numOrNull(ref);
            if (a == null || b == null) return { verdict: 'unknown', delta: null, pct: null };
            const lower = !!(opts && opts.lowerIsBetter);
            const tolRaw = opts ? Number(opts.tolerance) : NaN;
            const tol = (Number.isFinite(tolRaw) && tolRaw >= 0) ? tolRaw : 0.02;
            const delta = Math.round((a - b) * 100) / 100;
            const base = Math.abs(b);
            const pct = base > 0 ? Math.round(((a - b) / base) * 1000) / 10 : null;
            const equal = (base === 0) ? (delta === 0) : (Math.abs(a - b) / base <= tol);
            if (equal) return { verdict: 'equal', delta: delta, pct: pct };
            const better = lower ? (a < b) : (a > b);
            return { verdict: better ? 'better' : 'worse', delta: delta, pct: pct };
        },

        /**
         * Bandingkan roster aktif vs daftar dari luar pada role yang sama.
         * Dua sumbu, selalu dilaporkan terpisah apa adanya:
         *  - rating (naik = lebih bagus) → pembanding = rating TERTINGGI di daftar luar;
         *  - biaya/balapan (turun = lebih bagus) → pembanding = biaya TERENDAH di daftar luar.
         * Verdict akhir memakai sumbu rating bila KEDUA sisi punya rating; selainnya
         * sumbu biaya; selainnya 'unknown'. Karena itu keterisian rating ikut
         * dilaporkan (ratingKnown/ratingUnknown) supaya UI bisa jujur soal sebabnya.
         * @param {object} p {
         *   current:[{key,name,role,rating,costPerRace}],
         *   market :[{key,name,role,rating,costPerRace}],
         *   ratingLabel, costLabel, tolerance
         * }
         */
        compareRoster(p) {
            const cur = (p && Array.isArray(p.current)) ? p.current : null;
            const mkt = (p && Array.isArray(p.market)) ? p.market : null;
            if (!cur || !cur.length) {
                return { ok: false, error: 'Roster aktif belum terbaca (butuh halaman Drivers & Staff)' };
            }
            if (!mkt || !mkt.length) {
                return { ok: false, error: 'Daftar pasar belum terbaca (butuh halaman Transfers)' };
            }
            const ratingLabel = (p && p.ratingLabel) || 'rating';
            const costLabel = (p && p.costLabel) || 'biaya/balapan';
            const tol = p && p.tolerance;
            const rows = [];
            const counts = { better: 0, worse: 0, equal: 0, unknown: 0 };
            let ratingKnown = 0;
            let ratingUnknown = 0;
            for (const c of cur) {
                if (!c) continue;
                // Peran dinormalisasi (label "Chief Designer" vs kode "CD") agar
                // roster halaman Teams bisa dibandingkan dengan pasar Transfers.
                const role = Utils.roleCode(c.role);
                // Peran tak terbaca tidak boleh dibandingkan lintas peran
                // (mekanik vs driver menghasilkan verdict palsu).
                const peers = (role == null) ? []
                    : mkt.filter(m => m && Utils.roleCode(m.role) === role);
                const byRating = peers.filter(m => Utils.numOrNull(m.rating) != null)
                    .sort((x, y) => Utils.numOrNull(y.rating) - Utils.numOrNull(x.rating));
                const byCost = peers.filter(m => Utils.numOrNull(m.costPerRace) != null)
                    .sort((x, y) => Utils.numOrNull(x.costPerRace) - Utils.numOrNull(y.costPerRace));
                const refRating = byRating.length ? byRating[0] : null;
                const refCost = byCost.length ? byCost[0] : null;
                const byFee = peers.filter(m => Utils.numOrNull(m.fee) != null)
                    .sort((x, y) => Utils.numOrNull(x.fee) - Utils.numOrNull(y.fee));
                const refFee = byFee.length ? byFee[0] : null;
                const vRating = IGPCore.numberVerdict(c.rating, refRating ? refRating.rating : null, { tolerance: tol });
                const vCost = IGPCore.numberVerdict(c.costPerRace, refCost ? refCost.costPerRace : null, { lowerIsBetter: true, tolerance: tol });
                if (vRating.verdict === 'unknown') ratingUnknown += 1; else ratingKnown += 1;
                const basis = (vRating.verdict !== 'unknown') ? 'rating'
                    : (vCost.verdict !== 'unknown') ? 'biaya' : 'tidak ada';
                const verdict = (basis === 'rating') ? vRating.verdict
                    : (basis === 'biaya') ? vCost.verdict : 'unknown';
                counts[verdict] += 1;
                rows.push({
                    key: (c.key != null) ? c.key : (c.name != null ? c.name : null),
                    name: c.name || '?',
                    role: role,
                    rating: Object.assign({ now: Utils.numOrNull(c.rating) }, vRating),
                    cost: Object.assign({ now: Utils.numOrNull(c.costPerRace) }, vCost),
                    basis: basis,
                    verdict: verdict,
                    refRating: refRating ? { name: refRating.name, value: Utils.numOrNull(refRating.rating) } : null,
                    refCost: refCost ? { name: refCost.name, value: Utils.numOrNull(refCost.costPerRace) } : null,
                    // Info saja (tanpa verdict): fee tanda tangan termurah di pasar —
                    // biaya sekali bayar, tidak sebanding dengan gaji per balapan.
                    refFee: refFee ? { name: refFee.name, value: Utils.numOrNull(refFee.fee) } : null,
                    refName: (basis === 'rating' && refRating) ? refRating.name
                        : (basis === 'biaya' && refCost) ? refCost.name : null,
                });
            }
            if (!rows.length) return { ok: false, error: 'Roster aktif kosong' };
            return {
                ok: true,
                values: {
                    rows: rows,
                    counts: counts,
                    ratingKnown: ratingKnown,
                    ratingUnknown: ratingUnknown,
                    marketCount: mkt.length,
                    ratingLabel: ratingLabel,
                    costLabel: costLabel,
                },
                rows: rows.map(r => [r.name, r.verdict]),
            };
        },

        /**
         * Bandingkan supplier AKTIF dengan alternatif di dialog Supply yang sama
         * (satu halaman, satu snapshot) — bukan pasar luar. Dua sumbu: Σ bonus
         * (naik = lebih bagus) dan biaya/balapan (turun = lebih bagus). Konvensi
         * Σ bonus sama dengan rankSuppliers: stat berbeda TIDAK disetarakan
         * rumus game — ini perbandingan, bukan kepastian performa.
         * @param {object} p { current:{id,costPerRace,bonuses}, alternatives:[...], tolerance }
         */
        compareSuppliers(p) {
            const cur = (p && p.current) ? p.current : null;
            const alts = (p && Array.isArray(p.alternatives)) ? p.alternatives : null;
            if (!cur) return { ok: false, error: 'Supplier aktif tidak terbaca dari dialog' };
            if (!alts || !alts.length) return { ok: false, error: 'Alternatif supplier tidak tampil di dialog ini' };
            const bonusSum = x => {
                if (!x || !Array.isArray(x.bonuses) || x.bonuses.length === 0) return null;
                return x.bonuses.reduce((s, b) => s + (b && Number.isFinite(Number(b.value)) ? Number(b.value) : 0), 0);
            };
            const curBonus = bonusSum(cur);
            const curCost = Utils.numOrNull(cur.costPerRace);
            let refBonus = null;
            let refCost = null;
            for (const a of alts) {
                const bv = bonusSum(a);
                if (bv != null && (refBonus == null || bv > refBonus.value)) {
                    refBonus = { value: bv, id: a.supplierId, eId: a.eId };
                }
                const cv = Utils.numOrNull(a.costPerRace);
                if (cv != null && (refCost == null || cv < refCost.value)) {
                    refCost = { value: cv, id: a.supplierId, eId: a.eId };
                }
            }
            const vBonus = IGPCore.numberVerdict(curBonus, refBonus ? refBonus.value : null, { tolerance: p && p.tolerance });
            const vCost = IGPCore.numberVerdict(curCost, refCost ? refCost.value : null, { lowerIsBetter: true, tolerance: p && p.tolerance });
            const basis = (vBonus.verdict !== 'unknown') ? 'bonus'
                : (vCost.verdict !== 'unknown') ? 'biaya' : 'tidak ada';
            const verdict = (basis === 'bonus') ? vBonus.verdict
                : (basis === 'biaya') ? vCost.verdict : 'unknown';
            return {
                ok: true,
                values: {
                    current: { bonus: curBonus, cost: curCost },
                    bestBonus: refBonus,
                    cheapest: refCost,
                    bonus: vBonus,
                    cost: vCost,
                    basis: basis,
                    verdict: verdict,
                },
            };
        },

        /**
         * Baca trait dari teks `data-append` (v0.7.2, halaman Transfers).
         * Robust: coba DOM parse dulu (kutip tunggal/ganda), fallback regex.
         * Output: { boost, weaken, special } — label murni; 'None' dibuang.
         *  - block-green  = spesialisasi penguat atribut (tooltip game)
         *  - block-red    = kelemahan terkait (tooltip game)
         *  - specialA*    = special ability driver
         */
        parseTraits(html) {
            const s = String(html == null ? '' : html);
            if (typeof DOMParser !== 'undefined' || (typeof document !== 'undefined' && document.createElement)) {
                try {
                    const holder = (typeof document !== 'undefined' && document.createElement)
                        ? document.createElement('div') : null;
                    if (holder) {
                        holder.innerHTML = s;
                        // Ikon game ditulis sebagai <icon>igp-tyre</icon> lalu labelnya —
                        // ikon dibuang agar yang tersisa hanya label statistik.
                        const textOf = el => {
                            const c = el.cloneNode(true);
                            for (const ic of c.querySelectorAll('icon')) ic.remove();
                            return Utils.clean(c.textContent || '');
                        };
                        const byClass = cls => Array.from(holder.querySelectorAll('.' + cls))
                            .map(textOf).filter(Boolean);
                        const specials = Array.from(holder.querySelectorAll('[class*="specialA"]'))
                            .map(textOf)
                            .filter(t => t && t.toLowerCase() !== 'none');
                        const hasDomHit = byClass('block-green').length || byClass('block-red').length || specials.length;
                        if (hasDomHit || holder.querySelector('[class*="block-"],[class*="specialA"]')) {
                            return { boost: byClass('block-green'), weaken: byClass('block-red'), special: specials };
                        }
                    }
                } catch { /* fallback regex */ }
            }
            const grab = pattern => {
                const out = [];
                const re = new RegExp(pattern, 'gi');
                let m;
                while ((m = re.exec(s)) !== null) {
                    const t = Utils.clean(m[1] || '');
                    if (t) out.push(t);
                }
                return out;
            };
            return {
                boost: grab('class=[\'"][^\'"]*block-green[^\'"]*[\'"][^>]*>(?:<icon>[^<]*</icon>)?([^<]+)'),
                weaken: grab('class=[\'"][^\'"]*block-red[^\'"]*[\'"][^>]*>(?:<icon>[^<]*</icon>)?([^<]+)'),
                special: grab('class=[\'"][^\'"]*specialA\\d*[^\'"]*[\'"][^>]*>([^<]+)')
                    .filter(x => x.toLowerCase() !== 'none'),
            };
        },
    });

    // helper kecil (di luar freeze agar statis):

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
                // Label tulisan advisor (data-igpas-orig) dikembalikan ke aslinya:
                // snapshot menyimpan data game murni, bukan hasil tampilan.
                const saved = row.getAttribute('data-igpas-orig');
                attrs[key] = {
                    label: (saved != null ? saved : txt(row, '.attribute-rating-header span:not(.ratingVal)')),
                    // Tanpa .ratingVal (render parsial / pra-musim) = null,
                    // BUKAN 0: 0 akan jadi "gap terbesar" dan prioritas DP #1.
                    val: Utils.numOrNull(txt(row, '.ratingVal')),
                };
            }
            if (!Object.keys(attrs).length) return null;
            const dpEl = doc.querySelector('#carsDesignPoints');
            const host = doc.querySelector('#carAttributes');
            let best = {};
            try { best = JSON.parse(txt(doc, '#leagueDesignData') || '{}') || {}; } catch { best = {}; }
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
                dmax: host ? Utils.numOrNull(host.getAttribute('data-dmax')) : null,
                designPoints: dpEl ? Utils.numOrNull(dpEl.getAttribute('data-dp')) : null,
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
            // Judul asli disimpan advisor di data-igpas-orig; gate harus membaca
            // teks game, bukan teks anotasi ("Engine supply · bonus kalah, …").
            const h2txt = h2 ? (h2.getAttribute('data-igpas-orig') || h2.textContent) : '';
            const tm = h2txt.match(/^\s*(engine|fuel|tyre)s?\s+supply\s*$/i);
            if (!tm) return null;
            const type = tm[1].toLowerCase();

            const money = Utils.parseMoney;
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
                // [] = bonus BELUM dirender (supplier belum di-scout / lazy),
                // bukan "total bonus 0" — 0 akan memenangkan verdict "lebih baik".
                return out.length ? out : null;
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
                // Teks biaya tulisan advisor (data-igpas-orig) dikembalikan ke aslinya:
                // snapshot menyimpan data game murni, bukan hasil tampilan.
                const savedCost = btn.getAttribute('data-igpas-orig');
                alternatives.push({
                    eId: parseInt(eId, 10),
                    supplierId: sid(card ? card.querySelector('img[src*="/supply/"]') : null),
                    costPerRace: money(savedCost != null ? savedCost : btn.textContent),
                    bonuses: card ? bonusesIn(card) : [],
                });
            }

            return {
                type,
                current: {
                    supplierId: sid(sub ? sub.querySelector('img[src*="/supply/"]') : null),
                    costPerRace: costMatch ? money(costMatch[1]) : null,
                    bonuses: sub ? bonusesIn(sub) : null, // null = tidak terbaca, bukan 0
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

            const money = Utils.parseMoney;
            const clean = s => String(s || '').replace(/\s+/g, ' ').trim(); // nama punya spasi nyasar di DOM
            // Nama manufacturer bisa terpecah antar-node (teks + <span> di dalam
            // <a>): textContent mentah menempelkan "Aero"+"Dynamics" jadi
            // "AeroDynamics". Gabungkan dengan spasi di batas elemen.
            const textOf = el => {
                if (!el) return '';
                const walk = node => {
                    if (!node) return '';
                    if (node.nodeType === 3) return node.textContent;
                    if (node.nodeType !== 1) return '';
                    if (String(node.tagName || '').toUpperCase() === 'BR') return ' ';
                    return Array.from(node.childNodes || []).map(walk).join(' ');
                };
                return clean(walk(el));
            };
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
                    const rm = tip ? (tip.getAttribute('data-tip') || '').match(/^Rating:\s*(\d+)\s*%\s*$/i) : null;
                    // Nama tulisan advisor (data-igpas-orig) dikembalikan ke aslinya:
                    // snapshot menyimpan data game murni, bukan hasil tampilan.
                    const savedName = tr.getAttribute('data-igpas-orig');
                    const row = {
                        id: idm ? parseInt(idm[1], 10) : null,
                        name: (savedName != null ? savedName : textOf(tds[0])), // teks saja — <a> kosong + <img> flag tidak menghasilkan teks
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
     * Adapter halaman Drivers & Staff (v0.7.2) — read-only. Dipetakan dari
     * capture live DOM (fixture test/fixtures/staff.html). Gate: #pageId =
     * 'staff'. Membaca: driver aktif (nama, ability/mental %, health bar +
     * estimasi pemulihan, kontrak, gaji), kartu staff aktif (peran, gaji,
     * kontrak), status pit crew (terkunci bila ada tooltip), jumlah reserve.
     * KARTU staff aktif TIDAK memuat angka rating (bintang saja, relatif
     * level) — adapter tidak pernah mengarang angka itu.
     */
    const IgpStaffAdapter = {
        id: 'staff-data',
        desc: 'halaman Drivers & Staff: driver aktif + staff + pit crew',
        captures(doc) {
            const pid = doc.getElementById('pageId');
            if (!pid || pid.value !== 'staff') return null;
            const drvBlock = doc.getElementById('drivers');
            const staffGrid = doc.getElementById('staff');
            if (!drvBlock && !staffGrid) return null;
            const money = Utils.parseMoney;
            const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
            const intOf = t => {
                const n = parseInt(String(t || '').replace(/[^\d-]/g, ''), 10);
                return Number.isFinite(n) ? n : null;
            };
            const salaryOf = card => {
                // Gaji = angka tepat setelah ikon cash; card.textContent bisa
                // menangkap digit dari nama/role lebih dulu.
                const cash = card.querySelector('img[src*="cash"]');
                if (cash) {
                    let nd = cash.nextSibling;
                    while (nd && nd.nodeType !== 3) nd = nd.nextSibling;
                    const v = nd ? money(nd.textContent) : null;
                    if (v != null) return v;
                }
                return money(card.textContent);
            };
            const nameOf = el => {
                if (!el) return null;
                // Nama asli dari advisor (data-igpas-orig) — snapshot = data game.
                const direct = el.getAttribute('data-igpas-orig');
                if (direct != null) return clean(direct);
                const c = el.cloneNode(true);
                for (const m of c.querySelectorAll('[data-igpas-orig]')) {
                    m.textContent = m.getAttribute('data-igpas-orig');
                }
                const brs = c.querySelectorAll('br');
                for (const b of brs) b.replaceWith(doc.createTextNode(' '));
                return clean(c.textContent);
            };

            const cols = [null, null]; // kolom driver 1 & 2 pada tabel statistik
            const cell = i => (cols[i] = cols[i] || {});
            const tbl = doc.getElementById('driverStatsTable');
            if (tbl) {
                for (const tr of tbl.querySelectorAll('tbody tr')) {
                    const th = tr.querySelector('th');
                    const label = clean(th ? th.textContent : '');
                    const tds = tr.querySelectorAll('td');
                    if (label === 'Ability' || label === 'Mental') {
                        for (let i = 0; i < tds.length && i < 2; i++) cell(i)[label.toLowerCase()] = intOf(tds[i].textContent);
                    } else if (label === 'Contract') {
                        for (let i = 0; i < tds.length && i < 2; i++) cell(i).contract = clean(tds[i].textContent);
                    } else if (label === 'Salary') {
                        for (let i = 0; i < tds.length && i < 2; i++) cell(i).salaryPerRace = money(tds[i].textContent);
                    }
                    // baris health: tanpa label — kenali dari training preview
                    const vals = tr.querySelectorAll('.trainingPreviewValue');
                    if (vals.length) {
                        vals.forEach((v, i) => {
                            if (i < 2) {
                                cell(i).health = intOf(v.getAttribute('data-val'));
                                const rec = tds[i] ? tds[i].querySelector('.staffHealthRecovery') : null;
                                const rate = tds[i] ? tds[i].querySelector('.trainingPreviewRate') : null;
                                // `data-recovery-rate` = angka game penuh (6.615);
                                // teks "+6" hanya fallback dan TIDAK boleh lewat intOf
                                // (intOf membuang titik → 6.6 jadi 66).
                                const rv = rec ? Utils.numOrNull(rec.getAttribute('data-recovery-rate')) : null;
                                if (rv != null) cell(i).recoveryPerHour = rv;
                                else if (rate) cell(i).recoveryPerHour = Utils.numOrNull(rate.textContent);
                            }
                        });
                    }
                    const hovers = tr.querySelectorAll('.hoverData[data-driver]');
                    hovers.forEach((sp, i) => {
                        if (i < 2) {
                            const csv = sp.getAttribute('data-driver');
                            cell(i).raw = csv;
                            // Indeks 12-stat dari CSV — dipakai perbandingan vs pasar
                            // (satu bentuk angka yang sama di kedua sisi).
                            cell(i).statIndex = Utils.statIndex(csv);
                        }
                    });
                }
            }

            const pics = ['d1Pic', 'd2Pic'].map(pId => doc.getElementById(pId));
            const drivers = pics.map((pic, i) => {
                const nm = pic ? pic.querySelector('.driverName') : null;
                const a = pic ? pic.querySelector('a[href*="id="]') : null;
                const idm = a ? (a.getAttribute('href') || '').match(/id=(\d+)/) : null;
                return Object.assign(
                    { id: idm ? parseInt(idm[1], 10) : null, name: nameOf(nm) },
                    cols[i] || {}
                );
            });

            const staffCards = [];
            if (staffGrid) {
                for (const card of staffGrid.querySelectorAll('.c-wrap')) {
                    const roleEl = card.querySelector('.c-head');
                    const link = card.querySelector('a[href*="id="]');
                    const idm = link ? (link.getAttribute('href') || '').match(/id=(\d+)/) : null;
                    staffCards.push({
                        id: idm ? parseInt(idm[1], 10) : null,
                        role: clean(roleEl ? roleEl.textContent : ''),
                        name: nameOf(card.querySelector('.driverName')),
                        salaryPerRace: salaryOf(card),
                        contract: clean((card.querySelector('span[id^="nStaffC"]') || {}).textContent),
                    });
                }
            }

            const pc = doc.querySelector('.pc-main-div');
            const pitLocked = pc ? (clean(pc.getAttribute('data-tip') || '') || null) : null;
            const reserveTable = doc.getElementById('reserveStaff');

            return {
                drivers: drivers,
                staffCards: staffCards,
                pitLocked: pitLocked,
                reserveCount: reserveTable ? reserveTable.querySelectorAll('tbody tr').length : null,
            };
        },
    };

    /**
     * Adapter pasar Transfers (v0.7.2) — read-only. Dipetakan dari capture
     * live DOM (fixture test/fixtures/transfers.html). Gate: #pageId =
     * 'transfers'. KEDUA tabel (driver + staff) selalu ada di DOM; tab aktif
     * hanya display. Angka keseluruhan diambil dari atribut data-* yang
     * memang ada di halaman (data-overall, data-sort fee/wage/age/role, CSV
     * data-driver / data-staff, trait pada data-append) — tanpa angka fiktif.
     * Daftar pasar bisa berubah sendiri (refresh lelang) — panel diberi catatan.
     */
    const IgpTransfersAdapter = {
        id: 'transfers-data',
        desc: 'pasar Transfers: driver & staff (rating/fee/wage/trait)',
        captures(doc) {
            const pid = doc.getElementById('pageId');
            if (!pid || pid.value !== 'transfers') return null;
            const dT = doc.getElementById('driver-table');
            const sT = doc.getElementById('staff-table');
            if (!dT && !sT) return null;
            const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
            const sortNum = td => {
                const v = td ? Number(td.getAttribute('data-sort')) : NaN;
                return Number.isFinite(v) ? v : null;
            };
            const parseTable = (tid, isStaff) => {
                const t = doc.getElementById(tid);
                const out = [];
                if (!t) return out;
                for (const tr of t.querySelectorAll('tbody tr')) {
                    const tds = tr.querySelectorAll('td');
                    if (tds.length < 4) continue;
                    const idm = String(tr.id || '').match(/_(\d+)$/);
                    const hover = tr.querySelector('.hoverData');
                    const csv = hover ? (hover.getAttribute(isStaff ? 'data-staff' : 'data-driver') || '') : '';
                    const row = {
                        id: idm ? parseInt(idm[1], 10) : null,
                        name: tr.getAttribute('data-name') || clean(tds[0].textContent),
                        overall: (v => (v != null && Number.isFinite(Number(v)) ? Number(v) : null))(tr.getAttribute('data-overall')),
                        statIndex: Utils.statIndex(csv),
                        traitsHtml: hover ? (hover.getAttribute('data-append') || '') : '',
                        fee: sortNum(tds[3]),
                        wage: sortNum(tds[4]),
                    };
                    if (isStaff) row.role = clean(tds[1].textContent);
                    else row.age = sortNum(tds[1]);
                    out.push(row);
                }
                return out;
            };
            const cd = doc.getElementById('cdTransfersRefresh');
            return {
                drivers: parseTable('driver-table', false),
                staff: parseTable('staff-table', true),
                refreshIn: cd ? clean(cd.textContent) : null,
            };
        },
    };

    /**
     * Adapter dialog sponsor (Primary/Secondary) — read-only, dipetakan dari
     * capture live DOM. Gate: #sponsorSignTable ada (dialog Sign terbuka);
     * tidak pernah membuka dialog, klik, atau submit. Term kontrak per
     * penawaran TIDAK ditampilkan game (baris "Contract term" dikomentari),
     * jadi term dibaca dari kartu Primary sponsor di halaman di belakang
     * dialog — asumsi eksplisit, bukan rumus game.
     */
    const IgpSponsorAdapter = {
        id: 'sponsor-data',
        desc: 'dialog sponsor: income per league race + bonus objektif',
        captures(doc) {
            const table = doc.getElementById('sponsorSignTable');
            if (!table) return null; // gate: hanya saat dialog sponsor terbuka
            const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
            const rows = Array.from(table.querySelectorAll('tr'));
            const rowOf = label => rows.find(tr => {
                const th = tr.querySelector('th');
                return th && clean(th.textContent).toLowerCase().indexOf(label) === 0;
            });
            const incomeRow = rowOf('income');
            const bonusRow = rowOf('bonus');
            const signRow = rows.find(tr => tr.querySelector('a[data-tip*="eId="]'));
            if (!incomeRow || !bonusRow || !signRow) return null;
            const incomeCells = Array.from(incomeRow.querySelectorAll('td'));
            const bonusCells = Array.from(bonusRow.querySelectorAll('td'));
            // Satuan income: token (Primary sponsor) vs cash (Secondary).
            // Token dan cash tidak boleh dicampur; kind dideteksi dari ikon.
            const isTokenCell = c => !!(c && c.querySelector('img[src*="token"], .token-icon, .token-cost'));
            const incomeKind = incomeCells.some(isTokenCell) ? 'token' : 'cash';
            const amountOf = cell => {
                if (!cell) return null;
                const m = clean(cell.textContent).match(/(\d+(?:\.\d+)?)/);
                return m ? parseFloat(m[1]) : null;
            };
            const offers = [];
            Array.from(signRow.querySelectorAll('td')).forEach((td, i) => {
                const a = td.querySelector('a[data-tip*="eId="]');
                if (!a) return;
                const eId = (String(a.getAttribute('data-tip') || '').match(/eId=(\d+)/) || [])[1];
                if (!eId) return;
                const moneyOf = cell => (cell ? Utils.parseMoney(clean(cell.textContent)) : null);
                offers.push({
                    eId: parseInt(eId, 10),
                    tokens: incomeKind === 'token' ? amountOf(incomeCells[i]) : null,
                    income: incomeKind === 'cash' ? moneyOf(incomeCells[i]) : null,
                    bonus: moneyOf(bonusCells[i]),
                });
            });
            if (!offers.length) return null;
            // Term kontrak: kartu Primary sponsor di #page-content (di belakang modal).
            let termRaces = null;
            for (const card of doc.querySelectorAll('#page-content .c-wrap')) {
                const head = card.querySelector('.font-heading');
                if (!head || !/primary\s+sponsor/i.test(clean(head.textContent))) continue;
                const m = clean(card.textContent).match(/(\d+)\s*race(?:\(s\)|s)?/i);
                if (m) termRaces = parseInt(m[1], 10);
                break;
            }
            return { termRaces: termRaces, incomeKind: incomeKind, offers: offers };
        },
    };

    /**
     * Registry adapter data. Status dipublikasikan apa adanya: ':ready' = adapter
     * read-only terpasang; ':menunggu-map' = pemetaan DOM halaman belum dilakukan.
     */
    /* =====================================================================
     * 3b) ADVISOR IN-PAGE (v0.7.0) — rekomendasi read-only di halaman STUDI iGP.
     *  - IN-PLACE: tidak menambah elemen apa pun. Tulisan hanya teks pada node
     *    game yang sudah ada, atribut title elemen yang sama, dan style
     *    sementara (warna tombol). Tidak mengklik, tidak submit, tidak
     *    fetch/XHR, tidak mengirim packet mailbox apa pun.
     *  - Aktif di #pageId 'cars' (termasuk dialog Supply terbuka),
     *    'manufacturers', 'staff', 'transfers', dan dialog sponsor
     *    (#sponsorSignTable — biasanya di halaman Finances). Halaman 'race'
     *    (Setup, Strategy, maupun Race live) TIDAK mendapat UI/tulisan apa
     *    pun; tanpa klik/submit elemen game, di mana pun.
     *  - Re-render dipicu aksi user (klik/navigasi) — BUKAN polling DOM.
     *  - Semua angka = pembacaan DOM yang memang tampil + heuristik eksplisit
     *    IGPCore, berlabel "estimasi — bukan rumus game".
     * ===================================================================== */
    const Advisor = (() => {
        const PREFIX = 'igpas-adv';
        const fmtMoney = Utils.fmtMoney; // satu format uang untuk seluruh advisor
        const pageId = () => {
            const el = document.getElementById('pageId');
            return el ? String(el.value || '').trim() : null;
        };

        function removeIfAny(ids) {
            for (const id of ids) {
                const el = document.getElementById(id);
                if (el) el.remove();
            }
        }

        /* Halaman Cars: prioritas alokasi design points vs benchmark liga.
         * IN-PLACE PENUH (tanpa elemen baru): label ASLI tiap baris ditulis
         * ulang jadi "#n Label · X DP" dan baris diurutkan #1, #2, ... dari
         * atas ke bawah. Detail val/max/gap + label estimasi di atribut title
         * baris yang sama. Angka & bar game tidak disentuh. Urutan/teks asli
         * disimpan dan dikembalikan oleh restoreDesign(); captures selalu
         * berjalan setelah restore sehingga adapter tidak pernah membaca hasil
         * tulisan. */
        function applyInlineStyle(el, props) {
            if (!el.hasAttribute('data-igpas-orig-style')) {
                el.setAttribute('data-igpas-orig-style', el.getAttribute('style') || '');
            }
            for (const prop of Object.keys(props)) {
                el.style.setProperty(prop, props[prop], 'important');
            }
            el.setAttribute('data-igpas-written-style', el.getAttribute('style') || '');
        }
        function restoreInlineStyle(el) {
            const saved = el.getAttribute('data-igpas-orig-style');
            if (saved == null) return;
            const written = el.getAttribute('data-igpas-written-style');
            const current = el.getAttribute('style') || '';
            if (written == null || current === written) {
                if (saved === '') el.removeAttribute('style');
                else el.setAttribute('style', saved);
            }
            el.removeAttribute('data-igpas-orig-style');
            el.removeAttribute('data-igpas-written-style');
        }
        function restoreDesign() {
            const display = document.getElementById('carAttributesDisplay');
            const rows = display ? display.querySelectorAll('.attribute-row') : [];
            for (const row of rows) {
                try {
                    const orig = row.getAttribute('data-igpas-orig');
                    if (orig != null) {
                        const label = row.querySelector('.attribute-rating-header span:not(.ratingVal)');
                        const written = row.getAttribute('data-igpas-written');
                        // Jangan menimpa label yang sudah diganti game setelah tulisan advisor.
                        if (label && (written == null || label.textContent === written)) {
                            label.textContent = orig;
                        }
                    }
                    const savedTitle = row.getAttribute('data-igpas-title');
                    if (savedTitle != null) {
                        const writtenTitle = row.getAttribute('data-igpas-written-title');
                        if (writtenTitle == null || row.getAttribute('title') === writtenTitle) {
                            if (savedTitle === '') row.removeAttribute('title');
                            else row.setAttribute('title', savedTitle);
                        }
                    }
                    if (row.hasAttribute('data-igpas-orig-style') || row.hasAttribute('data-igpas-written-style')) {
                        restoreInlineStyle(row);
                    }
                } catch { /* jangan pernah merusak halaman game */ }
                row.removeAttribute('data-igpas-orig');
                row.removeAttribute('data-igpas-written');
                row.removeAttribute('data-igpas-title');
                row.removeAttribute('data-igpas-written-title');
            }
            // Kembalikan urutan baris ke urutan asli game.
            if (display) {
                const marked = Array.from(display.children).filter(el =>
                    el && el.classList && el.classList.contains('attribute-row') &&
                    el.hasAttribute('data-igpas-orig-order'));
                if (marked.length) {
                    marked.sort((a, b) => Number(a.getAttribute('data-igpas-orig-order')) -
                        Number(b.getAttribute('data-igpas-orig-order')));
                    for (const row of marked) {
                        display.appendChild(row);
                        row.removeAttribute('data-igpas-orig-order');
                    }
                }
            }
            // Sisa migrasi versi badge/panel: bersihkan tanpa menyentuh node game.
            for (const el of document.querySelectorAll('.igpas-adv-inline, .igpas-adv-inline-head')) el.remove();
            removeIfAny([PREFIX + '-design']);
        }
        function mountDesign() {
            const anchor = (pageId() === 'cars') ? document.getElementById('carAttributesDisplay') : null;
            if (!anchor) { restoreDesign(); return; }
            restoreDesign(); // teks/urutan asli kembali dulu agar captures baca data murni
            const data = IgpCarsAdapter.captures(document);
            const res = IGPCore.designPriority({
                attrs: data && data.attrs,
                best: data && data.best,
                designPoints: data && data.designPoints,
            });
            // Gagal jujur: tanpa angka, tanpa modifikasi apa pun (tanpa panel).
            if (!res.ok) return;
            const dpTotal = res.values.designPoints;
            const ranked = res.values.ranked;
            const rows = Array.from(anchor.children).filter(el =>
                el && el.classList && el.classList.contains('attribute-row'));
            if (!rows.length) return;
            const byKey = new Map();
            rows.forEach((row, i) => {
                if (!row.hasAttribute('data-igpas-orig-order')) {
                    row.setAttribute('data-igpas-orig-order', String(i));
                }
                if (row.id && row.id.indexOf('wrap-') === 0) byKey.set(row.id.slice(5), row);
            });
            // Urutkan #1..#n sesuai rank; baris tak terbaca tetap di belakang.
            const ordered = [];
            for (const r of ranked) {
                const row = r && r.key != null ? byKey.get(String(r.key)) : null;
                if (row && ordered.indexOf(row) === -1) ordered.push(row);
            }
            for (const row of rows) if (ordered.indexOf(row) === -1) ordered.push(row);
            for (const row of ordered) anchor.appendChild(row);
            ranked.forEach((r, i) => {
                if (r.key == null || !/^[A-Za-z0-9_-]+$/.test(String(r.key))) return;
                let row = null;
                try { row = document.getElementById('wrap-' + r.key); } catch { row = null; }
                if (!row) return;
                const label = row.querySelector('.attribute-rating-header span:not(.ratingVal)');
                if (!label) return;
                const orig = label.textContent;
                const share = (r.sharePct != null ? r.sharePct : 0);
                const dpEst = (dpTotal != null) ? Math.round(dpTotal * share / 100) : null;
                row.setAttribute('data-igpas-orig', orig);
                row.setAttribute('data-igpas-title',
                    row.hasAttribute('title') ? row.getAttribute('title') : '');
                const newLabel = '#' + (i + 1) + ' ' + orig + (dpEst != null ? ' · ' + dpEst + ' DP' : '');
                label.textContent = newLabel;
                row.setAttribute('data-igpas-written', newLabel);
                const advisorTitle = 'Prioritas #' + (i + 1) + ' — ' + (r.label || orig) + ': ' + r.val +
                    ' → max liga ' + (r.max == null ? '—' : r.max) +
                    ' (gap ' + (r.gap == null ? '—' : r.gap) + '). ' +
                    'Usulan ' + (dpEst != null ? '±' + dpEst + ' DP dari ' + dpTotal + ' DP' : share + '% porsi gap') +
                    ' — estimasi, bukan rumus game.';
                row.setAttribute('title', advisorTitle);
                row.setAttribute('data-igpas-written-title', advisorTitle);
            });
        }

        /* Halaman Cars tab Repair: saran FIX parts / REPLACE engine.
         * IN-PLACE PENUH (tanpa elemen baru): tombol game diwarnai sesuai
         * kondisi — merah ≤50% (ganti sekarang), amber 50–60% (siap-siap),
         * abu-abu >60% (tunda). Judul kartu TIDAK ditulisi; detail biaya/stok/
         * ambang tetap di title tombol + lingkaran kondisi. Style/title asli
         * disimpan dan dikembalikan oleh restoreRepair(); tombol tidak pernah
         * diklik/di-submit. */
        const REPAIR_BUTTON_COLORS = {
            now: { bg: '#c0392b', fg: '#ffffff' },
            soon: { bg: '#d68910', fg: '#1b2631' },
            hold: { bg: '#5d6d7e', fg: '#ffffff' },
        };
        function restoreRepair() {
            const repair = document.getElementById('repair');
            if (!repair) return;
            for (const el of repair.querySelectorAll('[data-igpas-orig]')) {
                try { restoreMarkedText(el); } catch { /* jangan pernah merusak halaman game */ }
                el.removeAttribute('data-igpas-orig');
                el.removeAttribute('data-igpas-origmode');
                el.removeAttribute('data-igpas-written');
            }
            for (const el of repair.querySelectorAll('[data-igpas-title], [data-igpas-written-title]')) {
                try { restoreTitle(el); } catch { /* abaikan */ }
            }
            for (const el of repair.querySelectorAll('[data-igpas-orig-style], [data-igpas-written-style]')) {
                try { restoreInlineStyle(el); } catch { /* abaikan */ }
            }
        }
        function repairVerdictText(part, kind) {
            const status = part ? part.status : 'unknown';
            if (status === 'unknown') return 'kondisi tidak terbaca';
            if (kind === 'parts') {
                if (status === 'now') return 'fix sekarang';
                if (status === 'soon') return 'siap-siap fix';
                return 'masih layak — tunda fix';
            }
            if (status === 'now') return 'replace sekarang';
            if (status === 'soon') return 'siap-siap replace';
            return 'tunda replace';
        }
        function repairTitle(part, kind, restockRaces) {
            if (!part || part.value == null) {
                return (kind === 'parts' ? 'Parts' : 'Engine') +
                    ' tidak terbaca — tidak ada saran yang dikarang.';
            }
            const unit = kind === 'parts' ? 'parts' : 'engine';
            const bits = [repairVerdictText(part, kind)];
            if (part.cost != null) {
                bits.push(part.cost + ' ' + unit + (part.stock != null ? '; stok ' + part.stock : '; stok tidak terbaca'));
            } else {
                bits.push('biaya tombol tidak terbaca');
            }
            if (part.enough === false) bits.push('STOK KURANG');
            if (kind === 'engine' && restockRaces != null) bits.push('restock ' + restockRaces + ' race');
            bits.push('ambang studi ≤50% ganti, ≤60% siap-siap');
            return (kind === 'parts' ? 'Parts ' : 'Engine ') + part.value + '% — ' + bits.join(' · ') +
                ' — estimasi, bukan rumus game.';
        }
        function paintRepairButton(el, part, kind, restockRaces) {
            if (!el || !part || part.value == null || part.status === 'unknown') return;
            const color = REPAIR_BUTTON_COLORS[part.status];
            if (!color) return;
            applyInlineStyle(el, {
                'background-color': color.bg,
                'background-image': 'none',
                'border-color': color.bg,
                'color': color.fg,
            });
            saveTitle(el);
            const tip = repairTitle(part, kind, restockRaces);
            el.setAttribute('title', tip);
            el.setAttribute('data-igpas-written-title', tip);
        }
        function mountRepair() {
            if (pageId() !== 'cars') { restoreRepair(); return; }
            const repair = document.getElementById('repair');
            if (!repair) { restoreRepair(); return; }
            restoreRepair(); // teks/style asli kembali dulu agar captures baca data murni
            const notice = repair.querySelector('.notice');
            const numOf = el => (el ? Utils.numOrNull(el.textContent) : null);
            const partsStock = numOf(repair.querySelector('.notice .totalParts'));
            const engineStock = numOf(repair.querySelector('.notice .totalEngines'));
            const restockM = notice ? Utils.clean(notice.textContent)
                .match(/Race\(s\) to next engine restock:\s*(\d+)/i) : null;
            const restockRaces = restockM ? Number(restockM[1]) : null;
            for (const card of repair.querySelectorAll('.c-wrap')) {
                const condEl = card.querySelector('.ratingCircle[id$="Condition"]');
                const engEl = card.querySelector('.ratingCircle[id$="Engine"]');
                if (!condEl && !engEl) continue;
                const fixBtn = card.querySelector('a[id$="PartSwap"]');
                const engBtn = card.querySelector('a[id$="EngSwap"]');
                const valueOf = el => (el ? Utils.numOrNull(el.getAttribute('data-value')) : null);
                const costOf = (el, label) => {
                    if (!el) return null;
                    const m = Utils.clean(el.textContent).match(new RegExp(label + '\\s*(\\d+)', 'i'));
                    return m ? Number(m[1]) : null;
                };
                const res = IGPCore.repairAdvice({
                    condition: valueOf(condEl),
                    engine: valueOf(engEl),
                    partCost: costOf(fixBtn, 'Fix'),
                    engineCost: costOf(engBtn, 'Replace'),
                    partsStock: partsStock,
                    engineStock: engineStock,
                    restockRaces: restockRaces,
                });
                if (!res.ok) continue;
                paintRepairButton(fixBtn, res.values.parts, 'parts', restockRaces);
                paintRepairButton(engBtn, res.values.engine, 'engine', restockRaces);
                const annotateCircle = (el, part, kind) => {
                    if (!el) return;
                    saveTitle(el);
                    const tip = repairTitle(part, kind, restockRaces);
                    el.setAttribute('title', tip);
                    el.setAttribute('data-igpas-written-title', tip);
                };
                annotateCircle(condEl, res.values.parts, 'parts');
                annotateCircle(engEl, res.values.engine, 'engine');
            }
        }

        /* Dialog Supply (engine/fuel/tyre): tombol alternatif diwarnai sesuai
         * rekomendasi — merah = ganti ke supplier ini, amber = aktif/calon
         * (tetap atau cek), abu-abu = bukan pilihan. Judul dialog tidak
         * ditulisi; detail Σ bonus/nilai/1M + verdict tetap di title header dan
         * title kartu. Teks biaya game TIDAK diubah. Style/title asli disimpan
         * dan dikembalikan oleh restoreSupply(); captures selalu berjalan
         * setelah restore sehingga adapter tidak pernah membaca hasil tulisan. */
        const SUPPLY_BUTTON_COLORS = {
            now: { bg: '#c0392b', fg: '#ffffff' },
            soon: { bg: '#d68910', fg: '#1b2631' },
            hold: { bg: '#5d6d7e', fg: '#ffffff' },
        };
        const SUPPLY_HEADER_COLORS = {
            now: { bg: 'rgba(192, 57, 43, 0.18)', accent: '#c0392b' },
            soon: { bg: 'rgba(214, 137, 16, 0.18)', accent: '#d68910' },
            hold: { bg: 'rgba(93, 109, 126, 0.14)', accent: '#5d6d7e' },
        };
        function restoreSupply() {
            // Cakupan STRICT dialog: data-igpas-* milik Cars/Manufacturers
            // tidak boleh tersentuh (renderAll me-mount berurutan).
            // Tanpa dialog = tidak ada node tersisa untuk dibersihkan.
            const dlg = document.querySelector('.supplyDialog');
            if (!dlg) return;
            for (const link of dlg.querySelectorAll('a[data-igpas-orig]')) {
                try {
                    // Restore teks versi lama — kecuali game sudah menggantinya.
                    restoreMarkedText(link);
                } catch { /* jangan pernah merusak halaman game */ }
                link.removeAttribute('data-igpas-orig');
                link.removeAttribute('data-igpas-origmode');
                link.removeAttribute('data-igpas-written');
            }
            const h2 = dlg.querySelector('.dialog-subhead-content h2[data-igpas-orig]');
            if (h2) {
                try { restoreMarkedText(h2); }
                catch { /* abaikan */ }
                h2.removeAttribute('data-igpas-orig');
                h2.removeAttribute('data-igpas-origmode');
                h2.removeAttribute('data-igpas-written');
            }
            for (const el of dlg.querySelectorAll('[data-igpas-title]')) {
                try {
                    const saved = el.getAttribute('data-igpas-title');
                    const written = el.getAttribute('data-igpas-written-title');
                    // Jangan menimpa title baru milik game jika game telah
                    // memperbarui node yang sama setelah advisor menulisnya.
                    if (written == null || el.getAttribute('title') === written) {
                        if (saved === '') el.removeAttribute('title');
                        else el.setAttribute('title', saved);
                    }
                } catch { /* abaikan */ }
                el.removeAttribute('data-igpas-title');
                el.removeAttribute('data-igpas-written-title');
            }
            for (const el of dlg.querySelectorAll('[data-igpas-orig-style]')) {
                try { restoreInlineStyle(el); } catch { /* abaikan */ }
            }
        }
        function mountSupply() {
            // Sisa migrasi versi panel: bersihkan tanpa menyentuh node game.
            removeIfAny([PREFIX + '-supply', PREFIX + '-supply-compare']);
            const dlg = document.querySelector('.supplyDialog');
            if (!dlg) { restoreSupply(); return; }
            restoreSupply(); // teks/style asli kembali dulu agar captures baca data murni
            const s = IgpSupplyAdapter.captures(document);
            if (!s || !s.current || !Array.isArray(s.alternatives) || !s.alternatives.length) return;
            const rank = IGPCore.rankSuppliers({ items: s.alternatives });
            // Gagal jujur: tanpa angka, tanpa modifikasi apa pun (tanpa panel).
            if (!rank.ok) return;
            const n = rank.values.ranked.length;
            const cmp = IGPCore.compareSuppliers({ current: s.current, alternatives: s.alternatives });
            // Efisiensi supplier aktif (Σ bonus per 1M biaya) memakai metrik yang
            // sama dengan rankSuppliers. Ganti supplier HANYA dianjurkan bila
            // alternatif jelas lebih efisien: tanpa ambang ini, alternatif selalu
            // "menang" peringkat dan user berpindah supplier berulang-ulang
            // (biaya sign-on berulang = loop mahal).
            const SWITCH_MARGIN = 1.05; // minimal 5% lebih efisien
            const curBonus = cmp.ok ? cmp.values.current.bonus : null;
            const curCost = cmp.ok ? cmp.values.current.cost : null;
            const curValuePerCost = (curBonus != null && curCost != null && curCost > 0)
                ? Math.round((curBonus / curCost) * 1e6 * 100) / 100
                : null;
            const bestAlt = rank.values.ranked.find(r => r.valuePerCost != null) || null;
            const switchRec = !!(curValuePerCost != null && bestAlt &&
                (curValuePerCost <= 0
                    ? bestAlt.valuePerCost > 0
                    : bestAlt.valuePerCost > curValuePerCost * SWITCH_MARGIN));
            const gainPct = (switchRec && curValuePerCost > 0 && bestAlt.valuePerCost != null)
                ? Math.round((bestAlt.valuePerCost / curValuePerCost - 1) * 100)
                : null;
            // Peringkat gabungan: aktif ikut dihitung supaya user langsung tahu
            // mana yang terbaik. Seri dimenangkan supplier aktif — tidak ada
            // alasan ganti bila nilainya sama.
            const pool = curValuePerCost != null
                ? [{ id: s.current.supplierId, eId: null, value: curBonus, cost: curCost,
                     valuePerCost: curValuePerCost, active: true }].concat(rank.values.ranked)
                : rank.values.ranked.slice();
            if (curValuePerCost != null) {
                const vp = r => (r.valuePerCost == null ? -Infinity : r.valuePerCost);
                const vv = r => (r.value == null ? -Infinity : r.value);
                pool.sort((a, b) => (vp(b) - vp(a)) || (vv(b) - vv(a)) ||
                    ((a.active ? 0 : 1) - (b.active ? 0 : 1)) ||
                    String(a.id).localeCompare(String(b.id)));
            }
            const ranks = new Map();
            let activeRank = null;
            pool.forEach((r, i) => {
                if (r.active) activeRank = i + 1;
                else if (r.eId != null) ranks.set(String(r.eId), i + 1);
            });
            const totalOps = n + (curValuePerCost != null ? 1 : 0);
            const bestAltRank = bestAlt ? pool.findIndex(r => r === bestAlt) + 1 : null;
            const showRanks = curValuePerCost != null;
            const cheapId = rank.values.cheapestId;
            // Peta kartu per eId — parsing identik adapter (anti substring eId=1 vs eId=10).
            const cards = new Map();
            for (const btn of dlg.querySelectorAll('a[data-tip*="supplyType="]')) {
                const tip = btn.getAttribute('data-tip') || '';
                const eId = (tip.match(/eId=(\d+)/) || [])[1];
                if (!eId || cards.has(eId)) continue;
                cards.set(eId, { link: btn, card: btn.closest('.inline-block') || btn.parentElement });
            }
            rank.values.ranked.forEach((r, i) => {
                if (r.eId == null) return;
                const hit = cards.get(String(r.eId));
                if (!hit || !hit.link) return;
                const link = hit.link, card = hit.card;
                const rankNo = ranks.get(String(r.eId)) || (i + 1);
                const isBest = !!(bestAlt && r.id === bestAlt.id);
                const isCheap = cheapId != null && r.id === cheapId;
                let status = 'hold';
                if (isBest) {
                    if (switchRec) status = 'now';
                    else if (curValuePerCost == null) status = 'soon';
                }
                const bc = SUPPLY_BUTTON_COLORS[status];
                applyInlineStyle(link, {
                    'background-color': bc.bg,
                    'background-image': 'none',
                    'border-color': bc.bg,
                    'color': bc.fg,
                });
                if (card) {
                    // Penanda title selalu dipasang ('' = semula tanpa title) agar
                    // restore presisi tanpa menyapu title milik game.
                    card.setAttribute('data-igpas-title',
                        card.hasAttribute('title') ? card.getAttribute('title') : '');
                    const advisorTitle = (showRanks ? '#' + rankNo + ' dari ' + totalOps : 'Alternatif') +
                        (isBest ? ' · rekomendasi ganti' : '') +
                        (isCheap ? ' · termurah' : '') +
                        ' — Σ bonus ' + (r.value == null ? '—' : (r.value > 0 ? '+' : '') + r.value) +
                        ' · ' + fmtMoney(r.cost) + '/race · nilai/1M ' +
                        (r.valuePerCost == null ? '—' : r.valuePerCost) +
                        (curValuePerCost != null
                            ? ' · aktif #' + activeRank + ' (' + curValuePerCost + '/1M)' +
                              (switchRec ? '' : ' — tetap')
                            : ' · aktif tak terbaca') +
                        ' — estimasi, bukan rumus game.';
                    card.setAttribute('title', advisorTitle);
                    card.setAttribute('data-igpas-written-title', advisorTitle);
                }
            });
            // Header supplier aktif: amber bila aktif terbaca (tetap/cek), abu-abu
            // bila aktif tak terbaca. Tombol merah = target ganti. Teks tidak diubah.
            const activeStatus = curValuePerCost == null ? 'hold' : 'soon';
            const subhead = dlg.querySelector('.dialog-subhead');
            if (subhead) {
                const hc = SUPPLY_HEADER_COLORS[activeStatus];
                applyInlineStyle(subhead, {
                    'background-color': hc.bg,
                    'background-image': 'none',
                    'box-shadow': 'inset 5px 0 0 ' + hc.accent,
                });
            }
            // Verdict supplier aktif hanya di title (tanpa teks tambahan).
            if (cmp.ok) {
                const h2 = dlg.querySelector('.dialog-subhead-content h2');
                if (h2) {
                    h2.setAttribute('data-igpas-title',
                        h2.hasAttribute('title') ? h2.getAttribute('title') : '');
                    const advisorTitle = 'Supplier aktif #' +
                        (s.current.supplierId != null ? s.current.supplierId : '?') +
                        ': Σ bonus ' + (curBonus == null ? '—' : (curBonus > 0 ? '+' : '') + curBonus) +
                        ' · ' + fmtMoney(curCost) + '/race · nilai/1M ' +
                        (curValuePerCost == null ? '—' : curValuePerCost) +
                        (activeRank != null ? ' (#' + activeRank + ' dari ' + totalOps + ')' : '') + '. ' +
                        'Alternatif terbaik: ' + (bestAlt
                            ? '#' + bestAltRank + ' · nilai/1M ' + bestAlt.valuePerCost +
                              ' · ' + fmtMoney(bestAlt.cost) + '/race' +
                              (gainPct == null ? '' : ' (+' + gainPct + '%)')
                            : '—') + '. ' +
                        'Aturan: ganti hanya bila alternatif ≥5% lebih efisien. ' +
                        'Kesimpulan: ' + (switchRec
                            ? 'ganti dianjurkan'
                            : (curValuePerCost != null ? 'tetap' : 'aktif tak terbaca — bandingkan manual')) +
                        ' — estimasi, bukan rumus game.';
                    h2.setAttribute('title', advisorTitle);
                    h2.setAttribute('data-igpas-written-title', advisorTitle);
                }
            }
        }

        /* Halaman Manufacturers: peringkat ditulis ke kolom nama tiap baris.
         * IN-PLACE PENUH (tanpa elemen baru): teks nama asli tiap baris game
         * ditulis ulang jadi "#n Nama" (+ ★ nilai terbaik engine); detail
         * rating/biaya/rating-per-1M + label estimasi di atribut title baris
         * yang sama. Link, flag, rating, dan kolom lain tidak disentuh.
         * Teks asli disimpan di data-igpas-orig dan dikembalikan oleh
         * restoreManufacturers() — captures selalu berjalan setelah restore
         * sehingga adapter tidak pernah membaca hasil tulisan. */
        function restoreManufacturers() {
            for (const tid of ['engine-table', 'chassis-table']) {
                let table = null;
                try { table = document.getElementById(tid); } catch { table = null; }
                if (!table) continue;
                for (const tr of table.querySelectorAll('tr[data-igpas-orig]')) {
                    try {
                        const tds = tr.querySelectorAll('td');
                        if (tds.length) {
                            const nd = Array.from(tds[0].childNodes).find(n =>
                                n.nodeType === 3 && n.textContent.trim() !== '');
                            const written = tr.getAttribute('data-igpas-written');
                            if (nd && (written == null || nd.textContent === written)) {
                                nd.textContent = tr.getAttribute('data-igpas-orig');
                            }
                        }
                        const savedTitle = tr.getAttribute('data-igpas-title');
                        if (savedTitle != null) {
                            const written = tr.getAttribute('data-igpas-written-title');
                            if (written == null || tr.getAttribute('title') === written) {
                                if (savedTitle === '') tr.removeAttribute('title');
                                else tr.setAttribute('title', savedTitle);
                            }
                        } else {
                            tr.removeAttribute('title');
                        }
                    } catch { /* jangan pernah merusak halaman game */ }
                    tr.removeAttribute('data-igpas-orig');
                    tr.removeAttribute('data-igpas-written');
                    tr.removeAttribute('data-igpas-title');
                    tr.removeAttribute('data-igpas-written-title');
                }
            }
        }
        function writeMfgRanks(table, ranked, bestValueId, withCost) {
            if (!table || !ranked) return;
            // Peta baris per id manufacturer (href d=brand&id=…) — anti duplikat.
            const byId = new Map();
            for (const tr of table.querySelectorAll('tbody tr')) {
                const tds = tr.querySelectorAll('td');
                if (tds.length < 2) continue;
                const a = tds[0].querySelector('a[href]');
                const idm = a ? (a.getAttribute('href') || '').match(/id=(\d+)/) : null;
                if (idm && !byId.has(idm[1])) byId.set(idm[1], tr);
            }
            const written = new Set();
            ranked.forEach((r, i) => {
                if (r.id == null) return;
                const tr = byId.get(String(r.id));
                if (!tr || written.has(tr)) return;
                const tds = tr.querySelectorAll('td');
                if (!tds.length) return;
                let nameNode = null;
                try {
                    for (const nd of tds[0].childNodes) {
                        if (nd.nodeType === 3 && nd.textContent.trim() !== '') { nameNode = nd; break; }
                    }
                } catch { nameNode = null; }
                if (!nameNode) return;
                const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
                // Teks milik text-node ini saja — BUKAN seluruh sel. Bila nama
                // dipecah ke anak elemen (mis. text node "Akina" + <span>SpeedStars</span>),
                // memakai textContent sel membuat nama tergandakan dan restore
                // menyuntik teks gabungan ke text node.
                const rawName = nameNode.textContent;
                const orig = clean(rawName);
                const fullName = clean(tds[0].textContent) || orig;
                if (!orig) return;
                const star = withCost && bestValueId != null && r.id === bestValueId &&
                    i !== 0 ? ' ★' : '';
                tr.setAttribute('data-igpas-orig', orig);
                tr.setAttribute('data-igpas-title',
                    tr.hasAttribute('title') ? tr.getAttribute('title') : '');
                nameNode.textContent = '#' + (i + 1) + ' ' + orig + star;
                tr.setAttribute('data-igpas-written', nameNode.textContent);
                const advisorTitle = '#' + (i + 1) + ' · ' + fullName +
                    (star ? ' · nilai terbaik' : '') + ': rating ' + r.rating + '%' +
                    (withCost ? ' · ' + fmtMoney(r.cost) + '/race · rating/1M ' +
                        (r.ratingPerCost == null ? '—' : r.ratingPerCost) : '') +
                    ' — estimasi, bukan rumus game.';
                tr.setAttribute('title', advisorTitle);
                tr.setAttribute('data-igpas-written-title', advisorTitle);
                written.add(tr);
            });
        }
        function mountManufacturers() {
            // Sisa migrasi versi panel: bersihkan tanpa menyentuh node game.
            removeIfAny([PREFIX + '-mfg-engine', PREFIX + '-mfg-chassis']);
            if (pageId() !== 'manufacturers') { restoreManufacturers(); return; }
            restoreManufacturers(); // teks asli kembali dulu agar captures baca data murni
            const m = IgpManufacturersAdapter.captures(document);
            // Engines: rating + biaya/race → rating per 1M. Gagal jujur per tabel:
            // tanpa angka, tabel itu tanpa modifikasi apa pun (tanpa panel).
            const et = document.getElementById('engine-table');
            if (et) {
                const res = IGPCore.rankManufacturerItems({ items: m ? m.engines : [], withCost: true });
                if (res.ok) writeMfgRanks(et, res.values.ranked, res.values.bestValueId, true);
            }
            // Chassis: rating saja — tanpa biaya.
            const ct = document.getElementById('chassis-table');
            if (ct) {
                const res = IGPCore.rankManufacturerItems({ items: m ? m.chassis : [], withCost: false });
                if (res.ok) writeMfgRanks(ct, res.values.ranked, null, false);
            }
        }

        /**
         * ETA pulih penuh dari health (%) dan laju pulih (%/jam). Dibulatkan
         * ke atas supaya advisor tidak menjanjikan pulih lebih cepat.
         * @returns {string|null} mis. "13j 55m", "2d 3j", atau null
         */
        function formatRecoverEta(health, ratePerHour) {
            if (health == null || ratePerHour == null || !(ratePerHour > 0)) return null;
            const remain = 100 - health;
            if (remain <= 0) return null;
            const mins = Math.ceil((remain / ratePerHour) * 60);
            const days = Math.floor(mins / 1440);
            const hours = Math.floor((mins % 1440) / 60);
            const minutes = mins % 60;
            if (days > 0) return days + 'd ' + hours + 'j';
            if (hours > 0) return hours + 'j ' + minutes + 'm';
            return minutes + 'm';
        }

        /* Halaman Drivers & Staff: kondisi tim aktif (read-only, jujur). */
        function mountTeam() {
            const id = PREFIX + '-team';
            const idCmp = PREFIX + '-team-compare';
            removeIfAny([id, idCmp]);
            if (pageId() !== 'staff') { restoreTeamInPlace(); return; }
            const s = IgpStaffAdapter.captures(document);
            if (!s) return;
            for (const [i, d] of (s.drivers || []).entries()) {
                const name = document.querySelector('#d' + (i + 1) + 'Pic .driverName');
                if (!name || !d.name) continue;
                // Label bersih: "<Nama> | Full Recover 13j 55m" — tanpa jargon
                // "health rendah". Angka mentah + laju pulih tetap di title.
                const eta = (d.health != null && d.health < 100)
                    ? formatRecoverEta(d.health, d.recoveryPerHour)
                    : null;
                const advice = [];
                if (eta) advice.push('Full Recover ' + eta);
                else if (d.health != null && d.health < 100) advice.push('Health ' + d.health + '%');
                // Struktur game (.driverName > br + span) dipertahankan: saran hanya
                // menempel pada span nama yang sudah ada; hover container = detail.
                const span = name.querySelector('span:last-child');
                saveTitle(name);
                const tipParts = [];
                if (d.health != null) tipParts.push('Health ' + d.health + '%');
                if (d.recoveryPerHour != null) tipParts.push('pulih ' + d.recoveryPerHour + '/jam');
                if (eta) tipParts.push('Full Recover ±' + eta);
                const tip = tipParts.length
                    ? 'Driver: ' + tipParts.join(' · ') + ' · estimasi, bukan rumus game — keputusan tetap milik Anda.'
                    : '';
                if (tip) { name.setAttribute('title', tip); name.setAttribute('data-igpas-written-title', tip); }
                if (span) {
                    const orig = span.getAttribute('data-igpas-orig') || span.textContent;
                    writeSelfText(span, orig + (advice.length ? ' | ' + advice.join(' · ') : ''));
                }
            }
            for (const card of document.querySelectorAll('#staff .c-wrap')) {
                const role = Utils.roleCode(card.querySelector('.c-head')?.textContent);
                const c = (s.staffCards || []).find(x => Utils.roleCode(x.role) === role);
                if (!c) continue;
                const head = card.querySelector('.c-head');
                if (head) {
                    writeSelfText(head, (head.getAttribute('data-igpas-orig') || head.textContent));
                    saveTitle(head);
                    const tip = (c.salaryPerRace != null ? 'Gaji ' + fmtMoney(c.salaryPerRace) + '/race' : '') +
                        (c.contract ? ' · kontrak ' + c.contract : '') + ' — rating kartu tidak terbaca.';
                    head.setAttribute('title', tip);
                    head.setAttribute('data-igpas-written-title', tip);
                }
            }
        }

        // Kembalikan teks yang PERNAH kita tulis saja. Bila game sudah
        // mengganti isi node itu (AJAX/re-render), data game yang lebih baru
        // tidak boleh ditimpa teks lama.
        function restoreMarkedText(el) {
            const orig = el.getAttribute('data-igpas-orig');
            if (orig == null) return;
            const written = el.getAttribute('data-igpas-written');
            const isNode = el.getAttribute('data-igpas-origmode') === 'node';
            const target = isNode
                ? Array.from(el.childNodes).find(n => n.nodeType === 3 && n.textContent.trim() !== '')
                : el;
            if (!target) return;
            if (written != null && target.textContent !== written) return;
            target.textContent = orig;
        }
        // Tulis teks milik sendiri pada elemen yang seluruh textContent-nya aman
        // ditimpa (span nama, header kartu): anak elemen tidak ada yang dihancurkan.
        function writeSelfText(el, text) {
            if (!el) return;
            if (!el.hasAttribute('data-igpas-orig')) el.setAttribute('data-igpas-orig', el.textContent);
            el.setAttribute('data-igpas-origmode', 'self');
            el.textContent = text;
            el.setAttribute('data-igpas-written', text);
        }
        // Tulis pada text-node pertama yang tak kosong di dalam container
        // (sel game/transfers berisi <a>/<img>): link, flag & ikon tetap hidup.
        function writeFirstTextNode(container, text) {
            if (!container) return;
            const nd = Array.from(container.childNodes).find(n => n.nodeType === 3 && n.textContent.trim() !== '');
            if (!nd) return;
            if (!container.hasAttribute('data-igpas-orig')) container.setAttribute('data-igpas-orig', nd.textContent);
            container.setAttribute('data-igpas-origmode', 'node');
            nd.textContent = text;
            container.setAttribute('data-igpas-written', text);
        }
        function saveTitle(el) {
            if (!el.hasAttribute('data-igpas-title')) el.setAttribute('data-igpas-title', el.getAttribute('title') || '');
        }
        function restoreTitle(el) {
            const saved = el.getAttribute('data-igpas-title');
            const written = el.getAttribute('data-igpas-written-title');
            if (saved != null && (written == null || el.getAttribute('title') === written)) {
                if (saved) el.setAttribute('title', saved); else el.removeAttribute('title');
            }
            el.removeAttribute('data-igpas-title');
            el.removeAttribute('data-igpas-written-title');
        }
        function restoreTeamInPlace() {
            const SKIP = '#carAttributesDisplay, .supplyDialog, #engine-table, #chassis-table,' +
                ' #repair, #sponsorSignTable';
            for (const el of document.querySelectorAll('[data-igpas-orig]')) {
                if (el.closest(SKIP)) continue;
                try {
                    restoreMarkedText(el);
                    restoreTitle(el);
                } catch { /* jangan pernah merusak halaman game */ }
                el.removeAttribute('data-igpas-orig');
                el.removeAttribute('data-igpas-origmode');
                el.removeAttribute('data-igpas-written');
            }
            // Pass kedua: anotasi yang HANYA menempelkan title (mis. portrait
            // #dNPic .driverName) tidak punya data-igpas-orig. Tanpa pass ini
            // tooltip advisor tertinggal setelah pindah halaman.
            for (const el of document.querySelectorAll('[data-igpas-title], [data-igpas-written-title]')) {
                if (el.closest(SKIP)) continue;
                try { restoreTitle(el); } catch { /* abaikan */ }
            }
        }

        /* Halaman Transfers: pasar driver & staff yang tampil di tabel. */
        function mountTransfers() {
            const idD = PREFIX + '-tx-driver';
            const idS = PREFIX + '-tx-staff';
            const idC = PREFIX + '-tx-compare';
            removeIfAny([idD, idS, idC]);
            if (pageId() !== 'transfers') return;
            const m = IgpTransfersAdapter.captures(document);
            if (!m) return;
            const annotate = (table, items, label) => {
                if (!table || !items.length) return;
                const ranked = items.slice().sort((a, b) =>
                    (Number(b.overall || -1) - Number(a.overall || -1)) ||
                    (Number(a.fee || Infinity) - Number(b.fee || Infinity)));
                const ranks = new Map(ranked.map((x, i) => [String(x.id), i + 1]));
                for (const tr of table.querySelectorAll('tbody tr')) {
                    const idm = String(tr.id || '').match(/_(\d+)$/);
                    const item = idm ? items.find(x => String(x.id) === idm[1]) : null;
                    const td = tr.querySelector('td');
                    if (!item || !td) continue;
                    const nd = Array.from(td.childNodes).find(n => n.nodeType === 3 && n.textContent.trim() !== '');
                    const original = td.getAttribute('data-igpas-orig') || (nd ? nd.textContent : td.textContent);
                    const rank = ranks.get(String(item.id));
                    writeFirstTextNode(td, '#' + rank + ' ' + original.trim() + (rank === 1 ? ' ★ rekomendasi' : ''));
                    saveTitle(td);
                    const tip = label + ' #' + rank + ': overall ' + (item.overall == null ? '—' : item.overall) +
                        ' · fee ' + fmtMoney(item.fee) + ' — estimasi, bukan rumus game.';
                    td.setAttribute('title', tip);
                    td.setAttribute('data-igpas-written-title', tip);
                }
            };
            annotate(document.getElementById('driver-table'), m.drivers, 'Driver');
            annotate(document.getElementById('staff-table'), m.staff, 'Staff');
            return;
        }

        /* Dialog sponsor (Primary/Secondary): peringkat "paling worth" pada
         * tombol Sign yang sudah ada. IN-PLACE PENUH (tanpa elemen baru):
         * tombol total tertinggi diwarnai hijau + "Sign ★"; bila income
         * tertinggi (jaminan terbaik) berbeda, tombol itu amber. Angka game
         * tidak diubah; rincian income/term/bonus/jaminan di title tombol
         * yang sama. Teks/style/title asli disimpan dan dikembalikan oleh
         * restoreSponsor() — captures selalu berjalan setelah restore. */
        const SPONSOR_BUTTON_COLORS = {
            best: { bg: '#1e8449', fg: '#ffffff' },
            alternative: { bg: '#b9770e', fg: '#ffffff' },
        };
        function restoreSponsor() {
            const table = document.getElementById('sponsorSignTable');
            if (!table) return;
            for (const el of table.querySelectorAll('[data-igpas-orig]')) {
                try { restoreMarkedText(el); } catch { /* abaikan */ }
                el.removeAttribute('data-igpas-orig');
                el.removeAttribute('data-igpas-origmode');
                el.removeAttribute('data-igpas-written');
            }
            for (const el of table.querySelectorAll('[data-igpas-title], [data-igpas-written-title]')) {
                try { restoreTitle(el); } catch { /* abaikan */ }
            }
            for (const el of table.querySelectorAll('[data-igpas-orig-style]')) {
                try { restoreInlineStyle(el); } catch { /* abaikan */ }
            }
        }
        function sponsorTitle(r, values) {
            const bits = [];
            if (values.incomeKind === 'token') {
                // Token = satuan berbeda dari cash. Jangan pernah menjumlahkan.
                bits.push('income ' + r.tokens + ' token/race (token tidak dikonversi ke cash)');
                if (r.bonus != null) {
                    bits.push('bonus tunai ' + fmtMoney(r.bonus) + '/race bila objektif tercapai');
                }
                if (values.termRaces != null) {
                    bits.push('≈ ' + (r.tokens * values.termRaces) + ' token selama ' +
                        values.termRaces + ' race');
                    if (r.bonus != null) {
                        bits.push('bonus tunai maks ' + fmtMoney(r.bonus * values.termRaces) +
                            ' bila objektif tiap race');
                    }
                } else {
                    bits.push('term kontrak tidak terbaca — total tidak dihitung');
                }
                bits.push('token diutamakan; bonus tunai trade-off');
            } else {
                bits.push('income ' + fmtMoney(r.income) + '/race (dijamin tiap race)');
                if (r.bonus != null) {
                    bits.push('bonus ' + fmtMoney(r.bonus) + '/race bila objektif tercapai');
                }
                if (values.termRaces != null) {
                    bits.push('jaminan ' + fmtMoney(r.guaranteeTotal) + ' (' + values.termRaces + ' race)');
                    bits.push('potensi maks ' + fmtMoney(r.potentialTotal) + ' bila objektif tiap race');
                } else {
                    bits.push('term kontrak tidak terbaca — total tidak dihitung');
                }
                if (String(r.eId) === String(values.alternativeEId)) {
                    bits.push('bonus tunai tertinggi — trade-off income' +
                        (values.breakEvenP != null
                            ? '; unggul bila objektif tercapai >' + Math.round(values.breakEvenP * 100) + '% race'
                            : ''));
                }
            }
            if (values.incomeKind === 'token' && String(r.eId) === String(values.alternativeEId)) {
                bits.push('bonus tunai tertinggi — trade-off token');
            }
            bits.push('estimasi, bukan rumus game');
            return 'Sponsor ' + (r.rank === 1 ? 'paling worth #1' : '#' + r.rank) +
                ' dari ' + values.ranked.length + ': ' + bits.join(' · ') + '.';
        }
        function mountSponsor() {
            const table = document.getElementById('sponsorSignTable');
            if (!table) { restoreSponsor(); return; }
            restoreSponsor(); // teks/style asli kembali dulu agar captures baca data murni
            const s = IgpSponsorAdapter.captures(document);
            if (!s) return;
            const res = IGPCore.rankSponsors({
                offers: s.offers,
                termRaces: s.termRaces,
                incomeKind: s.incomeKind,
            });
            if (!res.ok) return;
            const values = res.values;
            const byId = new Map(values.ranked.map(r => [String(r.eId), r]));
            const signRow = Array.from(table.querySelectorAll('tr')).find(tr =>
                tr.querySelector('a[data-tip*="eId="]'));
            if (!signRow) return;
            for (const td of signRow.querySelectorAll('td')) {
                const a = td.querySelector('a[data-tip*="eId="]');
                if (!a) continue;
                const eId = (String(a.getAttribute('data-tip') || '').match(/eId=(\d+)/) || [])[1];
                const r = eId ? byId.get(eId) : null;
                if (!r) continue;
                const isBest = r.rank === 1;
                const isAlternative = String(r.eId) === String(values.alternativeEId);
                if (isBest) {
                    writeSelfText(a, 'Sign ★');
                    applyInlineStyle(a, {
                        'background-color': SPONSOR_BUTTON_COLORS.best.bg,
                        'background-image': 'none',
                        'border-color': SPONSOR_BUTTON_COLORS.best.bg,
                        'color': SPONSOR_BUTTON_COLORS.best.fg,
                    });
                } else if (isAlternative) {
                    applyInlineStyle(a, {
                        'background-color': SPONSOR_BUTTON_COLORS.alternative.bg,
                        'background-image': 'none',
                        'border-color': SPONSOR_BUTTON_COLORS.alternative.bg,
                        'color': SPONSOR_BUTTON_COLORS.alternative.fg,
                    });
                }
                saveTitle(a);
                const tip = sponsorTitle(r, values);
                a.setAttribute('title', tip);
                a.setAttribute('data-igpas-written-title', tip);
            }
        }

        /* Render instan 0ms (v0.8.0): konten game datang async (AJAX) setelah DOM
         * awal — menunggu klik user + debounce 250ms bikin rekomendasi telat.
         * MutationObserver bereaksi di microtask yang sama saat game commit DOM
         * (±0ms, sebelum paint berikutnya), tanpa debounce.
         * Anti-loop: observer DIPUTUS selama renderAll (tulisan label/title +
         * panel milik sendiri tidak direkam), disambung lagi setelahnya;
         * mutasi yang lolos tetap disaring relevance (UI milik sendiri &
         * atribut tulisan advisor diabaikan). */
        let renderObserver = null;
        let renderObserving = false;
        const WATCH_SEL = '#carAttributesDisplay, #carAttributes, #carsDesignPoints,' +
            ' #leagueDesignData, #carAttributesBonuses, .carsSuppliers, #repair, .supplyDialog,' +
            ' #engine-table, #chassis-table, #drivers, #staff, #driverStatsTable,' +
            ' #driver-table, #staff-table, #cdTransfersRefresh, #sponsorSignTable, #pageId';
        function observeOff() {
            if (renderObserver && renderObserving) {
                try { renderObserver.disconnect(); } catch { /* abaikan */ }
                renderObserving = false;
            }
        }
        function observeOn() {
            if (renderObserver || typeof MutationObserver === 'undefined') {
                if (!renderObserver || renderObserving) return;
            } else {
                try { renderObserver = new MutationObserver(onMutations); }
                catch { renderObserver = null; }
                if (!renderObserver) return; // fallback: debounce klik/user-aksi tetap jalan
            }
            if (renderObserving || typeof document === 'undefined' || !document.body) return;
            try {
                renderObserver.observe(document.body,
                    { childList: true, subtree: true, characterData: true, attributes: true });
                renderObserving = true;
            } catch { /* observer opsional — fallback debounce tetap jalan */ }
        }
        // Hitungan waktu game (countdown) berubah tiap detik dan TIDAK
        // memengaruhi rekomendasi — jangan memicu DOM walk penuh tiap tick.
        const COUNTDOWN_SEL = '.countdown, [data-countdown], .raceCountdown, .timer';
        function mutationRelevant(m) {
            if (!m) return false;
            const own = el => !!(el && el.closest && el.closest('.igpas-adv-panel, #' + PREFIX + '-toggle'));
            const t = m.target;
            if (t && t.nodeType === 1 && t.closest && t.closest(COUNTDOWN_SEL)) return false;
            if (m.type === 'attributes' && t && t.nodeType === 1) {
                if (own(t)) return false;
                const an = m.attributeName;
                if (an === 'data-igpas-orig' || an === 'data-igpas-title') return false;
                // Title tulisan advisor di elemen game bertanda (baris Cars,
                // baris Manufacturers, kartu/judul Supply) — bukan sinyal game.
                if (an === 'title' && t.closest && t.closest('[data-igpas-orig], [data-igpas-title]')) return false;
                if (t === document.body) return false; // class igpas-adv-hide milik sendiri
            }
            if (m.type === 'characterData') {
                const p = t && t.parentElement;
                if (!p || own(p)) return false;
                if (p.closest && p.closest(COUNTDOWN_SEL)) return false;
                try { return !!(p.closest && p.closest(WATCH_SEL)); }
                catch { return false; }
            }
            if (t && t.nodeType === 1 && !own(t)) {
                try { if (t.closest && t.closest(WATCH_SEL)) return true; }
                catch { /* abaikan */ }
            }
            if (m.type === 'childList') {
                const lists = [m.addedNodes, m.removedNodes];
                for (const list of lists) {
                    for (const n of (list || [])) {
                        if (!n || n.nodeType !== 1 || own(n)) continue;
                        try {
                            if (n.matches && n.matches(WATCH_SEL)) return true;
                            if (n.querySelector && n.querySelector(WATCH_SEL)) return true;
                        } catch { /* abaikan */ }
                    }
                }
            }
            return false;
        }
        function onMutations(muts) {
            for (const m of (muts || [])) {
                let hit = false;
                try { hit = mutationRelevant(m); } catch { hit = false; }
                if (hit) { renderAll(); return; } // sinkron, tanpa debounce
            }
        }

        function renderAll() {
            if (typeof document === 'undefined' || !document.body) return;
            const pid = pageId();
            // Dialog sponsor bisa terbuka di halaman Finances (di luar daftar
            // halaman studi) — gate berbasis DOM dialog, bukan pageId.
            const sponsorOpen = !!document.getElementById('sponsorSignTable');
            if (!sponsorOpen && ['cars', 'manufacturers', 'staff', 'transfers'].indexOf(pid) === -1) {
                // Halaman lain: tanpa jejak UI apa pun (disiplin study-only).
                removeIfAny([PREFIX + '-toggle', PREFIX + '-style', PREFIX + '-design',
                    PREFIX + '-supply', PREFIX + '-supply-compare', PREFIX + '-mfg-engine',
                    PREFIX + '-mfg-chassis', PREFIX + '-team', PREFIX + '-team-compare',
                    PREFIX + '-tx-driver', PREFIX + '-tx-staff', PREFIX + '-tx-compare']);
                restoreDesign(); // kembalikan teks label asli (tanpa elemen baru)
                restoreRepair(); // kembalikan judul kartu + title kondisi
                restoreSupply(); // kembalikan teks biaya kartu + judul dialog
                restoreManufacturers(); // kembalikan teks nama baris
                restoreTeamInPlace(); // kembalikan nama staff/transfers + title
                restoreSponsor(); // kembalikan tombol Sign + title/style
                return;
            }
            observeOff(); // tulisan sendiri tidak memicu observer
            removeIfAny([PREFIX + '-style']);
            try {
                restoreDesign();
                restoreRepair();
                restoreSupply();
                restoreManufacturers();
                restoreTeamInPlace();
                restoreSponsor();
                mountDesign();
                mountRepair();
                mountSupply();
                mountManufacturers();
                mountTeam();
                mountTransfers();
                mountSponsor();
            } catch (e) {
                if (typeof console !== 'undefined') console.warn('IGPAS advisor', e); // jangan pernah merusak halaman game
            }
            removeIfAny([PREFIX + '-toggle']);
            observeOn();
        }

        function start() {
            if (typeof document === 'undefined' || !document.body) return;
            if (start.started) return; // idempoten — aman dari double DOMContentLoaded
            start.started = true;
            renderAll();
            observeOn(); // jaga observer tetap tersambung setelah render awal
            // Re-render dipicu DUA jalur: (1) observer instan saat DOM game berubah
            // (0ms, tanpa debounce); (2) fallback debounce 250ms untuk navigasi yang
            // tidak menyentuh DOM terawasi (popstate/hashchange/klik antar-halaman).
            let pending = null;
            const schedule = (ev) => {
                // Ketikan di field game (chat, pencarian, dsb.) bukan sinyal navigasi —
                // lewati agar tiap keystroke tidak memicu DOM walk penuh (7× captures).
                // Tombol Enter di atas link/button tetap menghasilkan 'click' → tetap ke-render.
                if (ev && ev.type === 'keydown') {
                    const ae = document.activeElement;
                    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' ||
                        ae.tagName === 'SELECT' || ae.isContentEditable)) return;
                }
                // Klik di dalam UI milik sendiri sudah ditangani langsung (toggle →
                // applyHidden) — re-render penuh tidak menambah apa-apa.
                if (ev && ev.type === 'click' && ev.target && typeof ev.target.closest === 'function') {
                    if (ev.target.closest('.igpas-adv-panel, #' + PREFIX + '-toggle')) return;
                }
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
        // Blok PII eksplisit yang tampil di UI iGP.
        const REDACT_SELECTORS = ['#myProfileName', '#balanceText', '#tokens-total', '#managerRankValue'];
        // Nama atribut yang isinya kredensial/identitas — selalu dikosongkan.
        const SENSITIVE_ATTR = /^(data-)?(csrf|token|session|auth|nonce|password|secret|api[-_]?key|sharkid|visitor|tracker|analytics|fingerprint|device)$/i;
        // Identitas form: field ini bisa berisi csrf/email/user id.
        const SENSITIVE_IDENT = /(csrf|token|session|auth|e-?mail|password|username|user(name)?|manager)/i;
        // Kunci JSON yang tidak pernah dibutuhkan untuk pemetaan fixture.
        const SENSITIVE_KEY = /(csrf|token|session|auth|nonce|password|secret|api[-_]?key|e-?mail|manager|username)/i;
        const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
        const TOKEN_RE = /\b(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9_-]{40,})\b/g;
        const scrub = s => String(s)
            .replace(EMAIL_RE, '[REDACTED]')
            .replace(TOKEN_RE, '[REDACTED]');
        // Nilai PII konkret dari dokumen hidup (nama manajer, saldo, token,
        // rank) disapu dari SELURUH capture — termasuk aria-label/alt/src/
        // style yang tidak bisa dikenali dari pola. Tanpa ini nama asli user
        // tetap lolos di avatar/greeting walau #myProfileName sudah diblok.
        const scrubKnown = (s, pii) => {
            let out = scrub(s);
            for (const v of (pii || [])) {
                if (v && out.indexOf(v) !== -1) out = out.split(v).join('[REDACTED]');
            }
            return out;
        };
        const collectPii = doc => {
            const out = new Set();
            const add = v => {
                const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
                if (s.length >= 3) out.add(s);
            };
            for (const sel of REDACT_SELECTORS) {
                const el = doc.querySelector(sel);
                if (el) add(el.textContent);
            }
            // Nickname/username yang tampil di form profil.
            for (const el of doc.querySelectorAll(
                'input[name*="nick" i], input[id*="nick" i], input[name*="username" i]')) {
                add(el.value);
            }
            return Array.from(out).sort((a, b) => b.length - a.length);
        };
        // Elemen yang tidak dibutuhkan untuk memetakan fixture dan bisa memuat
        // kredensial/identitas: meta (csrf-token), link/base, template (konten
        // tidak terlihat querySelectorAll), iframe/object/embed (srcdoc).
        const DROP_SELECTOR = 'meta, link, base, template, iframe, object, embed';
        // Atribut struktural yang nilainya aman & penting untuk fixture.
        const KEEP_ATTR = /^(class|id|type|name|for|role|colspan|rowspan|width|height|viewbox|d|fill|stroke|points|transform)$/i;
        // URL: parameter sensitif + email tetap dibuang, path dipertahankan
        // kecuali berbentuk token panjang (mis. /reset/<64 hex>).
        const URL_ATTR = /^(href|src|action|formaction|poster|srcset)$/i;

        function scrubJson(v, depth) {
            const d = depth || 0;
            if (d > 12) return '[REDACTED]';
            if (Array.isArray(v)) return v.map(x => scrubJson(x, d + 1));
            if (v && typeof v === 'object') {
                const out = {};
                for (const k of Object.keys(v)) {
                    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : scrubJson(v[k], d + 1);
                }
                return out;
            }
            if (typeof v === 'string') return scrub(v);
            return v;
        }

        function scrubUrl(value) {
            let v = String(value);
            // Parameter kredensial/identitas. `(^|[?&])` juga menangani URL
            // relatif yang dimulai langsung dengan "p=manager&id=..." (tanpa "?").
            v = v.replace(
                /(^|[?&])((?:token|csrf|session|auth|key|api[-_]?key|manager|e-?mail|username|uid|userid|user_id|account|profile)=)[^&#]*/gi,
                '$1$2[REDACTED]');
            // Konteks profil manajer: semua `id=` adalah identitas akun/pemain.
            if (/(^|[?&])(?:p|page)=manager\b/i.test(v)) {
                v = v.replace(/(^|[?&])id=[^&#]*/gi, '$1id=[REDACTED]');
            }
            // Path avatar/akun: /img/user/<id>/... dan /av/<id>...
            v = v.replace(/(\/img\/user\/)[^/?#]+/gi, '$1[REDACTED]')
                .replace(/(\/av(?:atar)?\/)[^/?#]+/gi, '$1[REDACTED]');
            // Email di mana pun dalam URL.
            v = v.replace(EMAIL_RE, '[REDACTED]');
            // Token panjang sebagai segmen path.
            v = v.replace(/([/])[A-Za-z0-9_-]{40,}(?=[/?#]|$)/g, '$1[REDACTED]');
            return v;
        }

        function redact(clone, pii) {
            if (!clone || !clone.querySelectorAll) return clone;
            // 1) Elemen berisiko: script eksekutabel, meta/link/base, template,
            //    iframe/object/embed (srcdoc). Script JSON tetap dipertahankan
            //    (dibutuhkan fixture) tetapi isinya disaring pada langkah 5.
            for (const el of Array.from(clone.querySelectorAll('script, ' + DROP_SELECTOR))) {
                if (String(el.tagName || '').toUpperCase() === 'SCRIPT') {
                    const type = String(el.getAttribute('type') || '').toLowerCase();
                    if (!type.includes('json')) el.remove();
                } else {
                    el.remove();
                }
            }
            // 2) Komentar bisa memuat data internal/identitas.
            if (typeof clone.ownerDocument !== 'undefined' && clone.ownerDocument.createTreeWalker) {
                const walker = clone.ownerDocument.createTreeWalker(clone, 128 /* SHOW_COMMENT */);
                const comments = [];
                while (walker.nextNode()) comments.push(walker.currentNode);
                for (const c of comments) c.remove();
            }
            // 3) Nilai PII yang tampil.
            for (const sel of REDACT_SELECTORS) {
                const el = clone.querySelector(sel);
                if (el) el.textContent = '[REDACTED]';
            }
            // 4) Field form: hidden/password/email/tel dan field ber-identitas
            //    sensitif (csrf/user/session) → nilainya dikosongkan. Nilai
            //    angka permainan (mis. #d1AdvancedFuel) tetap utuh agar fixture
            //    masih bisa dipetakan (dan tetap lewat scrub pola).
            for (const el of clone.querySelectorAll('input, textarea')) {
                const tag = String(el.tagName || '').toUpperCase();
                const type = String(el.getAttribute('type') || '').toLowerCase();
                const ident = [el.getAttribute('id'), el.getAttribute('name'), el.getAttribute('class')]
                    .filter(Boolean).join(' ');
                const sensitive = tag === 'TEXTAREA' || type === 'hidden' || type === 'password' ||
                    type === 'email' || type === 'tel' || SENSITIVE_IDENT.test(ident);
                if (sensitive) {
                    if (tag === 'TEXTAREA') el.textContent = '[REDACTED]';
                    else el.setAttribute('value', '[REDACTED]');
                    if (el.hasAttribute('data-initialvalue')) el.setAttribute('data-initialvalue', '[REDACTED]');
                }
            }
            // 5) Script JSON: redaksi per kunci (token/email/manager) tanpa
            //    merusak angka permainan; JSON rusak → sapuan teks mentah.
            for (const s of clone.querySelectorAll('script')) {
                const raw = String(s.textContent || '');
                let out = raw;
                try {
                    const parsed = JSON.parse(raw);
                    // Script bootstrap identitas: kunci `id` di level atas adalah
                    // user/manager id, bukan id permainan.
                    const ident = String(s.id || '') + ' ' + String(s.className || '');
                    if (/(user|manager|account|profile|bootstrap)/i.test(ident) &&
                        parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
                        Object.prototype.hasOwnProperty.call(parsed, 'id')) {
                        parsed.id = '[REDACTED]';
                    }
                    out = scrubKnown(JSON.stringify(scrubJson(parsed)), pii);
                } catch {
                    out = scrubKnown(raw, pii);
                }
                if (out !== raw) s.textContent = out;
            }
            // 6) Atribut: kredensial bernama, URL, lalu scrub pola pada sisanya.
            for (const el of clone.querySelectorAll('*')) {
                for (const attr of Array.from(el.attributes || [])) {
                    const name = attr.name;
                    if (/^srcdoc$/i.test(name)) { el.removeAttribute(name); continue; }
                    // Handler inline = vektor eksekusi + bisa memuat ID/URL internal.
                    if (/^on/i.test(name)) { el.removeAttribute(name); continue; }
                    if (SENSITIVE_ATTR.test(name)) { attr.value = '[REDACTED]'; continue; }
                    if (URL_ATTR.test(name)) {
                        const v = scrubUrl(attr.value);
                        if (v !== attr.value) attr.value = v;
                        continue;
                    }
                    if (KEEP_ATTR.test(name)) continue; // nilai struktural, tanpa PII
                    // Atribut berisi JSON (data-config dsb.): redaksi per kunci.
                    const raw = String(attr.value || '');
                    if (/^[[{]/.test(raw.trim())) {
                        try {
                            const v = JSON.stringify(scrubJson(JSON.parse(raw)));
                            if (v !== raw) attr.value = v;
                            continue;
                        } catch { /* bukan JSON valid → scrub pola di bawah */ }
                    }
                    const v = scrubKnown(raw, pii);
                    if (v !== raw) attr.value = v;
                }
            }
            // 6b) Sapuan nilai PII konkret pada SEMUA atribut (termasuk src/
            //     style/aria-*/alt yang dilewati aturan struktural).
            for (const el of clone.querySelectorAll('*')) {
                for (const attr of Array.from(el.attributes || [])) {
                    const v = scrubKnown(attr.value, pii);
                    if (v !== attr.value) attr.value = v;
                }
            }
            // 7) Sapuan pola terakhir: email & string token panjang di text node
            //    (blok JSON dikecualikan agar data strategi tidak rusak).
            for (const el of clone.querySelectorAll('*')) {
                if (String(el.tagName || '').toUpperCase() === 'SCRIPT') continue;
                for (const nd of Array.from(el.childNodes || [])) {
                    if (nd.nodeType === 3) nd.textContent = scrubKnown(nd.textContent, pii);
                }
            }
            return clone;
        }

        function buildCapture(doc) {
            if (!doc || !doc.documentElement) return null;
            const pii = collectPii(doc);
            const clone = redact(doc.documentElement.cloneNode(true), pii);
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
                        title: 'I.G.P.A.S v' + VERSION + ' — capture',
                        text: 'DOM halaman (PII teredaksi) disalin ke clipboard. Tempel & kirim untuk pemetaan fixture.',
                    });
                }
            });
        }
        return { buildCapture: buildCapture, install: install };
    })();

    /* =====================================================================
     * 4) BOOT — Advisor read-only di tab iGP + menu capture.
     * ===================================================================== */

    function boot() {
        if (typeof document === 'undefined') return; // lingkungan non-browser (tes)

        const isIgpHost = () => {
            if (typeof location === 'undefined') return false;
            const h = String(location.hostname || '').toLowerCase();
            return h === 'igpmanager.com' || h.endsWith('.igpmanager.com');
        };

        const startUi = () => {
            if (!isIgpHost()) return;
            // Advisor in-page read-only: hanya teks/title pada elemen asli.
            // Tab Race live (#race) tidak pernah ditulis.
            if (typeof Advisor !== 'undefined') Advisor.start();
            // Menu Tampermonkey: salin capture DOM (redaksi PII) — tanpa UI halaman.
            if (typeof PageCapture !== 'undefined') PageCapture.install();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startUi);
        } else {
            startUi();
        }
    }

    boot();

    // Ekspor untuk pengujian Node — tanpa efek di browser (module tak terdefinisi).
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { IGPCore, Utils, Advisor, PageCapture, VERSION: VERSION };
    }
})();
