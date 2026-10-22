// ==UserScript==
// @name         I.G.P.A.S — iGP Analytics & Study System
// @namespace    https://github.com/Cnagnn/igpas
// @version      0.8.3
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

    const VERSION = '0.8.3';

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

        /**
         * Parse waktu lap "m:ss.mmm" / "ss.mmm" → detik (v0.8.2).
         * "1:22.512" → 82.512. null = tak terbaca (jangan jadi 0).
         */
        parseLapTime(s) {
            const t = String(s == null ? '' : s).trim();
            if (!t) return null;
            let m = t.match(/^(\d+):(\d+(?:\.\d+)?)$/);
            if (m) {
                const sec = Number(m[1]) * 60 + Number(m[2]);
                return Number.isFinite(sec) ? Math.round(sec * 1000) / 1000 : null;
            }
            m = t.match(/^(\d+(?:\.\d+)?)$/);
            if (m) {
                const sec = Number(m[1]);
                return Number.isFinite(sec) ? Math.round(sec * 1000) / 1000 : null;
            }
            return null;
        },

        /**
         * Parse angka pemakaian practice ("-2.4", "-8%", "2.460") → Number (v0.8.2).
         * Tanda minus dipertahankan (game menulis pemakaian sebagai negatif);
         * pemanggil memakai Math.abs untuk rata-rata per lap.
         */
        parseUseNumber(s) {
            const t = String(s == null ? '' : s).trim().replace(',', '.');
            if (!t) return null;
            const m = t.match(/-?\d+(?:\.\d+)?/);
            if (!m) return null;
            const v = Number(m[0]);
            return Number.isFinite(v) ? v : null;
        },

        /**
         * Format detik → "m:ss.mmm" untuk label in-place (v0.8.2).
         */
        formatLapTime(sec) {
            if (sec == null || !Number.isFinite(Number(sec))) return '—';
            const v = Number(sec);
            const m = Math.floor(v / 60);
            const s = v - m * 60;
            const si = Math.floor(s);
            const ms = Math.round((s - si) * 1000);
            return m + ':' + String(si).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
        },

        /**
         * Agregasi lap practice menjadi fuel/lap, tyre/lap, timelap/stint (v0.8.2).
         * Input: laps = [{fuelUse, tyreUse, timeSec}] — angka ATAU string mentah
         * ("-2.4", "-8%", "1:22.512"); nilai tak terbaca dilewati per sumbu,
         * bukan dijadikan 0. Butuh ≥1 lap dengan ≥1 sumbu terbaca.
         */
        summarizePracticeLaps(laps) {
            const list = Array.isArray(laps) ? laps : null;
            if (!list || !list.length) return { ok: false, error: 'Belum ada lap practice yang terbaca' };
            const fuels = [];
            const tyres = [];
            const times = [];
            for (const l of list) {
                if (!l) continue;
                const f = (typeof l.fuelUse === 'number') ? l.fuelUse : IGPCore.parseUseNumber(l.fuelUse);
                const w = (typeof l.tyreUse === 'number') ? l.tyreUse : IGPCore.parseUseNumber(l.tyreUse);
                const t = (typeof l.timeSec === 'number') ? l.timeSec : IGPCore.parseLapTime(l.time != null ? l.time : l.timeSec);
                if (f != null) fuels.push(Math.abs(f));
                if (w != null) tyres.push(Math.abs(w));
                if (t != null) times.push(t);
            }
            const count = list.length;
            if (!fuels.length && !tyres.length && !times.length) {
                return { ok: false, error: 'Lap practice tak terbaca (fuel/ban/waktu kosong)' };
            }
            const avg = a => Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 1000) / 1000;
            const best = times.length ? Math.min.apply(null, times) : null;
            return {
                ok: true,
                values: {
                    count: count,
                    fuelAvg: fuels.length ? avg(fuels) : null,
                    tyreAvg: tyres.length ? avg(tyres) : null,
                    bestSec: best,
                    bestLap: IGPCore.formatLapTime(best),
                    fuelLaps: fuels.length,
                    tyreLaps: tyres.length,
                    timeLaps: times.length,
                },
            };
        },

        /**
         * Rekomendasi fuel balapan dari fuel/lap practice (v0.8.2).
         * need = raceLaps × fuelPerLap; buffer vs bensin terisi (advancedFuel);
         * reserve default 1 lap. null = data tak tampil — JANGAN jadi 0.
         */
        recommendRaceFuel(p) {
            const numOrNull = Utils.numOrNull;
            const raceLaps = numOrNull(p ? p.raceLaps : null);
            const fpl = numOrNull(p ? p.fuelPerLap : null);
            if (raceLaps == null) return { ok: false, error: 'Total lap balapan belum terbaca' };
            if (fpl == null || !(fpl > 0)) return { ok: false, error: 'Fuel/lap practice belum terbaca' };
            const adv = numOrNull(p ? p.advancedFuel : null);
            const reserve = (p && p.reserveLaps != null && p.reserveLaps !== '')
                ? Number(p.reserveLaps) : 1;
            const res = (!Number.isFinite(reserve) || reserve < 0) ? 1 : reserve;
            const need = Math.round(raceLaps * fpl * 10) / 10;
            const total = Math.round((need + res * fpl) * 10) / 10;
            const buffer = adv != null ? Math.round((adv - need) * 10) / 10 : null;
            const bufferLaps = (buffer != null && fpl) ? Math.round((buffer / fpl) * 10) / 10 : null;
            return {
                ok: true,
                values: { raceLaps: raceLaps, fuelPerLap: fpl, need: need, reserveLaps: res, total: total, advancedFuel: adv, buffer: buffer, bufferLaps: bufferLaps },
            };
        },

        /**
         * Perkiraan umur ban (lap) dari tyre%/lap practice (v0.8.2).
         * life = floor(threshold / tyrePerLap). threshold default 80%.
         */
        practiceTyreLife(p) {
            const numOrNull = Utils.numOrNull;
            const wpl = numOrNull(p ? p.tyrePerLap : null);
            const thrRaw = (p && p.threshold != null && p.threshold !== '') ? Number(p.threshold) : 80;
            const thr = Number.isFinite(thrRaw) ? thrRaw : 80;
            if (wpl == null || !(wpl > 0)) return { ok: false, error: 'Tyre/lap practice belum terbaca' };
            if (!(thr > 0)) return { ok: false, error: 'Threshold harus > 0' };
            return { ok: true, values: { life: Math.floor(thr / wpl), threshold: thr, tyrePerLap: wpl } };
        },

        /**
         * Baca perilaku track dari angka karakteristik game (v0.8.2).
         * Input persen 0–100 apa adanya (overtaking/bumpiness/fuel/wear);
         * output = hint teks berlabel estimasi — bukan setup pasti.
         */
        describeTrack(p) {
            const numOrNull = Utils.numOrNull;
            const ov = numOrNull(p ? p.overtaking : null);
            const bu = numOrNull(p ? p.bumpiness : null);
            const fu = numOrNull(p ? p.fuel : null);
            const we = numOrNull(p ? p.wear : null);
            if (ov == null && bu == null && fu == null && we == null) {
                return { ok: false, error: 'Karakteristik trek belum terbaca' };
            }
            const hints = [];
            if (fu != null && fu >= 70) hints.push('konsumsi BBM tinggi — siapkan fuel lap realistis dari practice');
            else if (fu != null && fu <= 30) hints.push('konsumsi BBM rendah — fuel lap kecil, fokus pace');
            if (we != null && we >= 70) hints.push('tyre wear tinggi — stint pendek, siapkan 2+ compound');
            else if (we != null && we <= 30) hints.push('tyre wear rendah — stint bisa panjang');
            if (ov != null && ov <= 30) hints.push('sulit overtake — prioritaskan posisi start & undercut');
            else if (ov != null && ov >= 70) hints.push('mudah overtake — strategi pit fleksibel');
            if (bu != null && bu >= 60) hints.push('trek bergelombang — ride/susp lembut patut diuji');
            if (!hints.length) hints.push('karakteristik seimbang — ikut data practice per lap');
            return { ok: true, values: { hints: hints, overtaking: ov, bumpiness: bu, fuel: fu, wear: we } };
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
                // Label tulisan advisor (data-igpas-orig) dikembalikan ke aslinya:
                // snapshot menyimpan data game murni, bukan hasil tampilan.
                const saved = row.getAttribute('data-igpas-orig');
                attrs[key] = {
                    label: (saved != null ? saved : txt(row, '.attribute-rating-header span:not(.ratingVal)')),
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
                    // Nama tulisan advisor (data-igpas-orig) dikembalikan ke aslinya:
                    // snapshot menyimpan data game murni, bukan hasil tampilan.
                    const savedName = tr.getAttribute('data-igpas-orig');
                    const row = {
                        id: idm ? parseInt(idm[1], 10) : null,
                        name: (savedName != null ? savedName : clean(tds[0].textContent)), // teks saja — <a> kosong + <img> flag tidak menghasilkan teks
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
                // colspan). v0.8.2: SELURUH riwayat disimpan (fuel/ban/waktu per
                // lap) untuk agregasi fuel/lap, tyre/lap, timelap/stint; baris
                // TERAKHIR tetap dipertahankan (kompatibel v0.7.4).
                let practiceLaps = 0;
                let practiceLast = null;
                const practiceHistory = [];
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
                    practiceHistory.push({
                        lap: cellText(tds[0]),
                        ride: cellText(tds[1]),
                        susp: cellText(tds[2]),
                        wing: cellText(tds[3]),
                        fuelUse: tds[4] ? cellText(tds[4]) : null,
                        tyreUse: tds[5] ? cellText(tds[5]) : null,
                        time: tds[6] ? cellText(tds[6]) : null,
                        fuelNum: IGPCore.parseUseNumber(tds[4] ? tds[4].textContent : null),
                        tyreNum: IGPCore.parseUseNumber(tds[5] ? tds[5].textContent : null),
                        timeSec: IGPCore.parseLapTime(tds[6] ? tds[6].textContent : null),
                    });
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
                    practiceHistory: practiceHistory,
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
     * Adapter perilaku track pra-balapan (v0.8.2) — READ-ONLY atas div #race.
     * Disiplin live-race: TIDAK PERNAH menulis ke #race (mount hanya menulis
     * ke #setup/#strategy). Bacaan = tabel .raceInfoTable (bar % + panjang
     * sirkuit) + judul h1 (nama + laps). null = baris tak tampil.
     */
    const IgpTrackAdapter = {
        id: 'race-track-data',
        desc: 'perilaku track pra-balapan: karakteristik + panjang (read-only, tanpa tulis)',
        captures(doc) {
            const pid = doc.getElementById('pageId');
            if (!pid || pid.value !== 'race') return null;
            const race = doc.getElementById('race');
            if (!race) return null;
            const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
            const pctOf = td => {
                const bar = td ? td.querySelector('.ratingBar div') : null;
                const st = bar ? (bar.getAttribute('style') || '') : '';
                const m = st.match(/(\d+(?:\.\d+)?)\s*%/);
                return m ? Number(m[1]) : null;
            };
            let overtaking = null, bumpiness = null, fuel = null, wear = null, lengthKm = null;
            for (const tr of race.querySelectorAll('.raceInfoTable tbody tr')) {
                const th = tr.querySelector('th');
                const td = tr.querySelector('td');
                if (!th || !td) continue;
                const k = clean(th.textContent).toLowerCase();
                if (k.indexOf('overtaking') !== -1) overtaking = pctOf(td);
                else if (k.indexOf('bumpiness') !== -1 || k.indexOf('bump') !== -1) bumpiness = pctOf(td);
                else if (k.indexOf('fuel') !== -1) fuel = pctOf(td);
                else if (k.indexOf('tyre') !== -1 || k.indexOf('tire') !== -1 || k.indexOf('wear') !== -1) wear = pctOf(td);
                else if (k.indexOf('length') !== -1 || k.indexOf('circuit length') !== -1) {
                    const m = clean(td.textContent).match(/(\d+(?:\.\d+)?)\s*km/i);
                    lengthKm = m ? Number(m[1]) : null;
                }
            }
            const h1 = doc.querySelector('.raceHeadTitle');
            const title = h1 ? clean(h1.textContent) : null;
            const lapsM = title ? title.match(/\((\d+)\s*laps?\)/i) : null;
            if (overtaking == null && bumpiness == null && fuel == null && wear == null && lengthKm == null && !lapsM) return null;
            return {
                name: title ? title.replace(/\s*\(\d+\s*laps?\)\s*/i, '').trim() || null : null,
                laps: lapsM ? Number(lapsM[1]) : null,
                overtaking: overtaking, bumpiness: bumpiness, fuel: fuel, wear: wear,
                lengthKm: lengthKm,
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
            { id: 'race-track-data', adapter: IgpTrackAdapter },
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
        const fmtMoney = Utils.fmtMoney; // satu format uang untuk Advisor & GUI
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
         * IN-PLACE PENUH (tanpa elemen baru): teks label ASLI tiap baris game
         * ditulis ulang jadi "#n Label · X DP"; detail val/max/gap + label
         * estimasi di atribut title baris yang sama. Angka & bar game tidak
         * pernah disentuh. Teks asli disimpan di data-igpas-orig dan
         * dikembalikan oleh restoreDesign() — captures selalu berjalan
         * setelah restore sehingga adapter tidak pernah membaca hasil tulisan. */
        function restoreDesign() {
            const rows = document.querySelectorAll('#carAttributesDisplay .attribute-row[data-igpas-orig]');
            for (const row of rows) {
                try {
                    const label = row.querySelector('.attribute-rating-header span:not(.ratingVal)');
                    if (label) label.textContent = row.getAttribute('data-igpas-orig');
                    const savedTitle = row.getAttribute('data-igpas-title');
                    if (savedTitle != null) {
                        const written = row.getAttribute('data-igpas-written-title');
                        if (written == null || row.getAttribute('title') === written) {
                            if (savedTitle === '') row.removeAttribute('title');
                            else row.setAttribute('title', savedTitle);
                        }
                    } else {
                        row.removeAttribute('title');
                    }
                } catch { /* jangan pernah merusak halaman game */ }
                row.removeAttribute('data-igpas-orig');
                row.removeAttribute('data-igpas-title');
                row.removeAttribute('data-igpas-written-title');
            }
            // Sisa migrasi versi badge/panel: bersihkan tanpa menyentuh node game.
            for (const el of document.querySelectorAll('.igpas-adv-inline, .igpas-adv-inline-head')) el.remove();
            removeIfAny([PREFIX + '-design']);
        }
        function mountDesign() {
            const anchor = (pageId() === 'cars') ? document.getElementById('carAttributesDisplay') : null;
            if (!anchor) { restoreDesign(); return; }
            restoreDesign(); // teks asli kembali dulu agar captures baca data murni
            const data = IgpCarsAdapter.captures(document);
            const res = IGPCore.designPriority({
                attrs: data && data.attrs,
                best: data && data.best,
                designPoints: data && data.designPoints,
            });
            // Gagal jujur: tanpa angka, tanpa modifikasi apa pun (tanpa panel).
            if (!res.ok) return;
            const dpTotal = res.values.designPoints;
            res.values.ranked.forEach((r, i) => {
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
                label.textContent = '#' + (i + 1) + ' ' + orig + (dpEst != null ? ' · ' + dpEst + ' DP' : '');
                const advisorTitle = 'Prioritas #' + (i + 1) + ' — ' + (r.label || orig) + ': ' + r.val +
                    ' → max liga ' + (r.max == null ? '—' : r.max) +
                    ' (gap ' + (r.gap == null ? '—' : r.gap) + '). ' +
                    'Usulan ' + (dpEst != null ? '±' + dpEst + ' DP dari ' + dpTotal + ' DP' : share + '% porsi gap') +
                    ' — estimasi, bukan rumus game.';
                row.setAttribute('title', advisorTitle);
                row.setAttribute('data-igpas-written-title', advisorTitle);
            });
        }

        /* Dialog Supply (engine/fuel/tyre): peringkat alternatif + verdict aktif.
         * IN-PLACE PENUH (tanpa elemen baru): teks biaya tiap kartu alternatif
         * ditulis ulang jadi "#n · 350k" (+ ★ nilai terbaik / · termurah);
         * judul dialog ("Engine supply") ditulis ulang dengan verdict vs
         * alternatif. Detail Σ bonus/nilai/1M + label estimasi di atribut title
         * kartu yang sama. Teks asli disimpan di data-igpas-orig dan
         * dikembalikan oleh restoreSupply() — captures selalu berjalan setelah
         * restore sehingga adapter tidak pernah membaca hasil tulisan. */
        function restoreSupply() {
            // Cakupan STRICT dialog: data-igpas-* milik Cars/Manufacturers
            // tidak boleh tersentuh (renderAll me-mount berurutan).
            // Tanpa dialog = tidak ada node tersisa untuk dibersihkan.
            const dlg = document.querySelector('.supplyDialog');
            if (!dlg) return;
            for (const link of dlg.querySelectorAll('a[data-igpas-orig]')) {
                try {
                    // Restore the first non-empty text node, even if the game
                    // replaced the advisor text in-place before cleanup.
                    const nd = Array.from(link.childNodes).find(n =>
                        n.nodeType === 3 && n.textContent.trim() !== '');
                    if (nd) nd.textContent = link.getAttribute('data-igpas-orig');
                } catch { /* jangan pernah merusak halaman game */ }
                link.removeAttribute('data-igpas-orig');
            }
            const h2 = dlg.querySelector('.dialog-subhead-content h2[data-igpas-orig]');
            if (h2) {
                try { h2.textContent = h2.getAttribute('data-igpas-orig'); }
                catch { /* abaikan */ }
                h2.removeAttribute('data-igpas-orig');
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
        }
        function mountSupply() {
            // Sisa migrasi versi panel: bersihkan tanpa menyentuh node game.
            removeIfAny([PREFIX + '-supply', PREFIX + '-supply-compare']);
            const dlg = document.querySelector('.supplyDialog');
            if (!dlg) { restoreSupply(); return; }
            restoreSupply(); // teks asli kembali dulu agar captures baca data murni
            const s = IgpSupplyAdapter.captures(document);
            if (!s || !s.current || !Array.isArray(s.alternatives) || !s.alternatives.length) return;
            const rank = IGPCore.rankSuppliers({ items: s.alternatives });
            // Gagal jujur: tanpa angka, tanpa modifikasi apa pun (tanpa panel).
            if (!rank.ok) return;
            const cmp = IGPCore.compareSuppliers({ current: s.current, alternatives: s.alternatives });
            const bestId = rank.values.bestValueId;
            const cheapId = rank.values.cheapestId;
            // Peta kartu per eId — parsing identik adapter (anti substring eId=1 vs eId=10).
            const cards = new Map();
            for (const btn of dlg.querySelectorAll('a[data-tip*="supplyType="]')) {
                const tip = btn.getAttribute('data-tip') || '';
                const eId = (tip.match(/eId=(\d+)/) || [])[1];
                if (!eId || cards.has(eId)) continue;
                cards.set(eId, { link: btn, card: btn.closest('.inline-block') || btn.parentElement });
            }
            const n = rank.values.ranked.length;
            rank.values.ranked.forEach((r, i) => {
                if (r.eId == null) return;
                const hit = cards.get(String(r.eId));
                if (!hit || !hit.link) return;
                const link = hit.link, card = hit.card;
                let costNode = null;
                try {
                    for (const nd of link.childNodes) {
                        if (nd.nodeType === 3 && nd.textContent.trim() !== '') { costNode = nd; break; }
                    }
                } catch { costNode = null; }
                if (!costNode) return;
                const orig = costNode.textContent;
                const isBest = bestId != null && r.id === bestId;
                const isCheap = !isBest && cheapId != null && r.id === cheapId;
                link.setAttribute('data-igpas-orig', orig);
                costNode.textContent = '#' + (i + 1) + ' · ' + orig.trim() +
                    (isBest ? ' ★' : '') + (isCheap ? ' · termurah' : '');
                if (card) {
                    // Penanda title selalu dipasang ('' = semula tanpa title) agar
                    // restore presisi tanpa menyapu title milik game.
                    card.setAttribute('data-igpas-title',
                        card.hasAttribute('title') ? card.getAttribute('title') : '');
                    const advisorTitle = '#' + (i + 1) + ' dari ' + n +
                        (isBest ? ' · nilai terbaik' : '') + (isCheap ? ' · termurah' : '') +
                        ' — Σ bonus ' + (r.value == null ? '—' : (r.value > 0 ? '+' : '') + r.value) +
                        ' · ' + fmtMoney(r.cost) + '/race · nilai/1M ' +
                        (r.valuePerCost == null ? '—' : r.valuePerCost) +
                        ' — estimasi, bukan rumus game.';
                    card.setAttribute('title', advisorTitle);
                    card.setAttribute('data-igpas-written-title', advisorTitle);
                }
            });
            // Verdict supplier aktif ditulis ke judul dialog (tanpa elemen baru).
            if (cmp.ok) {
                const h2 = dlg.querySelector('.dialog-subhead-content h2');
                if (h2) {
                    const kata = v => (v === 'better' ? 'unggul' : v === 'worse' ? 'kalah' : v === 'equal' ? 'setara' : null);
                    const parts = [];
                    const kb = kata(cmp.values.bonus.verdict);
                    const kc = kata(cmp.values.cost.verdict);
                    if (kb) parts.push('bonus ' + kb);
                    if (kc) parts.push('biaya ' + kc);
                    if (parts.length) {
                        const origH2 = h2.textContent;
                        const v = cmp.values;
                        h2.setAttribute('data-igpas-orig', origH2);
                        h2.setAttribute('data-igpas-title',
                            h2.hasAttribute('title') ? h2.getAttribute('title') : '');
                        h2.textContent = origH2 + ' · ' + parts.join(', ') + ' vs alternatif';
                        const advisorTitle = 'Supplier aktif #' +
                            (s.current.supplierId != null ? s.current.supplierId : '?') +
                            ': Σ bonus ' + (v.current.bonus == null ? '—' : (v.current.bonus > 0 ? '+' : '') + v.current.bonus) +
                            ' · ' + fmtMoney(v.current.cost) + '/race. Alternatif ' + n +
                            ': bonus tertinggi Σ' + (v.bestBonus ? (v.bestBonus.value > 0 ? '+' : '') + v.bestBonus.value + ' (#' + v.bestBonus.id + ')' : '—') +
                            ', termurah ' + (v.cheapest ? fmtMoney(v.cheapest.value) + ' (#' + v.cheapest.id + ')' : '—') +
                            '. Kesimpulan: ' + v.basis + ' ' + v.verdict + ' — estimasi, bukan rumus game.';
                        h2.setAttribute('title', advisorTitle);
                        h2.setAttribute('data-igpas-written-title', advisorTitle);
                    }
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
                            if (nd) nd.textContent = tr.getAttribute('data-igpas-orig');
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
                const orig = clean(tds[0].textContent);
                const star = withCost && bestValueId != null && r.id === bestValueId &&
                    i !== 0 ? ' ★' : '';
                tr.setAttribute('data-igpas-orig', orig);
                tr.setAttribute('data-igpas-title',
                    tr.hasAttribute('title') ? tr.getAttribute('title') : '');
                nameNode.textContent = '#' + (i + 1) + ' ' + orig + star;
                const advisorTitle = '#' + (i + 1) + ' · ' + orig +
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
                const advice = [];
                if (d.health != null && d.health < 30) advice.push('health rendah');
                if (d.recoveryPerHour != null) advice.push('pulih +' + d.recoveryPerHour + '/jam');
                // Struktur game (.driverName > br + span) dipertahankan: saran hanya
                // menempel pada span nama yang sudah ada; hover container = detail.
                const span = name.querySelector('span:last-child');
                saveTitle(name);
                const tip = advice.length ? 'Driver: ' + advice.join('; ') + ' — keputusan tetap milik Anda.' : '';
                if (tip) { name.setAttribute('title', tip); name.setAttribute('data-igpas-written-title', tip); }
                if (span) {
                    const orig = span.getAttribute('data-igpas-orig') || span.textContent;
                    writeSelfText(span, orig + (advice.length ? ' · ' + advice.join(' · ') : ''));
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

        // Tulis teks milik sendiri pada elemen yang seluruh textContent-nya aman
        // ditimpa (span nama, header kartu): anak elemen tidak ada yang dihancurkan.
        function writeSelfText(el, text) {
            if (!el) return;
            if (!el.hasAttribute('data-igpas-orig')) el.setAttribute('data-igpas-orig', el.textContent);
            el.setAttribute('data-igpas-origmode', 'self');
            el.textContent = text;
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
            for (const el of document.querySelectorAll('[data-igpas-orig]')) {
                if (el.closest('#carAttributesDisplay, .supplyDialog, #engine-table, #chassis-table')) continue;
                const orig = el.getAttribute('data-igpas-orig');
                if (orig != null) {
                    if (el.getAttribute('data-igpas-origmode') === 'node') {
                        const nd = Array.from(el.childNodes).find(n => n.nodeType === 3 && n.textContent.trim() !== '');
                        if (nd) nd.textContent = orig;
                    } else {
                        el.textContent = orig;
                    }
                }
                restoreTitle(el);
                el.removeAttribute('data-igpas-orig');
                el.removeAttribute('data-igpas-origmode');
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
        /* Tab Setup + Strategy pra-balapan IN-PLACE (v0.8.2): pembaca perilaku
         * track + agregasi practice → rekomendasi fuel/pit/ban.
         * Disiplin nol-elemen: tanpa panel/badge/toggle/elemen baru; tulisan
         * hanya teks + `title` pada elemen ASLI game di #setup/#strategy.
         * Div #race (tab Race live) TIDAK PERNAH ditulis — hanya dibaca untuk
         * karakteristik trek. restore-pertama via restoreRaceInPlace().
         * Jangkar tulis:
         *  - Setup: span nama driver (#setup .driverNInclude .driverName span)
         *    = teks ringkas fuel/ban per lap; title = agregasi + hint track +
         *    arah slider game; p engineer (#dNSetupComments .shrinkText) = title
         *    saja (struktur span merah dipertahankan).
         *  - Strategy: komentar pembalap TIDAK ditulis lagi. Teks + title
         *    ditulis pada label asli "Fuel (litres)" di .c-wrap #dNAdvancedFuel
         *    (estimasi practice/lap × Total laps estimate vs fuel terisi) dan
         *    title pada span #dNTotalLaps. Nilai & tombol -/+ game tak diubah.
         *    Gagal jujur: tanpa practice/fuel/lap → tanpa tulisan. */
        function restoreRaceInPlace() {
            for (const el of document.querySelectorAll('#setup [data-igpas-orig], #strategy [data-igpas-orig]')) {
                try {
                    const orig = el.getAttribute('data-igpas-orig');
                    if (orig != null) {
                        if (el.getAttribute('data-igpas-origmode') === 'node') {
                            const nd = Array.from(el.childNodes).find(n => n.nodeType === 3 && n.textContent.trim() !== '');
                            if (nd) nd.textContent = orig;
                        } else {
                            el.textContent = orig;
                        }
                    }
                    restoreTitle(el);
                } catch { /* jangan pernah merusak halaman game */ }
                el.removeAttribute('data-igpas-orig');
                el.removeAttribute('data-igpas-origmode');
            }
            for (const el of document.querySelectorAll('#setup [data-igpas-title], #strategy [data-igpas-title]')) {
                try { restoreTitle(el); }
                catch { /* abaikan */ }
                el.removeAttribute('data-igpas-title');
                el.removeAttribute('data-igpas-written-title');
            }
        }
        function mountRaceSetup() {
            const id = PREFIX + '-rsetup';
            const idWrap = PREFIX + '-rsetup-wrap';
            removeIfAny([id, idWrap]);
            if (pageId() !== 'race') { restoreRaceInPlace(); return; }
            if (!document.getElementById('setup')) { restoreRaceInPlace(); return; }
            restoreRaceInPlace(); // teks asli kembali dulu agar captures baca data murni
            const s = IgpRaceSetupAdapter.captures(document);
            if (!s) return;
            const track = IgpTrackAdapter.captures(document);
            const desc = track ? IGPCore.describeTrack(track) : null;
            const hintTxt = (desc && desc.ok) ? desc.values.hints.join('; ') : null;
            for (const d of (s.drivers || [])) {
                const hist = d.practiceHistory && d.practiceHistory.length ? d.practiceHistory : null;
                if (!hist) continue;
                const sum = IGPCore.summarizePracticeLaps(hist.map(h => ({
                    fuelUse: h.fuelNum, tyreUse: h.tyreNum, timeSec: h.timeSec,
                })));
                if (!sum.ok) continue;
                const v = sum.values;
                // Span nama driver (teks polos "Pratama"): suffix ringkas terlihat.
                const span = document.querySelector(
                    '#setup .choiceDivInclude.driver' + d.num + 'Include .driverName span:last-child');
                if (span) {
                    const short = ' · ' + v.count + ' lap practice: ' +
                        (v.fuelAvg != null ? v.fuelAvg + 'L/lap' : 'BBM —') + ', ' +
                        (v.tyreAvg != null ? v.tyreAvg + '%/lap' : 'ban —') +
                        (v.bestLap !== '—' ? ', terbaik ' + v.bestLap : '');
                    writeSelfText(span, (span.getAttribute('data-igpas-orig') || span.textContent) + short);
                    saveTitle(span);
                    const tip = 'Agregasi practice (' + v.count + ' lap): fuel ' +
                        (v.fuelAvg != null ? v.fuelAvg + ' L/lap' : '—') + ' · ban ' +
                        (v.tyreAvg != null ? v.tyreAvg + ' %/lap' : '—') + ' · terbaik ' + v.bestLap +
                        (hintTxt ? '. Trek: ' + hintTxt + '.' : '.') +
                        ' — estimasi, bukan rumus game.';
                    span.setAttribute('title', tip);
                    span.setAttribute('data-igpas-written-title', tip);
                }
                // Komentar engineer: title saja (span merah di dalamnya utuh).
                const eng = document.querySelector('#d' + d.num + 'SetupComments .shrinkText');
                if (eng) {
                    saveTitle(eng);
                    const dirs = (d.sliders || []).map(sl =>
                        (sl.label || sl.key) + ' ' + (sl.value == null ? '—' : sl.value) +
                        (sl.dir === 'decrease' ? ' ↓' : sl.dir === 'increase' ? ' ↑' : ''));
                    const tip = 'Practice ' + v.count + ' lap: fuel ' +
                        (v.fuelAvg != null ? v.fuelAvg + ' L/lap' : '—') + ', ban ' +
                        (v.tyreAvg != null ? v.tyreAvg + ' %/lap' : '—') + ', terbaik ' + v.bestLap +
                        '. Setup kini: ' + dirs.join(' · ') +
                        (hintTxt ? '. Perilaku trek: ' + hintTxt + '.' : '.') +
                        ' Uji perubahan kecil per lap — estimasi, bukan rumus game.';
                    eng.setAttribute('title', tip);
                    eng.setAttribute('data-igpas-written-title', tip);
                }
            }
        }

        /* Tab Strategy halaman pra-balapan (v0.7.3, v0.7.4: push + umur ban): ringkas stint/fuel/two-tyre. */
        function mountRaceStrategy() {
            const id = PREFIX + '-rstrategy';
            const idWrap = PREFIX + '-rstrategy-wrap';
            removeIfAny([id, idWrap]);
            if (pageId() !== 'race') return; // restore ditangani mountRaceSetup (satu scope #setup/#strategy)
            if (!document.getElementById('strategy')) return;
            // JANGAN restore di sini (akan menyapu tulisan setup); captures baca
            // ulang setelah setup me-restore — strategi hanya menambah tulisannya.
            const st = IgpRaceStrategyAdapter.captures(document);
            const setup = IgpRaceSetupAdapter.captures(document);
            if (!st) return;
            const track = IgpTrackAdapter.captures(document);
            const raceLaps = (st.raceLaps != null) ? st.raceLaps
                : (track && track.laps != null ? track.laps : null);
            const rules = st.rules || {};
            const twoTyres = String(rules.two_tyres) === '1';
            for (const drv of (st.drivers || [])) {
                const n = drv.num;
                const sd = setup && setup.drivers ? setup.drivers.find(x => x.num === n) : null;
                const hist = sd && sd.practiceHistory && sd.practiceHistory.length ? sd.practiceHistory : null;
                const sum = hist ? IGPCore.summarizePracticeLaps(hist.map(h => ({
                    fuelUse: h.fuelNum, tyreUse: h.tyreNum, timeSec: h.timeSec,
                }))) : null;
                // fuel/lap: prioritas practice avg → fallback prediksi game.
                const fpl = (sum && sum.ok && sum.values.fuelAvg != null) ? sum.values.fuelAvg : drv.fuelPerLap;
                const fuelRec = (raceLaps != null && fpl != null)
                    ? IGPCore.recommendRaceFuel({ raceLaps: raceLaps, fuelPerLap: fpl, advancedFuel: drv.advancedFuel, reserveLaps: 0 })
                    : null;
                // umur ban: game dNTyreLife (per compound, ambil min) → fallback practice.
                let life = null;
                let lifeSrc = null;
                const tl = drv.tyreLife;
                if (tl && typeof tl === 'object' && !Array.isArray(tl)) {
                    const vals = Object.values(tl).map(Number).filter(v => Number.isFinite(v) && v > 0);
                    if (vals.length) { life = Math.min.apply(null, vals); lifeSrc = 'game'; }
                }
                const tyreAvg = (sum && sum.ok) ? sum.values.tyreAvg : null;
                if (life == null && tyreAvg != null) {
                    const pr = IGPCore.practiceTyreLife({ tyrePerLap: tyreAvg, threshold: 80 });
                    if (pr.ok) { life = pr.values.life; lifeSrc = 'practice'; }
                }
                const strat = IGPCore.summarizeStrategy({
                    strategy: drv.strategy, raceLaps: raceLaps, fuelPerLap: drv.fuelPerLap,
                    advancedFuel: drv.advancedFuel,
                    ruleTwoTyres: twoTyres, ruleRefuelling: String(rules.refuelling) === '1',
                });
                if (!fuelRec && !strat.ok && life == null) continue; // gagal jujur: tanpa tulisan
                // Stint rekomendasi dari umur ban (bila ada) vs total lap.
                let stintTxt = null;
                if (raceLaps != null && life != null && life > 0) {
                    const sp = IGPCore.stintSplit({ totalLaps: raceLaps, tireLifeLaps: life, pitLossLaps: 0 });
                    if (sp.ok) stintTxt = sp.values.stints.join('/') + ' lap (' + sp.values.stops + ' pit, umur ' + life + ' lap/' + lifeSrc + ')';
                }
                // Fuel: estimasi & perbandingan ditulis pada label asli "Fuel (litres)"
                // di .c-wrap input (BUKAN komentar pembalap). Dasar = konsumsi practice
                // per lap × Total laps estimate game; tanpa cadangan tambahan.
                const adv = document.getElementById('d' + n + 'AdvancedFuel');
                const host = adv ? adv.closest('.c-wrap') : null;
                const label = host && Array.from(host.childNodes).find(nd => nd.nodeType === 3 && /Fuel\s*\(litres\)/i.test(nd.textContent));
                if (adv && label && fuelRec && fuelRec.ok) {
                    // attr = teks asli; aman bila render dipanggil tanpa restore lebih dulu.
                    const original = host.getAttribute('data-igpas-orig') || label.textContent;
                    const gameLaps = Number(drv.totalLapsGame);
                    const useGameLaps = Number.isFinite(gameLaps) && gameLaps > 0;
                    const plannedLaps = useGameLaps ? gameLaps : raceLaps;
                    const estimate = IGPCore.recommendRaceFuel({
                        raceLaps: plannedLaps, fuelPerLap: fpl,
                        advancedFuel: Utils.numOrNull(adv.value), reserveLaps: 0,
                    });
                    if (estimate.ok) {
                        const v = estimate.values;
                        host.setAttribute('data-igpas-orig', original);
                        host.setAttribute('data-igpas-origmode', 'node');
                        label.textContent = original.trim() + ' · estimasi ' + v.need + ' L / ' + plannedLaps + ' lap' +
                            ' · terisi ' + (v.advancedFuel == null ? '—' :
                                v.advancedFuel + ' L' + (v.buffer == null ? '' :
                                    ' (' + (v.buffer >= 0 ? '+' : '') + v.buffer + ' L)')) + ' ';
                        saveTitle(host);
                        const detail = 'Estimasi ' + fpl + ' L/lap × ' + plannedLaps + ' lap (' +
                            (useGameLaps ? 'Total laps estimate game' : 'jarak balapan — Total laps estimate belum terbaca') +
                            ') = ' + v.need + ' L, tanpa cadangan tambahan. Selisih terisi: ' +
                            (v.advancedFuel == null ? '—' : r1(v.advancedFuel - v.need) + ' L') +
                            '. Sumber fuel/lap: ' + ((sum && sum.ok && sum.values.fuelAvg != null)
                                ? 'practice (' + sum.values.fuelAvg + ' L/lap, ' + sum.values.count + ' lap)' : 'prediksi game (practice belum tersedia)') +
                            '. Konsumsi aktual dapat berbeda.';
                        host.setAttribute('title', detail);
                        host.setAttribute('data-igpas-written-title', detail);
                    }
                }
                const tot = document.getElementById('d' + n + 'TotalLaps');
                if (tot && strat.ok) {
                    saveTitle(tot);
                    const tip = 'Total stint game ' + strat.values.lapsTotal + '/' + raceLaps + ' lap' +
                        (strat.values.lapsShort ? ' (kurang ' + strat.values.lapsShort + ')' : ' (pas)') +
                        (stintTxt ? '; saran stint ' + stintTxt : '') +
                        (strat.values.twoTyreOk === false ? '; ⚠ butuh 2 compound kering' : '') +
                        ' — estimasi, bukan rumus game.';
                    tot.setAttribute('title', tip);
                    tot.setAttribute('data-igpas-written-title', tip);
                }
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
            ' #leagueDesignData, #carAttributesBonuses, .carsSuppliers, .supplyDialog,' +
            ' #engine-table, #chassis-table, #drivers, #staff, #driverStatsTable,' +
            ' #driver-table, #staff-table, #cdTransfersRefresh, #setup, #strategy, #pageId';
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
        function mutationRelevant(m) {
            if (!m) return false;
            const own = el => !!(el && el.closest && el.closest('.igpas-adv-panel, #' + PREFIX + '-toggle'));
            const t = m.target;
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
            if (['cars', 'manufacturers', 'staff', 'transfers', 'race'].indexOf(pid) === -1) {
                // Halaman lain: tanpa jejak UI apa pun (disiplin study-only).
                removeIfAny([PREFIX + '-toggle', PREFIX + '-design', PREFIX + '-supply',
                    PREFIX + '-supply-compare', PREFIX + '-mfg-engine', PREFIX + '-mfg-chassis',
                    PREFIX + '-team', PREFIX + '-team-compare',
                    PREFIX + '-tx-driver', PREFIX + '-tx-staff', PREFIX + '-tx-compare',
                    PREFIX + '-rsetup', PREFIX + '-rsetup-wrap',
                    PREFIX + '-rstrategy', PREFIX + '-rstrategy-wrap']);
                restoreDesign(); // kembalikan teks label asli (tanpa elemen baru)
                restoreSupply(); // kembalikan teks biaya kartu + judul dialog
                restoreManufacturers(); // kembalikan teks nama baris
                restoreTeamInPlace(); // kembalikan nama staff/transfers + title
                restoreRaceInPlace(); // kembalikan tulisan setup/strategy + title
                return;
            }
            observeOff(); // tulisan sendiri tidak memicu observer
            removeIfAny([PREFIX + '-style']);
            try {
                restoreDesign();
                restoreSupply();
                restoreManufacturers();
                restoreTeamInPlace();
                restoreRaceInPlace();
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
            document.addEventListener('input', ev => {
                if (ev.target && /^d[12]AdvancedFuel$/.test(ev.target.id)) renderAll();
            }, true);
            document.addEventListener('change', ev => {
                if (ev.target && /^d[12]AdvancedFuel$/.test(ev.target.id)) renderAll();
            }, true);
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
