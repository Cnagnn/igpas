// ==UserScript==
// @name         I.G.P.A.S — iGP Analytics & Study System
// @namespace    https://github.com/Cnagnn/igpas
// @version      0.8.0
// @description  Race strategy study calculators + read-only study advice (account, car, supply, manufacturers, team, transfers) and pre-race setup/strategy estimate panels (ids `Setup`/`Strategy` tabs only — never the live Race tab). Study tool only, no live-race assistance, no automation.
// @description:id Kalkulator analisis & studi strategi iGP Manager (fuel, ban, pit window, stint) + catatan studi read-only (akun, mobil, supply, manufacturers, tim, transfers) + estimasi setup & strategi pra-balapan (hanya tab Setup/Strategy — bukan tab Race live). Alat studi, bukan bantuan saat balapan, tanpa otomasi.
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

    const VERSION = '0.8.0';

    /* =====================================================================
     * 1) CORE — fungsi murni, tanpa DOM. Teruji di Node (test/core.test.js).
     *    Semua perhitungan hanya aritmetika atas input pengguna.
     * ===================================================================== */

    const r1 = v => Math.round(v * 10) / 10;

    /* -- utils bersama (dedup helper) -- */
    const Utils = Object.freeze({
      numOrNull(v) {
        return v != null && String(v) !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
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

            const core = Utils.pitWindowCore(fuelLaps, reserveLaps, tireLaps, margin);
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

            const core = Utils.pitWindowCore(fuelLaps, reserve, tyreRaw, margin);
            const limiting = core.fuelLatest < tyreRaw ? 'fuel' : (tyreRaw < core.fuelLatest ? 'tyre' : 'tie');
            const decision = core.latest < 1 ? 'pit-now' : (core.recommended <= 1 ? 'pit-soon' : 'plan');

            return {
                ok: true,
                values: { decision, latest: core.latest, recommended: core.recommended, limiting, pitLoss },
                rows: [
                    ['Keputusan', decision],
                    ['Faktor pembatas', limiting],
                    ['Latest pit setelah', core.latest + ' lap'],
                    ['Rekomendasi (−margin)', core.recommended + ' lap'],
                    ['Biaya pit', pitLoss + ' lap-equivalent'],
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
                const peers = mkt.filter(m => m && (role == null || Utils.roleCode(m.role) === role));
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
                if (!x || !Array.isArray(x.bonuses)) return null;
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

        /**
         * Baca posisi BAR IDEAL slider setup dari atribut stylenya (v0.7.3).
         * Game menulis: left:calc(X% + Npx);width:calc(Y% - Npx) pada
         * .setupSlider-idealRange. Ekstraksi murni regex persen — tanpa asumsi
         * lain. Bar setebal track penuh (width >= 100%) = ideal BELUM
         * dipelajari; pemanggil wajib menampilkan "belum diketahui", bukan
         * mengarang angka tengah.
         * @param {string|null} styleAttr atribut style mentah
         * @returns {{left:Number,width:Number}|null}
         */
        parseSliderIdeal(styleAttr) {
            const m = String(styleAttr == null ? '' : styleAttr).match(/-?\d+(?:\.\d+)?%/g);
            if (!m || m.length < 2) return null;
            const left = parseFloat(m[0]);
            const width = parseFloat(m[1]);
            if (!Number.isFinite(left) || !Number.isFinite(width)) return null;
            return {
                left: Math.round(left * 10) / 10,
                width: Math.round(width * 10) / 10,
            };
        },

        /**
         * Estimasi satu slider vs bar ideal game (v0.7.3). Titik tengah bar di
         * pakai sebagai estimasi ideal; selisih = nilai slider sekarang − mid.
         * Bar penuh (width >= 100%) → learned:false (data belum cukup).
         * @param {object} p { ideal:{left,width}|null, current:Number-like|null }
         */
        setupAdvice(p) {
            const cur = (p && p.current != null && Number.isFinite(Number(p.current)))
                ? Number(p.current) : null;
            const ideal = (p && p.ideal) || null;
            if (!ideal || ideal.width == null || ideal.width >= 100) {
                return { learned: false, current: cur };
            }
            const mid = Math.round((ideal.left + ideal.width / 2) * 10) / 10;
            const delta = (cur != null) ? Math.round((cur - mid) * 10) / 10 : null;
            return { learned: true, mid: mid, delta: delta, current: cur };
        },

        /**
         * Ringkas strategi balapan SATU driver (v0.7.3) dari data yang MEMANG
         * ditulis game di halaman (JSON strategi #dN-StrategyJson, #raceLaps,
         * #dN-FuelPrediction, bensin opsi lanjutan #dN-AdvancedFuel) + aturan
         * liga span #rules. Semua perhitungan = aritmetika tampil + heuristik
         * berlabel estimasi di panel. null = data tidak tampil — JANGAN jadi 0
         * (pitfall Number(null) === 0 dijaga lewat numOrNull).
         * @param {object} p { strategy, raceLaps, fuelPerLap, advancedFuel,
         *                     ruleTwoTyres:Boolean, ruleRefuelling:Boolean }
         */
        summarizeStrategy(p) {
            const st = (p && p.strategy) || null;
            const stintMap = (st && st.stint && typeof st.stint === 'object') ? st.stint : null;
            const activeCount = st ? Number(st.stints) : NaN;
            if (!stintMap) return { ok: false, error: 'JSON strategi game tidak terbaca' };
            if (!Number.isFinite(activeCount)) {
                return { ok: false, error: 'jumlah stint aktif (game) tidak terbaca' };
            }
            const numOrNull = Utils.numOrNull;
            const raceLaps = numOrNull(p ? p.raceLaps : null);
            const fpl = numOrNull(p ? p.fuelPerLap : null);
            const advFuel = numOrNull(p ? p.advancedFuel : null);
            // Kunci stint dipakai sesuai urutan tulisan game; jumlah stint
            // AKTIF diambil dari field game "stints" (stint kelebihan = nonaktif).
            const active = [];
            for (const k of Object.keys(stintMap)) {
                const s = stintMap[k] || {};
                active.push({
                    stint: k,
                    tyre: (s.tyre == null || String(s.tyre) === '') ? null : String(s.tyre),
                    laps: numOrNull(s.laps),
                });
                if (active.length >= activeCount) break;
            }
            let lapsTotal = 0;
            let unknownLaps = 0;
            for (const s of active) {
                if (s.laps == null) unknownLaps++;
                else lapsTotal += s.laps;
            }
            const tyres = active.map(s => s.tyre).filter(t => t != null);
            const dry = tyres.filter(t => ['SS', 'S', 'M', 'H'].indexOf(t) !== -1);
            const fuelNeed = (raceLaps != null && fpl != null)
                ? Math.round(raceLaps * fpl * 10) / 10 : null;
            const fuelBuffer = (fuelNeed != null && advFuel != null)
                ? Math.round((advFuel - raceLaps * fpl) * 10) / 10 : null;
            const bufferLaps = (fuelBuffer != null && fpl)
                ? Math.round((fuelBuffer / fpl) * 10) / 10 : null;
            return {
                ok: true,
                values: {
                    stints: active,
                    stintsCount: activeCount,
                    pits: numOrNull(st.pits),
                    risk: numOrNull(st.risk_level),
                    autoFuel: numOrNull(st.auto_fuel),
                    raceLaps: raceLaps,
                    lapsTotal: lapsTotal,
                    unknownLaps: unknownLaps,
                    lapsShort: (raceLaps != null) ? Math.max(0, raceLaps - lapsTotal) : null,
                    fuelPerLap: fpl,
                    advancedFuel: advFuel,
                    fuelNeed: fuelNeed,
                    fuelBuffer: fuelBuffer,
                    bufferLaps: bufferLaps,
                    tyres: tyres,
                    dryUnique: Array.from(new Set(dry)),
                    twoTyreOk: (p && p.ruleTwoTyres === true)
                        ? (dry.length > 0 && new Set(dry).size >= 2) : null,
                    refuelling: !!(p && p.ruleRefuelling === true),
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
            get: (k, d) => { try { return GM_getValue(k, d); } catch { return d; } },
            set: (k, v) => { try { GM_setValue(k, v); } catch { memStore.set(k, v); } },
            del: (k) => { try { GM_deleteValue(k); } catch { memStore.delete(k); } },
            keys: () => { try { return GM_listValues() || []; } catch { return []; } },
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
        getProfiles() {
            const all = gm.get(Keys.profiles, null);
            if (!all || typeof all !== 'object' || Array.isArray(all)) return Object.create(null);
            return all;
        },
        saveProfile(name, snapshot) {
            if (!Utils.isSafeKind(name)) return;
            const all = Storage.getProfiles();
            const next = Object.assign(Object.create(null), all);
            next[name] = snapshot;
            gm.set(Keys.profiles, next);
        },
        deleteProfile(name) {
            if (!Utils.isSafeKind(name)) return;
            const all = Storage.getProfiles();
            if (!(name in all)) return;
            const next = Object.assign(Object.create(null), all);
            delete next[name];
            gm.set(Keys.profiles, next);
        },
        getSnapshot(kind) {
            if (!Utils.isSafeKind(kind)) return null;
            const all = gm.get(Keys.snapshots, null) || Object.create(null);
            if (!all || typeof all !== 'object') return null;
            return all[kind] || null;
        },
        saveSnapshot(kind, data) {
            if (!Utils.isSafeKind(kind)) return;
            const all = gm.get(Keys.snapshots, null) || Object.create(null);
            const base = (all && typeof all === 'object' && !Array.isArray(all)) ? all : Object.create(null);
            const next = Object.assign(Object.create(null), base);
            next[kind] = { data, ts: Date.now() };
            gm.set(Keys.snapshots, next);
        },
        /** Gabungkan patch ke snapshot kind (mis. supply: {engine|fuel|tyre} per capture). */
        mergeSnapshot(kind, patch) {
            if (!Utils.isSafeKind(kind) || !patch || typeof patch !== 'object') return null;
            const cur = Storage.getSnapshot(kind);
            const safePatch = Object.assign(Object.create(null), patch);
            const data = Object.assign(Object.create(null), (cur && cur.data) || Object.create(null), safePatch);
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
     * Adapter halaman iGP (Fase 3 — dipetakan dari DOM halaman nyata).
     * Aturan main (risiko ToS ditanggung user — COMPLIANCE.md dicabut):
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

            const money = Utils.parseMoney;
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
            const nameOf = el => {
                if (!el) return null;
                const c = el.cloneNode(true);
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
                                const rate = tds[i] ? tds[i].querySelector('.trainingPreviewRate') : null;
                                if (rate) cell(i).recoveryPerHour = intOf(rate.textContent);
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
                        salaryPerRace: money(card.textContent), // angka pertama pada kartu = gaji
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
     * Adapter tab Setup halaman PRA-BALAPAN (v0.7.3, diperbarui v0.7.4 dari
     * capture practice nyata) — read-only. Dipetakan dari capture live DOM
     * (fixture test/fixtures/race.html). Gate: #pageId='race' DAN wadah #setup ada.
     * Membaca field yang memang dirender game: cuaca di c-head form setup
     * (span .waterLevelText + teks °C dari .weatherTemp — bukan badge), slider
     * setup per driver (nilai input + bar ideal via atribut style — bar setebal
     * track = ideal belum dipelajari, TIDAK dikarang) + label arah game (kelas
     * decrease/increase yang baru muncul setelah practice), kondisi mobil
     * (health/condition/engine), komentar engineer, dan tabel practice (baris
     * terakhir: lap/pengaturan/pemakaian/waktu). Tab RACE LIVE (div id="race")
     * tidak pernah dibaca atau diubah — disiplin live-race tetap absolut.
     */
    const IgpRaceSetupAdapter = {
        id: 'race-setup-data',
        desc: 'tab Setup pra-balapan: slider + bar ideal + kondisi mobil (estimasi)',
        captures(doc) {
            const pid = doc.getElementById('pageId');
            if (!pid || pid.value !== 'race') return null;
            const wrap = doc.getElementById('setup');
            if (!wrap) return null;
            const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
            // Nama driver game menyisipkan <br> (mis. "Andi<br>Pratama"); textContent
            // mentah melahap pemisah itu — ganti <br> jadi spasi dulu.
            const nameOf = el => el
                ? clean(String(el.innerHTML).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
                : null;
            const numOrNull = v =>
                ((v != null && String(v) !== '' && Number.isFinite(Number(v))) ? Number(v) : null);
            // Cuaca ada di c-head form setup (#dNSetupWrap): span .waterLevelText
            // (kedalaman air, "0mm") + span .weatherTemp bertanda °C. Catatan: kelas
            // .weatherTemp juga menempel di span air (teks "0mm") — karenanya suhu
            // dicari sebagai teks yang MENGANDUNG "°C", bukan sekadar kelasnya
            // (varian capture live v0.7.4; badge .raceWeatherBadge tidak ada di DOM
            // praktik nyata — jangan dipakai sebagai satu-satunya jangkar).
            const findTemp = root => {
                if (!root) return null;
                for (const el of root.querySelectorAll('.weatherTemp')) {
                    const m = String(el.textContent || '').match(/-?\d+(?:\.\d+)?\s*°C/);
                    if (m) return m[0];
                }
                return null;
            };
            const rainEl = wrap.querySelector('.waterLevelText');
            const rainText = rainEl ? rainEl.textContent : null;
            const tempText = findTemp(wrap);
            const drivers = [];
            for (const n of [1, 2]) {
                const comments = doc.getElementById('d' + n + 'SetupComments');
                // DOM live (capture v0.7.4): KEDUA blok nama berada di bawah
                // #beginner-d1Comments (driver2Include tersembunyi) — tidak ada
                // #beginner-d2Comments. Jangkar lewat kelas include per driver di
                // dalam #setup, bukan per blok komentar.
                const nameEl = doc.querySelector(
                    '#setup .choiceDivInclude.driver' + n + 'Include .driverName');
                const sliders = [];
                for (const el of wrap.querySelectorAll('.setupSliderWrap[id^="d' + n + '"]')) {
                    const idm = String(el.id || '').match(/^d\d(.+)$/);
                    const input = el.querySelector('input');
                    const valEl = el.querySelector('.setupSlider-value');
                    const irange = el.querySelector('.setupSlider-idealRange');
                    const lblEl = el.querySelector('.setupSlider-label');
                    // Kelas arah pada label (decrease/increase) HANYA muncul setelah
                    // game punya data practice — sinyal arah yang dirender game
                    // sendiri, dibaca apa adanya (null = belum ada).
                    const dir = lblEl && lblEl.classList.contains('decrease') ? 'decrease'
                        : (lblEl && lblEl.classList.contains('increase') ? 'increase' : null);
                    sliders.push({
                        key: idm ? idm[1].toLowerCase() : null,
                        label: lblEl ? clean(lblEl.textContent) : null,
                        value: numOrNull(input ? input.getAttribute('value')
                            : (valEl ? valEl.textContent : null)),
                        ideal: IGPCore.parseSliderIdeal(irange ? irange.getAttribute('style') : null),
                        dir: dir,
                    });
                }
                if (!sliders.length) continue;
                const textVal = sel => {
                    const el = comments ? comments.querySelector(sel) : null;
                    return numOrNull(el ? el.textContent : null);
                };
                // Tabel practice: baris data = ≥4 td (baris kosong game cuma 1 td
                // colspan). Baris TERAKHIR disimpan apa adanya (lap/ride/susp/wing/
                // pemakaian bensin, ban, waktu) — angka yang memang dirender game.
                let practiceLaps = 0;
                let practiceLast = null;
                const cellText = el => (el ? clean(el.textContent) : '');
                for (const tr of doc.querySelectorAll('#d' + n + 'Laps tbody tr')) {
                    const tds = tr.querySelectorAll('td');
                    if (tds.length < 4) continue;
                    practiceLaps++;
                    practiceLast = {
                        lap: cellText(tds[0]),
                        ride: cellText(tds[1]),
                        susp: cellText(tds[2]),
                        wing: cellText(tds[3]),
                        fuelUse: tds[4] ? cellText(tds[4]) : null,
                        tyreUse: tds[5] ? cellText(tds[5]) : null,
                        time: tds[6] ? cellText(tds[6]) : null,
                    };
                }
                drivers.push({
                    num: n,
                    name: nameOf(nameEl),
                    sliders: sliders,
                    health: textVal('span[id$="HealthVal"]'),
                    condition: textVal('span[id$="ConditionVal"]'),
                    engine: textVal('span[id$="EngineVal"]'),
                    engineerComment: comments && comments.querySelector('.shrinkText')
                        ? clean(comments.querySelector('.shrinkText').textContent) : null,
                    practiceLaps: practiceLaps,
                    practiceLast: practiceLast,
                });
            }
            if (!drivers.length) return null;
            return {
                weather: { rainText: clean(rainText), tempText: clean(tempText) },
                drivers: drivers,
            };
        },
    };

    /**
     * Adapter tab Strategy halaman PRA-BALAPAN (v0.7.3, diperbarui v0.7.4 dari
     * capture practice nyata) — read-only. Dipetakan dari capture live DOM (fixture
     * test/fixtures/race.html). Gate: #pageId='race' DAN wadah #strategy ada.
     * Membaca field yang memang game-render: #raceLaps, span #rules (JSON
     * aturan liga: refuelling/two_tyres/dll), blok data inerten
     * type="application/json" #dN-StrategyJson (BENER-BENER data JSON game —
     * bukan kode, tidak dieksekusi siapa pun), #dN-FuelPrediction, input
     * bensin opsi lanjutan #dN-AdvancedFuel (atribut value), total laps
     * versi game #dN-TotalLaps, umur ban per compound #dN-TyreLife (JSON game),
     * dan push level default (select[name=pushLevel] tersembunyi). Perhitungan
     * ada di IGPCore.summarizeStrategy.
     */
    const IgpRaceStrategyAdapter = {
        id: 'race-strategy-data',
        desc: 'tab Strategy pra-balapan: stint/fuel/two-tyre (estimasi)',
        captures(doc) {
            const pid = doc.getElementById('pageId');
            if (!pid || pid.value !== 'race') return null;
            if (!doc.getElementById('strategy')) return null;
            const numOrNull = v =>
                ((v != null && String(v) !== '' && Number.isFinite(Number(v))) ? Number(v) : null);
            const textOf = id => {
                const el = doc.getElementById(id);
                return el ? el.textContent : null;
            };
            const attrOf = (id, a) => {
                const el = doc.getElementById(id);
                return el ? el.getAttribute(a) : null;
            };
            const jsonOf = id => {
                const el = doc.getElementById(id);
                if (!el) return null;
                try { return JSON.parse(el.textContent || ''); } catch { return null; }
            };
            return {
                raceLaps: numOrNull(textOf('raceLaps')),
                rules: jsonOf('rules'),
                drivers: [1, 2].map(n => ({
                    num: n,
                    strategy: jsonOf('d' + n + 'StrategyJson'),
                    fuelPerLap: numOrNull(textOf('d' + n + 'FuelPrediction')),
                    advancedFuel: numOrNull(attrOf('d' + n + 'AdvancedFuel', 'value')),
                    totalLapsGame: numOrNull(textOf('d' + n + 'TotalLaps')),
                    // Umur ban per compound dari game ({"SS":12}); [] / {} / hilang = belum ada.
                    tyreLife: jsonOf('d' + n + 'TyreLife'),
                    // Push level default (select disembunyikan game, diganti slider
                    // visual) — nilai terpilih berasal dari game, dibaca apa adanya.
                    pushLevel: (sel => (sel ? numOrNull(sel.value) : null))(
                        doc.querySelector('#d' + n + 'strategyAdvanced select[name="pushLevel"]')),
                })),
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
            { id: 'staff-data', adapter: IgpStaffAdapter },
            { id: 'transfers-data', adapter: IgpTransfersAdapter },
            { id: 'race-setup-data', adapter: IgpRaceSetupAdapter },
            { id: 'race-strategy-data', adapter: IgpRaceStrategyAdapter },
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
                    } catch { /* biarkan tanpa konteks */ }
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

        const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
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

        const fmtMoney = Utils.fmtMoney; // satu format uang untuk Advisor & GUI

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

        /* ---- Snapshot tim & pasar (v0.8.0) — dasar panel Decision Compare ---- */

        function teamHtml(t) {
            if (!t) return '<span class="hint">belum ada — buka halaman <em>Drivers &amp; Staff</em> di tab iGP, lalu klik “Capture team”.</span>';
            const d = t.data || {};
            const drivers = d.drivers || [];
            const cards = d.staffCards || [];
            let html = '';
            if (drivers.length) {
                const rows = drivers.map(x =>
                    '<tr><td>' + esc(x.name || '?') + '</td>' +
                    '<td class="num">' + (x.ability != null ? esc(x.ability) + '%' : '—') + '</td>' +
                    '<td class="num">' + (x.mental != null ? esc(x.mental) + '%' : '—') + '</td>' +
                    '<td class="num">' + esc(x.statIndex != null ? x.statIndex : '—') + '</td>' +
                    '<td class="num">' + fmtMoney(x.salaryPerRace) + '</td></tr>').join('');
                html += '<table><tr><th>Driver</th><th>Ability</th><th>Mental</th><th>Indeks stat</th><th>Gaji</th></tr>' + rows + '</table>';
            } else {
                html += '<div class="hint">driver aktif belum terbaca</div>';
            }
            if (cards.length) {
                const rows = cards.map(c =>
                    '<tr><td>' + esc(c.role || '?') + '</td><td>' + esc(c.name || '?') + '</td>' +
                    '<td class="num">' + fmtMoney(c.salaryPerRace) + '</td></tr>').join('');
                html += '<div style="margin-top:10px"><table><tr><th>Peran</th><th>Staff</th><th>Gaji</th></tr>' + rows + '</table></div>';
            }
            if (d.pitLocked) html += '<div class="hint">Pit crew: ' + esc(d.pitLocked) + '</div>';
            return html + '<div class="hint">tangkap ' + esc(new Date(t.ts).toLocaleTimeString()) + '</div>';
        }

        function marketHtml(m) {
            if (!m) return '<span class="hint">belum ada — buka halaman <em>Transfers</em> di tab iGP, lalu klik “Capture market”.</span>';
            const d = m.data || {};
            const tbox = (key, label) => {
                const arr = d[key] || [];
                if (!arr.length) return '<div class="hint">' + esc(label) + ': belum tercapture</div>';
                const rows = arr.map(x =>
                    '<tr><td>' + esc(x.name || '?') + '</td>' +
                    '<td>' + esc(key === 'staff' ? (x.role || '—') : (x.age != null ? x.age + ' th' : '—')) + '</td>' +
                    '<td class="num">' + (x.overall != null ? esc(x.overall) : '—') + '</td>' +
                    '<td class="num">' + esc(x.statIndex != null ? x.statIndex : '—') + '</td>' +
                    '<td class="num">' + fmtMoney(x.fee) + '</td>' +
                    '<td class="num">' + fmtMoney(x.wage) + '</td></tr>').join('');
                return '<div class="hint">' + esc(label) + ' — ' + arr.length + ' baris</div>' +
                    '<div style="max-height:240px;overflow:auto"><table>' +
                    '<tr><th>Nama</th><th>' + (key === 'staff' ? 'Peran' : 'Umur') + '</th><th>Overall</th>' +
                    '<th>Indeks stat</th><th>Fee</th><th>Gaji</th></tr>' + rows + '</table></div>';
            };
            return tbox('drivers', 'Driver di pasar') +
                '<div style="margin-top:10px">' + tbox('staff', 'Staff di pasar') + '</div>' +
                '<div class="hint">tangkap ' + esc(new Date(m.ts).toLocaleTimeString()) +
                (d.refreshIn ? ' · lelang refresh: ' + esc(d.refreshIn) : '') + '</div>';
        }

        /* Decision Compare (v0.8.0) — roster & supplier vs luar, verdict
           lebih bagus / lebih buruk / sama. Angka = bacaan DOM apa adanya. */
        const CMP_VERDICT = {
            better: { sym: '▲', txt: 'lebih bagus', cls: 'cmp-better' },
            worse: { sym: '▼', txt: 'lebih buruk', cls: 'cmp-worse' },
            equal: { sym: '≈', txt: 'sama', cls: 'cmp-equal' },
            unknown: { sym: '?', txt: 'tak terbaca', cls: 'cmp-unknown' },
        };
        const CMP_ROLE = { CD: 'Chief Designer', TD: 'Technical Director', DR: 'Doctor', DRV: 'Driver' };
        function cmpChip(verdict, axisTxt) {
            const v = CMP_VERDICT[verdict] || CMP_VERDICT.unknown;
            return '<span class="cmp-chip ' + v.cls + '">' + v.sym + ' ' + esc(v.txt) +
                (axisTxt ? ' <span class="cmp-axis">(' + esc(axisTxt) + ')</span>' : '') + '</span>';
        }
        function cmpDetail(now, ref, fmt) {
            const f = fmt || (x => (x == null ? '—' : String(x)));
            return '<span class="cmp-detail">' + f(now) + ' → ' + (ref ? f(ref.value) + ' · ' + esc(ref.name || '?') : '—') + '</span>';
        }
        const cmpScore = n => (n == null ? '—' : (Math.round(n * 10) / 10) + '%');

        function rosterRows(source, isMarket) {
            const out = [];
            if (!source) return out;
            const mapOver = (list, role) => (list || []).forEach(x => {
                if (!x || x.name == null) return;
                out.push({
                    key: (role === 'DRV' ? 'DRV-' : 'ROLE-') + (x.id != null ? x.id : x.name),
                    name: x.name,
                    role: role,
                    rating: x.statIndex,
                    costPerRace: isMarket ? x.wage : x.salaryPerRace,
                    fee: x.fee,
                });
            });
            mapOver(source.drivers, 'DRV');
            (source.staffCards || []).forEach(c => {
                if (!c || c.name == null) return;
                out.push({
                    key: 'ROLE-' + (c.role || c.name),
                    name: c.name,
                    role: Utils.roleCode(c.role),
                    rating: null, // kartu Teams tanpa CSV → jujur 'tak terbaca'
                    costPerRace: c.salaryPerRace,
                });
            });
            (source.staff || []).forEach(x => {
                if (!x || x.name == null) return;
                out.push({
                    key: 'ROLE-' + (x.id != null ? x.id : x.name),
                    name: x.name,
                    role: Utils.roleCode(x.role),
                    rating: x.statIndex,
                    costPerRace: x.wage,
                    fee: x.fee,
                });
            });
            return out;
        }

        function renderCompare() {
            const box = $('igpas-compare-body');
            const st = $('igpas-compare-status');
            if (!box) return;
            const teamSnap = Storage.getSnapshot('staff-data');
            const txSnap = Storage.getSnapshot('transfers-data');
            const parts = [];
            if (teamSnap && teamSnap.data) parts.push(rosterRows(teamSnap.data, false));
            const current = parts.length ? parts[0] : [];
            const market = (txSnap && txSnap.data) ? rosterRows(txSnap.data, true) : [];
            const res = IGPCore.compareRoster({ current: current, market: market });

            if (!res.ok) {
                const why = !teamSnap ? 'snapshot <strong>team</strong> belum ada'
                    : !txSnap ? 'snapshot <strong>market</strong> belum ada'
                        : esc(res.error);
                box.innerHTML = '<p class="cmp-summary">Bandingkan: ' + why +
                    '. Ambil keduanya lewat tombol di atas (tab iGP harus di halaman yang sesuai).</p>';
                if (st) st.textContent = 'menunggu snapshot…';
                return;
            }
            const v = res.values;
            const rows = v.rows.map(r => {
                const roleTxt = CMP_ROLE[r.role] || r.role || '—';
                return '<tr class="' + (CMP_VERDICT[r.verdict] || CMP_VERDICT.unknown).cls + '">' +
                    '<td>' + esc(roleTxt) + '</td>' +
                    '<td>' + esc(r.name) + '</td>' +
                    '<td>' + cmpChip(r.rating.verdict, 'indeks stat') + cmpDetail(r.rating.now, r.refRating, cmpScore) + '</td>' +
                    '<td>' + cmpChip(r.cost.verdict, 'gaji') + cmpDetail(r.cost.now, r.refCost, fmtMoney) + '</td>' +
                    '<td class="num">' + (r.refFee ? fmtMoney(r.refFee.value) : '—') + '</td>' +
                    '<td>' + esc(r.refName || '—') + '</td></tr>';
            }).join('');
            const counts = v.counts;
            box.innerHTML =
                '<p class="cmp-summary">Ringkas: <span class="cmp-chip cmp-better">▲ ' + counts.better +
                ' lebih bagus</span> <span class="cmp-chip cmp-worse">▼ ' + counts.worse +
                ' lebih buruk</span> <span class="cmp-chip cmp-equal">≈ ' + counts.equal +
                ' sama</span> <span class="cmp-chip cmp-unknown">? ' + counts.unknown +
                ' tak terbaca</span> — pasar ' + v.marketCount + ' baris.</p>' +
                '<table><tr><th>Peran</th><th>Milik Anda</th><th>Indeks stat</th><th>Gaji/balapan</th>' +
                '<th>Fee termurah</th><th>Pembanding teratas</th></tr>' + rows + '</table>' +
                '<div class="hint" style="margin-top:10px">Indeks stat = rata-rata 12 angka CSV pada kolom rating ' +
                '(<strong>bukan overall game</strong> — game membulatkan per stat, jadi angkanya beda tipis dari kolom ' +
                'Overall/Fee). "≈ sama" = selisih ≤2%. Verdict memakai sumbu rating bila kedua sisi punya angka ' +
                '(pembanding = nilai terbaik di pasar), selainnya sumbu gaji. Fee tanda tangan ditampilkan sebagai info, ' +
                'tidak dinilai — biaya sekali bayar tidak sebanding dengan gaji per balapan.' +
                (v.ratingUnknown ? ' ' + v.ratingUnknown + ' baris roster tanpa angka indeks (kartu Teams tidak memuat CSV).' : '') +
                '<br>Toleransi &amp; pembanding bersifat heuristik: <strong>estimasi — bukan rumus game</strong>; ' +
                'keputusan transfer tetap milik Anda.</div>';
            if (st) st.textContent = 'dibandingkan ' + new Date().toLocaleTimeString() + '.';
        }

        // ---- Autoload & deteksi (v0.5.1) ----
        const KIND_LABEL = { 'account-data': 'akun', 'car-data': 'mobil', 'supply-data': 'supply', 'manufacturer-data': 'manufacturers', 'staff-data': 'tim', 'transfers-data': 'pasar' };
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
            if (badge) {badge.textContent =
                (a ? 'akun ✓' : 'akun –') + ' · ' + (c ? 'mobil ✓' : 'mobil –') +
                ' · supply ' + sCount + '/3' + ' · mfr ' + mfrCount + '/2' +
                ' · tim ' + (Storage.getSnapshot('staff-data') ? '✓' : '–') +
                ' · pasar ' + (Storage.getSnapshot('transfers-data') ? '✓' : '–');}

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

            // v0.8.0 — roster tim & pasar + panel Decision Compare
            const teamSnap = Storage.getSnapshot('staff-data');
            const txSnap = Storage.getSnapshot('transfers-data');
            const teamBody = $('igpas-snap-team-body');
            if (teamBody) teamBody.innerHTML = teamHtml(teamSnap);
            const marketBody = $('igpas-snap-market-body');
            if (marketBody) marketBody.innerHTML = marketHtml(txSnap);
            renderCompare();
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
            if (capSup) {capSup.addEventListener('click', () =>
                requestCollect(['supply-data'], 'Capture supply', ' — buka dialog Supply dulu di tab iGP'));}
            const capMfr = $('igpas-snap-capture-manufacturers');
            if (capMfr) {capMfr.addEventListener('click', () =>
                requestCollect(['manufacturer-data'], 'Capture manufacturers', ' — buka halaman Manufacturers dulu di tab iGP'));}
            const capTeam = $('igpas-snap-capture-staff');
            if (capTeam) {capTeam.addEventListener('click', () =>
                requestCollect(['staff-data'], 'Capture team', ' — buka halaman Drivers & Staff dulu di tab iGP'));}
            const capTx = $('igpas-snap-capture-transfers');
            if (capTx) {capTx.addEventListener('click', () =>
                requestCollect(['transfers-data'], 'Capture market', ' — buka halaman Transfers dulu di tab iGP'));}

            // Decision Compare (v0.8.0): ambil kedua sisi lalu bandingkan.
            const cmpTeam = $('igpas-compare-capture-team');
            if (cmpTeam) {cmpTeam.addEventListener('click', () =>
                requestCollect(['staff-data'], 'Roster', ' — buka halaman Drivers & Staff dulu di tab iGP'));}
            const cmpMarket = $('igpas-compare-capture-market');
            if (cmpMarket) {cmpMarket.addEventListener('click', () =>
                requestCollect(['transfers-data'], 'Pasar', ' — buka halaman Transfers dulu di tab iGP'));}
            const cmpRun = $('igpas-compare-run');
            if (cmpRun) cmpRun.addEventListener('click', renderCompare);

            const clr = $('igpas-snap-clear');
            if (clr) {clr.addEventListener('click', () => {
                Storage.clearSnapshots();
                const st = $('igpas-snap-status');
                if (st) st.textContent = 'snapshot dihapus.';
                renderSnapshots();
            });}

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
     *  - Aktif di #pageId 'cars' (termasuk dialog Supply terbuka),
     *    'manufacturers', 'staff', 'transfers' — dan, sejak v0.7.3 (permintaan
     *    eksplisit user), halaman PRA-BALAPAN #pageId 'race' hanya di tab
     *    Setup & Strategy (panel estimasi read-only). TAB RACE LIVE (#race)
     *    TETAP TANPA UI APA PUN; tanpa klik/submit elemen game, di mana pun.
     *  - Re-render dipicu aksi user (klik/navigasi) — BUKAN polling DOM.
     *  - Semua angka = pembacaan DOM yang memang tampil + heuristik eksplisit
     *    IGPCore, berlabel "estimasi — bukan rumus game".
     * ===================================================================== */
    const Advisor = (() => {
        const PREFIX = 'igpas-adv';
        const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const fmtMoney = Utils.fmtMoney; // satu format uang untuk Advisor & GUI
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
            '.igpas-adv-verdict{display:inline-block;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:700;white-space:nowrap}',
            '.igpas-adv-v-better{background:#1f7a5c;color:#eafff7}',
            '.igpas-adv-v-worse{background:#8c2f2f;color:#ffecec}',
            '.igpas-adv-v-equal{background:#5a6a78;color:#f2f6f9}',
            '.igpas-adv-v-unknown{background:#4a4a4a;color:#e8e8e8}',
            '.igpas-adv-axis{font-weight:400;opacity:.8}',
            '.igpas-adv-refname{color:#bcd8d2}',
            '.igpas-adv-cmp{margin-top:3px;font-size:10px;color:#bcd8d2}',
            '.igpas-adv-inline{display:inline-block;margin-left:8px;padding:1px 7px;border-radius:8px;background:#8fd6c6;color:#0b262b;font-size:10px;font-weight:700;white-space:nowrap;vertical-align:middle}',
            '.igpas-adv-inline-head{display:inline-block;margin-left:8px;padding:1px 7px;border-radius:8px;background:transparent;border:1px solid #8fd6c6;color:#8fd6c6;font-size:10px;font-weight:700;letter-spacing:.08em;vertical-align:middle}',
            '.igpas-adv-panel tr.igpas-adv-row-better td:first-child{border-left:3px solid #1f7a5c}',
            '.igpas-adv-panel tr.igpas-adv-row-worse td:first-child{border-left:3px solid #8c2f2f}',
            '.igpas-adv-panel tr.igpas-adv-row-unknown td{color:#a9a9a9}',
            '.igpas-adv-panel tr.igpas-adv-best td{background:rgba(143,214,198,.16);font-weight:700}',
            '#igpas-adv-toggle{position:fixed;left:12px;bottom:12px;z-index:2147483000;padding:8px 12px;',
            'border:2px solid #0b262b;border-radius:20px;background:#0e2a30;color:#eaf6f3;',
            'font:700 12px Arial,Helvetica,sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.3)}',
            'body.igpas-adv-hide .igpas-adv-panel{display:none!important}',
            'body.igpas-adv-hide .igpas-adv-inline,body.igpas-adv-hide .igpas-adv-inline-head{display:none!important}',
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

        /** Satu-satunya jalur mount ber-wrapper: ambil-atau-buat wrapper lalu pasang panel idempoten. */
        function mountWrapped(anchor, idWrap, panel) {
            let wrapEl = document.getElementById(idWrap);
            if (!wrapEl) {
                wrapEl = document.createElement('div');
                wrapEl.id = idWrap;
                wrapEl.style.clear = 'both'; // aman di bawah kolom float tab setup/strategy
            }
            wrapEl.appendChild(panel);
            anchor.appendChild(wrapEl);
        }

        function removeIfAny(ids) {
            for (const id of ids) {
                const el = document.getElementById(id);
                if (el) el.remove();
            }
        }

        /* --- perbandingan keputusan (v0.8.0): label verdict yang konsisten --- */
        const VERDICT = {
            better: { sym: '▲', txt: 'lebih bagus', cls: 'igpas-adv-v-better' },
            worse: { sym: '▼', txt: 'lebih buruk', cls: 'igpas-adv-v-worse' },
            equal: { sym: '≈', txt: 'sama', cls: 'igpas-adv-v-equal' },
            unknown: { sym: '?', txt: 'tak terbaca', cls: 'igpas-adv-v-unknown' },
        };
        const ROLE_LABEL = { CD: 'Chief Designer', TD: 'Technical Director', DR: 'Doctor', DRV: 'Driver' };
        function vChip(verdict, axisTxt) {
            const v = VERDICT[verdict] || VERDICT.unknown;
            return '<span class="igpas-adv-verdict ' + v.cls + '">' + v.sym + ' ' + esc(v.txt) +
                (axisTxt ? ' <span class="igpas-adv-axis">(' + esc(axisTxt) + ')</span>' : '') + '</span>';
        }
        /** Pembanding angka eksplisit: "54 → 54 (B Bianchi)" — tanpa angka = '—'. */
        function refTxt(ref, valueFmt) {
            if (!ref) return '—';
            const val = (valueFmt || String)(ref.value);
            return '<strong>' + esc(val) + '</strong> ' +
                '<span class="igpas-adv-refname">' + esc(ref.name || '?') + '</span>';
        }
        const scoreTxt = n => (n == null ? '—' : (Math.round(n * 10) / 10) + '%');

        /* Halaman Cars: prioritas alokasi design points vs benchmark liga.
         * IN-PLACE (tanpa section terpisah saat sukses): badge usulan DP
         * disisipkan ke dalam baris ASLI game (#wrap-{key} .attribute-rating-header).
         * Hanya append node milik sendiri (.igpas-adv-inline) — nilai & bar game
         * tidak pernah diubah/dihapus. Idempoten: bersihkan dulu sebelum sisip. */
        function mountDesign() {
            const id = PREFIX + '-design'; // panel fallback hanya untuk jalur gagal
            const cleanInline = () => {
                const olds = document.querySelectorAll('.igpas-adv-inline, .igpas-adv-inline-head');
                for (const el of olds) el.remove();
            };
            const anchor = (pageId() === 'cars') ? document.getElementById('carAttributesDisplay') : null;
            if (!anchor) { cleanInline(); removeIfAny([id]); return; }
            const data = IgpCarsAdapter.captures(document);
            const res = IGPCore.designPriority({
                attrs: data && data.attrs,
                best: data && data.best,
                designPoints: data && data.designPoints,
            });
            if (!res.ok) {
                // Gagal jujur: tanpa angka tidak ada badge; tampilkan note kecil
                // (satu-satunya kasus panel terpisah masih dipakai di halaman Cars).
                cleanInline();
                anchor.insertAdjacentElement('afterend',
                    panelEl(id, 'I.G.P.A.S · design points', 'Prioritas alokasi DP (estimasi)', '', esc(res.error) + '.'));
                return;
            }
            // Sukses: pastikan tidak ada sisa panel error + badge lama.
            removeIfAny([id]);
            cleanInline();
            const dpTotal = res.values.designPoints;
            // Legenda ringkas di header game (append, bukan ganti isi).
            try {
                const head = document.querySelector('#carAttributes .c-head h2, #carAttributes .c-head');
                if (head && !head.querySelector('.igpas-adv-inline-head')) {
                    const legend = document.createElement('span');
                    legend.className = 'igpas-adv-inline-head';
                    legend.textContent = 'I.G.P.A.S · usulan DP (estimasi)';
                    legend.title = 'Total DP: ' + (dpTotal != null ? dpTotal : '?') +
                        ' · porsi % = share gap ke Max liga — estimasi, bukan rumus game.' +
                        (res.values.unbenchmarked ? ' ' + res.values.unbenchmarked + ' atribut tanpa benchmark liga.' : '');
                    head.appendChild(legend);
                }
            } catch { /* legenda opsional — badge per baris tetap jalan */ }
            res.values.ranked.forEach((r, i) => {
                if (r.key == null || !/^[A-Za-z0-9_-]+$/.test(String(r.key))) return;
                let header = null;
                try {
                    const row = document.getElementById('wrap-' + r.key);
                    header = row ? row.querySelector('.attribute-rating-header') : null;
                } catch { header = null; }
                if (!header) return;
                const share = (r.sharePct != null ? r.sharePct : 0);
                const dpEst = (dpTotal != null) ? Math.round(dpTotal * share / 100) : null;
                const badge = document.createElement('span');
                badge.className = 'igpas-adv-inline';
                badge.textContent = '#' + (i + 1) + ' · ' +
                    (dpEst != null ? dpEst + ' DP (' + share + '%)' : share + '%');
                badge.title = 'Prioritas #' + (i + 1) + ' — ' + r.label + ': ' + r.val +
                    ' → max liga ' + (r.max == null ? '—' : r.max) +
                    ' (gap ' + (r.gap == null ? '—' : r.gap) + '). ' +
                    'Usulan ' + (dpEst != null ? '±' + dpEst + ' DP dari ' + dpTotal + ' DP' : share + '% porsi gap') +
                    ' — estimasi, bukan rumus game.';
                header.appendChild(badge);
            });
        }

        /* Dialog Supply (engine/fuel/tyre): bandingkan supplier aktif vs alternatif. */
        function mountSupply() {
            const id = PREFIX + '-supply';
            const idCmp = PREFIX + '-supply-compare';
            const dlg = document.querySelector('.supplyDialog');
            if (!dlg) { removeIfAny([id, idCmp]); return; }
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
            mountSupplyCompare(s);
        }

        /* Supplier AKTIF vs alternatif di dialog yang sama (v0.8.0) —
           satu halaman, satu snapshot: tidak perlu data dari luar. */
        function mountSupplyCompare(s) {
            const id = PREFIX + '-supply-compare';
            const dlg = document.querySelector('.supplyDialog');
            if (!dlg || !s) { removeIfAny([id]); return; }
            if (!s.current || !Array.isArray(s.alternatives) || !s.alternatives.length) { removeIfAny([id]); return; }
            const res = IGPCore.compareSuppliers({ current: s.current, alternatives: s.alternatives });
            let body = '';
            let note = '';
            if (!res.ok) {
                note = esc(res.error) + '.';
            } else {
                const v = res.values;
                const sumTxt = x => (x == null ? '—' : (x > 0 ? '+' : '') + x);
                body = '<table><thead><tr><th>Sumbu</th><th>Supplier aktif</th><th>Pembanding di dialog</th><th>Verdict</th></tr></thead><tbody>' +
                    '<tr><td>Σ bonus</td><td>' + esc(sumTxt(v.current.bonus)) + '</td>' +
                    '<td>' + (v.bestBonus ? esc(sumTxt(v.bestBonus.value)) +
                        ' <span class="igpas-adv-refname">#' + esc(v.bestBonus.id != null ? v.bestBonus.id : '?') + '</span>' : '—') +
                    '</td><td>' + vChip(v.bonus.verdict, 'naik = bagus') + '</td></tr>' +
                    '<tr><td>Biaya/balapan</td><td>' + fmtMoney(v.current.cost) + '</td>' +
                    '<td>' + (v.cheapest ? fmtMoney(v.cheapest.value) +
                        ' <span class="igpas-adv-refname">#' + esc(v.cheapest.id != null ? v.cheapest.id : '?') + '</span>' : '—') +
                    '</td><td>' + vChip(v.cost.verdict, 'turun = bagus') + '</td></tr>' +
                    '</tbody></table>';
                note = 'Verdict akhir memakai sumbu ' + esc(v.basis) + ' (sumbu lain tetap ditampilkan apa adanya). ' +
                    'Pembanding = Σ bonus TERTINGGI dan biaya TERENDAH di antara alternatif dialog ini — ' +
                    'bukan pasar luar. Σ bonus menjumlahkan stat berbeda tanpa bobot rumus game, jadi ini ' +
                    '<strong>perbandingan, bukan kepastian performa — estimasi, bukan rumus game</strong>.';
            }
            dlg.appendChild(panelEl(id, 'I.G.P.A.S · supply vs aktif', 'Supplier aktif vs alternatif dialog', body, note));
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
                const note = pagerNote + ' Rating% dari tooltip tabel; rating/1M = heuristik estimasi — bukan rumus game.';
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

        /* Halaman Drivers & Staff: kondisi tim aktif (read-only, jujur). */
        function mountTeam() {
            const id = PREFIX + '-team';
            const idCmp = PREFIX + '-team-compare';
            if (pageId() !== 'staff') { removeIfAny([id, idCmp]); return; }
            const anchor = document.getElementById('drivers');
            if (!anchor) { removeIfAny([id, idCmp]); return; }
            const s = IgpStaffAdapter.captures(document);
            let body = '';
            let note = '';
            if (s && s.drivers && s.drivers.length) {
                const rows = s.drivers.map(d => {
                    if (!d || d.name == null) return '';
                    const low = d.health != null && d.health < 30;
                    const tags =
                        (low ? '<span class="igpas-adv-tag">sehat rendah — pulihkan dulu</span>' : '') +
                        (d.recoveryPerHour != null ? ' <span class="igpas-adv-tag">+~' + esc(d.recoveryPerHour) + '/jam</span>' : '');
                    return '<tr' + (low ? ' class="igpas-adv-best"' : '') + '>' +
                        '<td>' + esc(d.name) + tags + '</td>' +
                        '<td>' + (d.ability != null ? esc(d.ability) + '%' : '—') + '</td>' +
                        '<td>' + (d.mental != null ? esc(d.mental) + '%' : '—') + '</td>' +
                        '<td>' + (d.health != null ? esc(d.health) + '%' : '—') + '</td>' +
                        '<td>' + (d.salaryPerRace != null ? fmtMoney(d.salaryPerRace) : '—') + '</td></tr>';
                }).join('');
                if (rows) {
                    body += '<table><thead><tr><th>Driver aktif</th><th>Ability</th><th>Mental</th><th>Health</th><th>Gaji</th></tr></thead><tbody>' + rows + '</tbody></table>';
                }
            }
            if (s && s.staffCards && s.staffCards.length) {
                const rows2 = s.staffCards.map(c =>
                    '<tr><td>' + esc(c.role || '?') + '</td><td>' + esc(c.name || '?') + '</td>' +
                    '<td>' + (c.salaryPerRace != null ? fmtMoney(c.salaryPerRace) : '—') + '</td>' +
                    '<td>' + esc(c.contract || '—') + '</td></tr>').join('');
                body += '<table><thead><tr><th>Peran</th><th>Staff aktif</th><th>Gaji</th><th>Kontrak</th></tr></thead><tbody>' + rows2 + '</tbody></table>';
            }
            if (s && s.pitLocked) {
                note += 'Pit crew: ' + esc(s.pitLocked) + ' ';
            }
            note += 'Kartu staff di halaman ini tidak menampilkan angka rating (bintang relatif level) - ' +
                'angka kandidat lengkap ada di halaman Transfers. Health driver rendah: hanya info read-only - ' +
                'keputusan heal (berbiaya token) tetap milik Anda. Estimasi, bukan rumus game.';
            const teamPanel = panelEl(id, 'I.G.P.A.S · team', 'Kondisi driver & staff aktif (estimasi)', body, note);
            anchor.insertAdjacentElement('afterend', teamPanel);
            mountTeamCompare(teamPanel, s);
        }

        /**
         * Perbandingan roster aktif vs pasar (v0.8.0) — memakai DUA snapshot
         * yang sudah ada (staff-data + transfers-data dari menu Capture GUI),
         * bukan pembacaan baru: Advisor tetap 0 request mailbox.
         * Sumbu rating memakai indeks 12-stat dari CSV `data-driver`/`data-staff`
         * yang bentuknya identik di kedua halaman — angka ini BUKAN overall game
         * (lihat catatan panel), dan roster halaman Teams hanya memuat
         * ability/mental sehingga sisi itu umumnya 'tak terbaca' sampai user
         * mengirim capture Transfers untuk dirinya sendiri.
         */
        function mountTeamCompare(teamPanel, s) {
            const id = PREFIX + '-team-compare';
            if (!teamPanel || !teamPanel.parentNode) { removeIfAny([id]); return; }
            const txSnap = Storage.getSnapshot('transfers-data');
            const roster = (s && ((s.drivers && s.drivers.length) || (s.staffCards && s.staffCards.length))) ? s : null;
            if (!roster) { removeIfAny([id]); return; }

            let body = '';
            let note = '';
            if (!txSnap || !txSnap.data) {
                note = 'Belum ada snapshot pasar. Buka Command Center → <em>Capture</em> saat tab iGP di ' +
                    'halaman <em>Transfers</em>, lalu kembali ke halaman ini — panel ini membaca snapshot ' +
                    'tersimpan (tanpa permintaan baru, tanpa poll).';
            } else {
                const current = [];
                for (const d of (s.drivers || [])) {
                    if (!d || d.name == null) continue;
                    current.push({
                        key: 'DRV-' + (d.id != null ? d.id : d.name),
                        name: d.name,
                        role: 'DRV',
                        rating: d.statIndex,
                        costPerRace: d.salaryPerRace,
                    });
                }
                for (const c of (s.staffCards || [])) {
                    if (!c || c.name == null) continue;
                    current.push({
                        key: 'ROLE-' + (c.role || c.name),
                        name: c.name,
                        role: Utils.roleCode(c.role),
                        rating: null, // kartu staff Teams tidak memuat CSV → tak terbaca, ditulis jujur
                        costPerRace: c.salaryPerRace,
                    });
                }
                const market = [];
                for (const d of (txSnap.data.drivers || [])) {
                    market.push({
                        key: 'DRV-' + d.id,
                        name: d.name,
                        role: 'DRV',
                        rating: d.statIndex,
                        costPerRace: d.wage,
                        fee: d.fee,
                    });
                }
                for (const m of (txSnap.data.staff || [])) {
                    market.push({
                        key: 'ROLE-' + m.id,
                        name: m.name,
                        role: Utils.roleCode(m.role),
                        rating: m.statIndex,
                        costPerRace: m.wage,
                        fee: m.fee,
                    });
                }
                const res = IGPCore.compareRoster({ current: current, market: market, ratingLabel: 'indeks stat', costLabel: 'gaji/balapan' });
                if (!res.ok) {
                    note = esc(res.error) + '.';
                } else {
                    const v = res.values;
                    const rows = v.rows.map(r => {
                        const roleTxt = ROLE_LABEL[r.role] || r.role || '—';
                        return '<tr class="igpas-adv-row-' + esc(r.verdict) + '">' +
                            '<td>' + esc(r.name) + '<span class="igpas-adv-tag">' + esc(roleTxt) + '</span></td>' +
                            '<td>' + vChip(r.rating.verdict, 'indeks stat') +
                            '<div class="igpas-adv-cmp">' + scoreTxt(r.rating.now) + ' → ' + refTxt(r.refRating, scoreTxt) + '</div></td>' +
                            '<td>' + vChip(r.cost.verdict, 'gaji') +
                            '<div class="igpas-adv-cmp">' + fmtMoney(r.cost.now) + ' → ' + refTxt(r.refCost, fmtMoney) + '</div></td>' +
                            '<td>' + fmtMoney(r.refFee ? r.refFee.value : null) + '</td>' +
                            '<td>' + esc(r.refName || '—') + '</td></tr>';
                    }).join('');
                    body = '<table><thead><tr><th>Roster aktif</th><th>Indeks stat vs pasar</th>' +
                        '<th>Gaji vs pasar</th><th>Fee termurah</th><th>Pembanding teratas</th></tr></thead><tbody>' +
                        rows + '</tbody></table>';
                    note = 'Ringkas: ' +
                        v.counts.better + ' lebih bagus · ' + v.counts.worse + ' lebih buruk · ' +
                        v.counts.equal + ' sama · ' + v.counts.unknown + ' tak terbaca ' +
                        '(pasar ' + v.marketCount + ' baris). ';
                    if (v.ratingUnknown) {
                        note += v.ratingUnknown + ' baris tanpa angka di sumbu rating (baris itu verdict-nya ' +
                            'memakai sumbu gaji). Kartu staff di halaman Teams hanya menampilkan bintang — ' +
                            'tanpa angka, jadi tidak bisa dibandingkan; CSV <code>data-staff</code> di pasar ' +
                            'pun hanya 5 angka (di bawah 12 yang dibutuhkan indeks), jadi sisi staff memang ' +
                            'tak terbaca dari kedua halaman. ';
                    }
                    note += 'Indeks stat = rata-rata 12 angka CSV <code>data-driver</code>/<code>data-staff</code>, ' +
                        '(dibulatkan per stat oleh game) — <strong>bukan overall game</strong>: di baris pasar ' +
                        'angkanya memang beda tipis dari kolom Overall/Fee. Angka dibandingkan <em>apa adanya</em> — ' +
                        'perhatikan kolom "nilai → pembanding": bila kedua halaman menampilkan skala yang jauh ' +
                        'berbeda, selisihnya ikut terlihat di situ dan verdict-nya tidak bermakna; ' +
                        'periksa dulu sebelum memakai hasilnya. Toleransi "sama" = 2%. ' +
                        'Verdict = pembanding, bukan kepastian performa — <strong>estimasi, bukan rumus game</strong>.';
                }
            }
            teamPanel.insertAdjacentElement('afterend',
                panelEl(id, 'I.G.P.A.S · banding roster', 'Roster aktif vs pasar — lebih bagus / lebih buruk / sama', body, note));
        }

        /* Halaman Transfers: pasar driver & staff yang tampil di tabel. */
        function mountTransfers() {
            const idD = PREFIX + '-tx-driver';
            const idS = PREFIX + '-tx-staff';
            const idC = PREFIX + '-tx-compare';
            if (pageId() !== 'transfers') { removeIfAny([idD, idS, idC]); return; }
            const m = IgpTransfersAdapter.captures(document);
            const dT = document.getElementById('driver-table');
            if (dT) {
                // kontrak helper: ratingPct/costPerRace — map dari overall/fee pasar
                const res = IGPCore.rankManufacturerItems({
                    items: (m ? m.drivers : []).map(d => ({ id: d.id, name: d.name, ratingPct: d.overall, costPerRace: d.fee })),
                    withCost: true,
                });
                let body = '';
                if (res.ok) {
                    const byId = {};
                    for (const d of m.drivers) byId[d.id] = d;
                    const rows = res.values.ranked.slice(0, 5).map((r, i) => {
                        const src = byId[r.id] || {};
                        const t = IGPCore.parseTraits(src.traitsHtml);
                        const tags =
                            (i === 0 ? '<span class="igpas-adv-tag">rating tertinggi</span>' : '') +
                            (res.values.bestValueId === r.id ? '<span class="igpas-adv-tag">nilai terbaik</span>' : '') +
                            (t.special.length ? '<span class="igpas-adv-tag">' + esc(t.special.join(', ')) + '</span>' : '');
                        return '<tr' + (i === 0 ? ' class="igpas-adv-best"' : '') + '>' +
                            '<td>' + (i + 1) + '. ' + esc(r.name) + (src.age != null ? ' (' + esc(src.age) + ' th)' : '') + tags + '</td>' +
                            '<td>' + (r.rating != null ? esc(r.rating) : '—') + '</td>' +
                            '<td>' + fmtMoney(r.cost) + '</td>' +
                            '<td>' + (r.ratingPerCost == null ? '—' : esc(r.ratingPerCost)) + '</td></tr>';
                    }).join('');
                    body = '<table><thead><tr><th>Driver di pasar</th><th>Overall</th><th>Fee</th><th>Overall/1M</th></tr></thead><tbody>' + rows + '</tbody></table>';
                } else {
                    body = '<p class="igpas-adv-note">' + esc(res.error) + '.</p>';
                }
                const note = 'Overall/fee/wage diambil dari kolom tabel yang memang tampil; bintang rating iGP relatif ' +
                    'terhadap level Anda. Pasar berubah sendiri (refresh lelang ' +
                    (m && m.refreshIn ? '~' + esc(m.refreshIn) : '') + ') — panel di-render ulang saat Anda berinteraksi ' +
                    '(klik apa pun). Overall/1M = heuristik estimasi, bukan rumus game; cocokkan gaya sirkuit Anda.';
                dT.insertAdjacentElement('beforebegin', panelEl(idD, 'I.G.P.A.S · transfers', 'Driver terbaik yang tampil (estimasi)', body, note));
            } else {
                removeIfAny([idD]);
            }
            const sT = document.getElementById('staff-table');
            if (sT && m && m.staff && m.staff.length) {
                const roles = ['CD', 'TD', 'DR'];
                const roleLabel = { CD: 'Chief Designer', TD: 'Technical Director', DR: 'Doctor' };
                let body = '';
                for (const code of roles) {
                    const items = m.staff.filter(x => x.role === code);
                    if (!items.length) continue;
                    // kontrak helper: ratingPct/costPerRace — map dari overall/fee pasar
                    const res = IGPCore.rankManufacturerItems({
                        items: items.map(x => ({ id: x.id, name: x.name, ratingPct: x.overall, costPerRace: x.fee })),
                        withCost: true,
                    });
                    if (!res.ok) continue;
                    const byId = {};
                    for (const x of items) byId[x.id] = x;
                    const top = res.values.ranked.slice(0, 2);
                    for (let i = 0; i < top.length; i++) {
                        const r = top[i];
                        const src = byId[r.id] || {};
                        const t = IGPCore.parseTraits(src.traitsHtml);
                        const tags =
                            (i === 0 ? '<span class="igpas-adv-tag">rating tertinggi</span>' : '') +
                            (res.values.bestValueId === r.id ? '<span class="igpas-adv-tag">nilai terbaik</span>' : '') +
                            (t.boost.length ? '<span class="igpas-adv-tag">+' + esc(t.boost.join(', ')) + '</span>' : '') +
                            (t.weaken.length ? '<span class="igpas-adv-tag">−' + esc(t.weaken.join(', ')) + '</span>' : '');
                        body += '<tr' + (i === 0 ? ' class="igpas-adv-best"' : '') + '>' +
                            '<td>' + esc(roleLabel[code] || code) + '</td>' +
                            '<td>' + esc(r.name) + tags + '</td>' +
                            '<td>' + (r.rating != null ? esc(r.rating) : '—') + '</td>' +
                            '<td>' + fmtMoney(r.cost) + '</td>' +
                            '<td>' + (r.ratingPerCost == null ? '—' : esc(r.ratingPerCost)) + '</td></tr>';
                    }
                }
                if (!body) body = '<p class="igpas-adv-note">Baris staff pasar tidak terbaca dari tabel ini.</p>';
                const note = 'Green = spesialis penguat atribut (dari tooltip game), merah = kelemahan terkait. ' +
                    (m.refreshIn ? 'Lelang refresh otomatis (' + esc(m.refreshIn) + '); panel di-render ulang saat Anda berinteraksi. ' : '') +
                    'Pilih CD/TD dengan spesialis yang cocok dengan atribut yang sedang Anda desain — heuristik estimasi, bukan rumus game.';
                sT.insertAdjacentElement('beforebegin', panelEl(idS, 'I.G.P.A.S · transfers', 'Staff pasar per peran (estimasi)', body, note));
            } else {
                removeIfAny([idS]);
            }
            mountTransfersCompare(m);
        }

        /**
         * Perbandingan pasar vs roster Anda (v0.8.0) di halaman Transfers.
         * Sumber roster = snapshot `staff-data` dari menu Capture GUI (bukan
         * pembacaan baru: Advisor tetap tanpa request mailbox). Bila belum
         * ada snapshot, panel menjelaskan cara mengisinya — tidak mengarang.
         */
        function mountTransfersCompare(m) {
            const id = PREFIX + '-tx-compare';
            const anchor = document.getElementById('driver-table') || document.getElementById('staff-table');
            if (!anchor || !m || (!m.drivers.length && !m.staff.length)) { removeIfAny([id]); return; }
            const staffSnap = Storage.getSnapshot('staff-data');
            let body = '';
            let note = '';
            if (!staffSnap || !staffSnap.data) {
                note = 'Belum ada snapshot roster Anda. Buka tab iGP di halaman <em>Drivers &amp; Staff</em> ' +
                    'lalu klik <em>Capture</em> di Command Center (kirim ke tab ini), lalu muat ulang panel ini — ' +
                    'tanpa snapshot, tidak ada pembanding dan panel tidak mengarang angka.';
            } else {
                const d = staffSnap.data;
                const current = [];
                for (const drv of (d.drivers || [])) {
                    if (!drv || drv.name == null) continue;
                    current.push({
                        key: 'DRV-' + (drv.id != null ? drv.id : drv.name),
                        name: drv.name,
                        role: 'DRV',
                        rating: drv.statIndex,
                        costPerRace: drv.salaryPerRace,
                    });
                }
                for (const c of (d.staffCards || [])) {
                    if (!c || c.name == null) continue;
                    current.push({
                        key: 'ROLE-' + (c.role || c.name),
                        name: c.name,
                        role: Utils.roleCode(c.role),
                        rating: null,
                        costPerRace: c.salaryPerRace,
                    });
                }
                const market = [];
                for (const x of m.drivers) {
                    market.push({ key: 'DRV-' + x.id, name: x.name, role: 'DRV', rating: x.statIndex, costPerRace: x.wage, fee: x.fee });
                }
                for (const x of m.staff) {
                    market.push({ key: 'ROLE-' + x.id, name: x.name, role: Utils.roleCode(x.role), rating: x.statIndex, costPerRace: x.wage, fee: x.fee });
                }
                const res = IGPCore.compareRoster({ current: current, market: market, ratingLabel: 'indeks stat', costLabel: 'gaji/balapan' });
                if (!res.ok) {
                    note = esc(res.error) + '.';
                } else {
                    const v = res.values;
                    const rows = v.rows.map(r => {
                        const roleTxt = ROLE_LABEL[r.role] || r.role || '—';
                        return '<tr class="igpas-adv-row-' + esc(r.verdict) + '">' +
                            '<td>' + esc(roleTxt) + '</td>' +
                            '<td>' + esc(r.name) + '</td>' +
                            '<td>' + vChip(r.rating.verdict, 'indeks stat') +
                            '<div class="igpas-adv-cmp">' + scoreTxt(r.rating.now) + ' → ' + refTxt(r.refRating, scoreTxt) + '</div></td>' +
                            '<td>' + vChip(r.cost.verdict, 'gaji') +
                            '<div class="igpas-adv-cmp">' + fmtMoney(r.cost.now) + ' → ' + refTxt(r.refCost, fmtMoney) + '</div></td></tr>';
                    }).join('');
                    body = '<table><thead><tr><th>Peran</th><th>Milik Anda</th><th>Indeks stat</th>' +
                        '<th>Gaji/balapan</th></tr></thead><tbody>' + rows + '</tbody></table>';
                    note = 'Ringkas: ' +
                        v.counts.better + ' lebih bagus · ' + v.counts.worse + ' lebih buruk · ' +
                        v.counts.equal + ' sama · ' + v.counts.unknown + ' tak terbaca ' +
                        '(pasar ' + v.marketCount + ' baris, snapshot ' + esc(new Date(staffSnap.ts).toLocaleTimeString()) + '). ';
                }
            }
            note += 'Pembanding: indeks stat = rata-rata 12 angka CSV pada kolom rating (<strong>bukan overall game</strong> — ' +
                'game membulatkan per stat, jadi angkanya beda tipis dari kolom Overall/Fee); gaji = <code>data-sort</code> kolom ' +
                'Wage/Salary. "≈ sama" berarti selisih ≤2%. Verdict diambil dari sumbu rating bila kedua sisi punya angka, ' +
                'selainnya gaji — kalau game tidak menampilkan angkanya, ditulis "tak terbaca", bukan dikarang. ' +
                '<strong>Estimasi — bukan rumus game</strong>.';
            anchor.insertAdjacentElement('afterend',
                panelEl(id, 'I.G.P.A.S · banding pasar', 'Pasar vs roster Anda — lebih bagus / lebih buruk / sama', body, note));
        }

        /* Tab Setup halaman pra-balapan (v0.7.3, v0.7.4: arah-label + lap practice): slider vs bar ideal + kondisi. */
        function mountRaceSetup() {
            const id = PREFIX + '-rsetup';
            const idWrap = PREFIX + '-rsetup-wrap';
            if (pageId() !== 'race') { removeIfAny([id, idWrap]); return; }
            const anchor = document.getElementById('setup');
            if (!anchor) { removeIfAny([id, idWrap]); return; }
            const data = IgpRaceSetupAdapter.captures(document);
            let body = '';
            let note = '';
            if (!data) {
                note = 'Tab Setup tidak terbaca (varian DOM baru?). Tidak ada estimasi — jangan dianggap data.';
            } else {
                const rows = [];
                for (const d of data.drivers) {
                    for (const s of d.sliders) {
                        const ar = IGPCore.setupAdvice({ ideal: s.ideal, current: s.value });
                        const idealTxt = ar.learned ? ('≈ ' + ar.mid) : 'belum dipelajari';
                        const deltaTxt = ar.learned
                            ? (ar.delta == null ? '—' : ((ar.delta > 0 ? '+' : '') + ar.delta))
                            : '—';
                        // Arah dari kelas label game (decrease/increase), terjemahan
                        // harfiah; null (belum dipelajari) = '—'.
                        const dirTxt = (s.dir === 'decrease') ? '↓ kurangi'
                            : (s.dir === 'increase') ? '↑ tambah' : '—';
                        rows.push('<tr>' +
                            '<td>' + esc(d.name || ('Driver ' + d.num)) + '</td>' +
                            '<td>' + esc(s.label || s.key || '?') + '</td>' +
                            '<td>' + (s.value == null ? '—' : esc(s.value)) + '</td>' +
                            '<td>' + esc(idealTxt) + '</td>' +
                            '<td>' + esc(dirTxt) + '</td>' +
                            '<td>' + esc(deltaTxt) + '</td></tr>');
                    }
                }
                if (rows.length) {
                    body += '<table><thead><tr><th>Driver</th><th>Pengaturan</th><th>Sekarang</th>' +
                        '<th>Ideal (bar game)</th><th>Arah (game)</th><th>Selisih</th></tr></thead><tbody>' +
                        rows.join('') + '</tbody></table>';
                }
                const cond = data.drivers.map(d => {
                    if (d.health == null && d.condition == null && d.engine == null) return '';
                    const low = (d.health != null && d.health < 30);
                    return '<tr' + (low ? ' class="igpas-adv-best"' : '') + '>' +
                        '<td>' + esc(d.name || ('Driver ' + d.num)) +
                        (low ? '<span class="igpas-adv-tag">kritis — repair dulu</span>' : '') + '</td>' +
                        '<td>' + (d.health == null ? '—' : esc(d.health) + '%') + '</td>' +
                        '<td>' + (d.condition == null ? '—' : esc(d.condition) + '%') + '</td>' +
                        '<td>' + (d.engine == null ? '—' : esc(d.engine) + '%') + '</td></tr>';
                }).join('');
                if (cond) {
                    body += '<table><thead><tr><th>Kondisi mobil</th><th>Health</th><th>Condition</th>' +
                        '<th>Engine</th></tr></thead><tbody>' + cond + '</tbody></table>';
                }
                const rain = data.weather.rainText || '—';
                const wet = /^[1-9]/.test(String(data.weather.rainText || '').trim());
                note = 'Cuaca: ' + esc(rain) + ' hujan · ' + esc(data.weather.tempText || '—') +
                    (wet ? ' — lintasan basah.' : ' — kering.');
                for (const d of data.drivers) {
                    note += ' ' + esc(d.name || ('Driver ' + d.num)) + ': ' + d.practiceLaps +
                        ' lap practice tercatat' +
                        (d.practiceLast
                            ? ' — terakhir lap ' + esc(d.practiceLast.lap) + ': ' +
                                esc(d.practiceLast.time || '—') +
                                ' (ride/susp/wing ' + esc(d.practiceLast.ride) + '/' +
                                esc(d.practiceLast.susp) + '/' + esc(d.practiceLast.wing) +
                                ' · bensin ' + esc(d.practiceLast.fuelUse || '—') +
                                ' · ban ' + esc(d.practiceLast.tyreUse || '—') + ').'
                            : ' — jalankan practice untuk mempersempit ideal.') +
                        (d.engineerComment ? ' Engineer (kata game): “' + esc(d.engineerComment) + '”.' : '');
                }
                note += ' Ideal dibaca dari BAR ideal slider game (makin sempit, makin bisa dipercaya; ' +
                    'bar penuh = belum dipelajari — bukan nol); selisih = sekarang − tengah bar, ' +
                    'arah semata. <strong>Estimasi — bukan rumus game</strong>.';
            }
            mountWrapped(anchor, idWrap, panelEl(id, 'I.G.P.A.S · race setup', 'Estimasi ideal setup (tab Setup)', body, note));
        }

        /* Tab Strategy halaman pra-balapan (v0.7.3, v0.7.4: push + umur ban): ringkas stint/fuel/two-tyre. */
        function mountRaceStrategy() {
            const id = PREFIX + '-rstrategy';
            const idWrap = PREFIX + '-rstrategy-wrap';
            if (pageId() !== 'race') { removeIfAny([id, idWrap]); return; }
            const anchor = document.getElementById('strategy');
            if (!anchor) { removeIfAny([id, idWrap]); return; }
            const m = IgpRaceStrategyAdapter.captures(document);
            let body = '';
            let note = '';
            if (!m) {
                note = 'Tab Strategy tidak terbaca (varian DOM baru?). Tidak ada estimasi — jangan dianggap data.';
            } else {
                const rules = m.rules || {};
                const rows = [];
                for (const d of m.drivers) {
                    const res = IGPCore.summarizeStrategy({
                        strategy: d.strategy,
                        raceLaps: m.raceLaps,
                        fuelPerLap: d.fuelPerLap,
                        advancedFuel: d.advancedFuel,
                        ruleTwoTyres: rules.two_tyres === '1' || rules.two_tyres === 1,
                        ruleRefuelling: rules.refuelling === '1' || rules.refuelling === 1,
                    });
                    let cell;
                    if (!res.ok) {
                        cell = '<span class="igpas-adv-tag">' + esc(res.error) + '</span>';
                    } else {
                        const v = res.values;
                        const lapsTxt = (v.raceLaps == null) ? '—' :
                            (v.lapsTotal + '/' + v.raceLaps + ' lap' +
                                (v.lapsShort > 0 ? ' (kurang ' + v.lapsShort + '!)' : ''));
                        const tyresTxt = (v.tyres.length ? v.tyres.join(', ') : '—') +
                            ' (' + v.dryUnique.length + ' compound kering' +
                            (v.twoTyreOk == null ? ')' : (v.twoTyreOk ? ' ✓)' : ' ✗ dua compound wajib)'));
                        const fuelTxt = (v.fuelNeed == null)
                            ? '—'
                            : (v.advancedFuel == null
                                ? 'butuh ±' + v.fuelNeed + ' L'
                                : v.advancedFuel + ' L vs ±' + v.fuelNeed + ' L → sisa ' +
                                    v.fuelBuffer + ' L (≈' + v.bufferLaps + ' lap)');
                        // Umur ban game ({"SS":12} → "SS ±12 lap"); [] / {} = belum ada.
                        const tl = (d.tyreLife && typeof d.tyreLife === 'object' && !Array.isArray(d.tyreLife))
                            ? Object.keys(d.tyreLife) : [];
                        const tlTxt = tl.length
                            ? tl.map(k => esc(k) + ' ±' + esc(d.tyreLife[k]) + ' lap').join(', ')
                            : null;
                        cell = 'Lap ' + esc(lapsTxt) + ' · Ban ' + esc(tyresTxt) +
                            ' · Bensin ' + esc(fuelTxt) +
                            ' · pit ' + (v.pits == null ? '—' : esc(v.pits)) +
                            ' · risiko ' + (v.risk == null ? '—' : esc(v.risk)) +
                            (d.pushLevel != null ? ' · push ' + esc(d.pushLevel) : '') +
                            (tlTxt ? ' · umur ban game: ' + tlTxt : '') +
                            (v.unknownLaps ? ' · ' + v.unknownLaps + ' lap stint tak terbaca' : '');
                    }
                    rows.push('<tr><td>' + esc(d.num === 1 ? 'Driver utama' : 'Driver ' + d.num) +
                        '</td><td>' + cell + '</td></tr>');
                }
                body += '<table><thead><tr><th>Driver</th><th>Ringkasan alokasi (estimasi)</th></tr>' +
                    '</thead><tbody>' + rows.join('') + '</tbody></table>';
                note = 'Aritmetika atas angka yang tampil di tab ini (laps × fuel/lap dari game). ' +
                    'Aturan liga span #rules: refuelling ' +
                    esc(rules.refuelling == null ? '—' : rules.refuelling) + ', two_tyres ' +
                    esc(rules.two_tyres == null ? '—' : rules.two_tyres) + '. ' +
                    'Panel = snapshot halaman saat dimuat/di-render ulang; jika Anda mengubah stint, ' +
                    'buka ulang tab agar perhitungan ikut baru. <strong>Estimasi — bukan rumus game</strong>.';
            }
            mountWrapped(anchor, idWrap, panelEl(id, 'I.G.P.A.S · race strategy', 'Ringkasan strategi (tab Strategy)', body, note));
        }

        function renderAll() {
            if (typeof document === 'undefined' || !document.body) return;
            const pid = pageId();
            if (['cars', 'manufacturers', 'staff', 'transfers', 'race'].indexOf(pid) === -1) {
                // Halaman lain: tanpa jejak UI apa pun (disiplin study-only).
                removeIfAny([PREFIX + '-toggle', PREFIX + '-design', PREFIX + '-supply',
                    PREFIX + '-supply-compare', PREFIX + '-mfg-engine', PREFIX + '-mfg-chassis',
                    PREFIX + '-team', PREFIX + '-team-compare',
                    PREFIX + '-tx-driver', PREFIX + '-tx-staff', PREFIX + '-tx-compare',
                    PREFIX + '-rsetup', PREFIX + '-rsetup-wrap',
                    PREFIX + '-rstrategy', PREFIX + '-rstrategy-wrap']);
                for (const el of document.querySelectorAll('.igpas-adv-inline, .igpas-adv-inline-head')) el.remove();
                return;
            }
            styleEnsure();
            try {
                mountDesign();
                mountSupply();
                mountManufacturers();
                mountTeam();
                mountTransfers();
                mountRaceSetup();
                mountRaceStrategy();
            } catch (e) {
                if (typeof console !== 'undefined') console.warn('IGPAS advisor', e); // jangan pernah merusak halaman game
            }
            // Toggle hanya tampil bila ada UI sungguhan (panel ATAU badge inline
            // design) — halaman race TANPA wadah tab Setup/Strategy
            // (mis. konteks race live) dibiarkan 100% tanpa jejak UI,
            // termasuk tanpa tombol advisor.
            if (!document.querySelector('.igpas-adv-panel, .igpas-adv-inline')) {
                removeIfAny([PREFIX + '-toggle']);
                return;
            }
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
            if (start.started) return; // idempoten — aman dari double DOMContentLoaded
            start.started = true;
            renderAll();
            // Re-render dipicu aksi user (buka dialog Supply, ganti tab/pager, pindah halaman).
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
                    if (ev.target.closest('.igpas-adv-panel, .igpas-adv-inline, #' + PREFIX + '-toggle')) return;
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
            // (hanya elemen milik sendiri — halaman studi Cars/Manufacturers; sejak
            // v0.7.2 Team/Transfers; sejak v0.7.3 (permintaan user) tab Setup/Strategy
            // pra-balapan dengan estimasi. Tab Race live & elemen game tidak disentuh).
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
        module.exports = { IGPCore, Utils, AdapterRegistry, Storage, Mailbox, Advisor, PageCapture };
    }
})();
