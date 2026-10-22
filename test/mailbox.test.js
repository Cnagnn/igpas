// Test semantik mailbox dual-tab (Node murni) — I.G.P.A.S v0.5.1.
// Proses terpisah: stub GM_* global SEBELUM require; ROLE='test' (tanpa location).
// Fokus: fix race v0.5.1 — pesan hanya dihapus setelah dikonsumsi penerima;
// pengirim tidak menghapus pesannya sendiri; basi/rusak dibersihkan janitor.
const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => {
  store.set(k, v);
};
global.GM_deleteValue = k => {
  store.delete(k);
};
global.GM_listValues = () => Array.from(store.keys());

const { Mailbox, INSTANCE_ID } = require("../src/igpas.user.js");

let pass = 0,
  fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log("  ✔ " + name);
  } catch (e) {
    fail++;
    console.error("  ✗ " + name + " — " + e.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert gagal");
}
function put(id, packet) {
  store.set("igpas:mb:" + id, packet);
}
function has(id) {
  return store.has("igpas:mb:" + id);
}
function pkt(type, extra) {
  return Object.assign(
    {
      id: type + "-" + Math.random().toString(36).slice(2),
      type: type,
      to: "*",
      from: "sensor:fake",
      ts: Date.now(),
      payload: {},
    },
    extra || {}
  );
}

t("pesan sendiri TIDAK dihapus oleh poll pengirim (fix race 400 ms)", () => {
  Mailbox.send("collect-request", { kinds: ["account-data"] });
  Mailbox.pollOnce();
  const own = Array.from(store.keys()).filter(k => k.indexOf("igpas:mb:") === 0);
  assert(own.length === 1, "pesan sendiri hilang sebelum dibaca tab lain (n=" + own.length + ")");
});

t("pesan asing dengan handler: di-dispatch + dihapus (read-once)", () => {
  let got = null;
  Mailbox.on("collect-request", p => {
    got = p.payload;
  });
  put("t2", pkt("collect-request", { id: "t2", payload: { kinds: ["car-data"] } }));
  Mailbox.pollOnce();
  assert(got && got.kinds && got.kinds[0] === "car-data", "handler tidak menerima payload");
  assert(!has("t2"), "paket ter-konsumsi tidak dihapus");
});

t("tipe tanpa handler di peran ini: dibiarkan (untuk peran lain)", () => {
  put("t3", pkt("unknown-type", { id: "t3" }));
  Mailbox.pollOnce();
  assert(has("t3"), "paket tanpa handler terhapus");
  store.delete("igpas:mb:t3");
});

t("alamat penuh rol:instance hanya dikonsumsi instance itu", () => {
  let got = null;
  Mailbox.on("collect-request", p => {
    got = p.payload;
  });
  put(
    "addr1",
    pkt("collect-request", {
      id: "addr1",
      to: "test:" + INSTANCE_ID,
      payload: { kinds: ["car-data"] },
    })
  );
  Mailbox.pollOnce();
  assert(
    got && got.kinds && got.kinds[0] === "car-data",
    "paket beralamat instance ini tidak dikonsumsi"
  );
  assert(!has("addr1"), "paket beralamat instance ini tidak dihapus");
  got = null;
  put(
    "addr2",
    pkt("collect-request", {
      id: "addr2",
      to: "test:instance-lain",
      payload: { kinds: ["car-data"] },
    })
  );
  Mailbox.pollOnce();
  assert(got === null, "paket untuk instance lain dikonsumsi");
  assert(has("addr2"), "paket untuk instance lain dihapus");
  store.delete("igpas:mb:addr2");
});

t("pesan untuk instance lain: tidak dikonsumsi & tidak dihapus", () => {
  let got = null;
  Mailbox.on("report", p => {
    got = p;
  });
  put("t4", pkt("report", { id: "t4", to: "instance-lain", from: "gui:other" }));
  Mailbox.pollOnce();
  assert(got === null, "handler jalan untuk pesan bukan milik kita");
  assert(has("t4"), "pesan bukan milik kita terhapus");
  store.delete("igpas:mb:t4");
});

t("hasil basi (>2 mnt): dibersihkan janitor tanpa dispatch", () => {
  let got = null;
  Mailbox.on("stale-type", p => {
    got = p;
  });
  put("t5", pkt("stale-type", { id: "t5", ts: Date.now() - 3 * 60 * 1000 }));
  Mailbox.pollOnce();
  assert(got === null, "hasil basi di-dispatch");
  assert(!has("t5"), "hasil basi tidak dibersihkan");
});

t("permintaan 60 dtk masih hidup (user sempat pindah tab)", () => {
  let got = null;
  Mailbox.on("collect-request", p => {
    got = p.payload;
  });
  put(
    "t8",
    pkt("collect-request", { id: "t8", ts: Date.now() - 60000, payload: { kinds: ["staff-data"] } })
  );
  Mailbox.pollOnce();
  assert(
    got && got.kinds && got.kinds[0] === "staff-data",
    "permintaan 60 dtk dibuang sebelum diproses"
  );
  assert(!has("t8"), "permintaan ter-konsumsi tidak dihapus");
});

t("permintaan >10 mnt: dibersihkan janitor (tidak abadi)", () => {
  let got = null;
  Mailbox.on("collect-request", p => {
    got = p.payload;
  });
  put(
    "t9",
    pkt("collect-request", {
      id: "t9",
      ts: Date.now() - 11 * 60 * 1000,
      payload: { kinds: ["car-data"] },
    })
  );
  Mailbox.pollOnce();
  assert(got === null, "permintaan 11 mnt di-dispatch");
  assert(!has("t9"), "permintaan 11 mnt tidak dibersihkan");
});

t("GM_setValue gagal: send() = false, tidak ada paket hantu", () => {
  const original = global.GM_setValue;
  global.GM_setValue = () => {
    throw new Error("quota");
  };
  try {
    const before = Array.from(store.keys()).sort().join("|");
    const ok = Mailbox.send("collect-request", { kinds: ["car-data"] });
    assert(ok === false, "send() melaporkan sukses padahal penyimpanan gagal");
    const after = Array.from(store.keys()).sort().join("|");
    assert(before === after, "paket hantu tetap tersimpan");
  } finally {
    global.GM_setValue = original;
  }
});

t("read-once: poll berulang tidak memicu handler dua kali", () => {
  let n = 0;
  Mailbox.on("read-once", () => {
    n++;
  });
  put("t7", pkt("read-once", { id: "t7" }));
  Mailbox.pollOnce();
  Mailbox.pollOnce();
  assert(n === 1, "handler dipanggil " + n + "× (harus 1)");
  assert(!has("t7"), "paket read-once tidak dihapus");
});

t("nilai rusak (bukan objek): dibersihkan", () => {
  store.set("igpas:mb:t6", "not-a-packet");
  Mailbox.pollOnce();
  assert(!has("t6"), "nilai rusak tidak dibersihkan");
});

console.log("\n" + pass + " test, " + fail + " gagal" + (fail ? "" : " — semua lulus ✔"));
process.exit(fail ? 1 : 0);
