// In-page Advisor tests (v0.7.0) — the real userscript against real fixture DOM
// (jsdom, runScripts outside-only). Verifies:
//   - design rows (Cars) sorted #1..#n + ranked labels, without colour;
//   - supply buttons inside .supplyDialog coloured by recommendation (no verdict text);
//   - engine+chassis ranking on the Manufacturers page;
//   - NO trace of advisor UI on other pages (race etc.);
//   - the advisor never sends mailbox packets (game requests = 0).
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const load = fixtureFile => fs.readFileSync(path.join(__dirname, "fixtures", fixtureFile), "utf8");

function bootOn(html, url, snapshotIds) {
  const writes = []; // spy: the userscript MUST NOT write storage
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window;
  win.GM_setValue = (k, _v) => {
    writes.push(k);
  };
  win.GM_setClipboard = () => {}; // stub; tests override it for capture
  win.GM_registerMenuCommand = (label, fn) => {
    win.__igpasMenus = win.__igpasMenus || {};
    win.__igpasMenus[label] = fn;
    // Back-compat for the capture tests: the DOM capture entry, not the census.
    if (/dom capture/i.test(label) && !/census/i.test(label)) win.__igpasMenuHandler = fn;
  };
  win.GM_notification = () => {};
  // Snapshot innerHTML BEFORE the userscript runs (to test "document unchanged").
  const before = {};
  for (const id of snapshotIds || []) {
    const el = win.document.getElementById(id);
    before[id] = el ? el.innerHTML : null;
  }
  win.eval(fs.readFileSync(path.join(__dirname, "../src/igpas.user.js"), "utf8"));
  win.document.dispatchEvent(new win.Event("DOMContentLoaded")); // idempotent on the userscript side
  return { win, doc: win.document, writes, before, close: () => win.close() };
}

function assert(ok, msg) {
  if (!ok) throw new Error(msg);
}

// Invoke a menu command registered by the userscript (label match).
function runMenu(s, re) {
  const labels = Object.keys(s.win.__igpasMenus || {});
  const label = labels.filter(l => re.test(l))[0];
  assert(label, "menu not registered for " + re + " (got: " + labels.join(" | ") + ")");
  s.win.__igpasMenus[label]();
}

let pass = 0,
  fail = 0;
const asyncTests = [];
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
function ta(name, fn) {
  asyncTests.push([name, fn]);
}

const URL_IGP = "https://www.igpmanager.com/app/p=cars";
const URL_TRANSFERS = "https://www.igpmanager.com/app/p=transfers";
const URL_FINANCES = "https://www.igpmanager.com/app/p=finances";
const URL_HOME = "https://www.igpmanager.com/app/p=home";
const URL_RACE = "https://www.igpmanager.com/app/index.php?page=race&tab=race";

t("Design advisor: Cars rows sorted #1..#n, ranked labels, without colour", () => {
  const s = bootOn(load("cars.html"), URL_IGP);
  // No new section/badge: the only advisor element = toggle (+ style in head).
  assert(!s.doc.querySelector("section.igpas-adv-panel"), "separate panel still present");
  assert(
    !s.doc.querySelector(".igpas-adv-inline"),
    "leftover badge from an old version is still present"
  );
  const rows = s.doc.querySelectorAll("#carAttributesDisplay .attribute-row");
  assert(rows.length === 8, "original rows must stay 8, got " + rows.length);
  const labels = Array.prototype.map.call(
    rows,
    r => r.querySelector(".attribute-rating-header span:not(.ratingVal)").textContent
  );
  assert(
    labels.every(x => /^#\d+ /.test(x)),
    "unranked label (got: " + labels.join(" | ") + ")"
  );
  assert(labels.filter(x => /^#1 /.test(x)).length === 1, "there must be exactly one #1 rank");
  assert(
    labels[0] === "#1 Fuel economy · 26 DP",
    "rank #1 must be Fuel economy ±26 DP (got: " + labels.join(" | ") + ")"
  );
  assert(labels[7] === "#8 Braking · 24 DP", "rank #8 is wrong: " + labels[7]);
  // DOM order must follow rank: the largest gap on top.
  const order = Array.prototype.map.call(rows, r => r.id).join(",");
  assert(
    order ===
      "wrap-fuel_economy,wrap-tyre_economy,wrap-cooling,wrap-downforce," +
        "wrap-handling,wrap-reliability,wrap-acceleration,wrap-braking",
    "row order does not follow priority: " + order
  );
  // Colour is NOT used on Cars.
  assert(
    Array.prototype.every.call(rows, r => !r.hasAttribute("style")),
    "Cars rows are still given colour styles"
  );
  // Original text & order stored for restore; game numbers & bars untouched.
  const accel = s.doc.getElementById("wrap-acceleration");
  assert(
    accel.getAttribute("data-igpas-orig") === "Acceleration",
    "original text not stored in data-igpas-orig"
  );
  assert(accel.hasAttribute("data-igpas-orig-order"), "original order not stored");
  assert(
    s.doc.querySelector("#wrap-acceleration .ratingVal").textContent.trim() === "53",
    "game value changed"
  );
  assert(
    s.doc.querySelector("#wrap-acceleration .ratingBar div").getAttribute("style") === "width:18%",
    "game bar changed"
  );
  // Details + estimate in the same row's title.
  const t1 = s.doc.getElementById("wrap-fuel_economy").getAttribute("title");
  assert(/Priority #1/.test(t1), "title without rank #1: " + t1);
  assert(/league max/i.test(t1), "title without max league");
  assert(/estimate/i.test(t1), "title without estimate label");
  s.close();
});

t("Design advisor: Research & Upgrade tabs follow the same #1..#n order", () => {
  const s = bootOn(load("cars-tabs.html"), URL_IGP);
  const EXPECT =
    "acceleration,fuel_economy,handling,downforce,braking,cooling,reliability,tyre_economy";
  // Overview still ranked (the ranking source is unchanged).
  const firstLabel = s.doc
    .querySelector("#carAttributesDisplay .attribute-row .attribute-rating-header span")
    .textContent.trim();
  assert(/^#1 Acceleration/.test(firstLabel), "Overview rank #1 changed: " + firstLabel);
  // Upgrade tab: rows moved into priority order.
  const upgrade = s.doc.getElementById("designInline");
  const upNames = Array.prototype.map
    .call(upgrade.querySelectorAll('.attribute-row input[type="number"]'), i =>
      i.getAttribute("name")
    )
    .join(",");
  assert(upNames === EXPECT, "Upgrade order does not follow priority: " + upNames);
  // Hidden form fields stay last, and game input values are untouched.
  assert(
    upgrade.lastElementChild && upgrade.lastElementChild.getAttribute("name") === "league",
    "hidden field is no longer last in the Upgrade form"
  );
  const acc = upgrade.querySelector('input[name="acceleration"]');
  assert(
    acc.value === "29" &&
      acc.getAttribute("min") === "29" &&
      acc.getAttribute("data-base") === "29",
    "Upgrade input values changed: " +
      [acc.value, acc.getAttribute("min"), acc.getAttribute("data-base")].join("/")
  );
  // Research tab: same order, checkboxes keep id/value/state.
  const research = s.doc.getElementById("researchInline");
  const rsValues = Array.prototype.map
    .call(research.querySelectorAll('.attribute-row input[type="checkbox"]'), i =>
      i.getAttribute("value")
    )
    .join(",");
  assert(rsValues === EXPECT, "Research order does not follow priority: " + rsValues);
  const handling = research.querySelector('input[value="handling"]');
  assert(handling && handling.id === "chandling" && handling.checked, "checkbox state/id lost");
  assert(
    research.lastElementChild.getAttribute("name") === "league",
    "hidden field is no longer last in the Research form"
  );
  // Tab labels get the same #1..#n rank as the Overview (game text kept, no DP suffix).
  const EXPECT_LABELS = [
    "#1 Acceleration",
    "#2 Fuel economy",
    "#3 Handling",
    "#4 Downforce",
    "#5 Braking",
    "#6 Cooling",
    "#7 Reliability",
    "#8 Tyre economy",
  ];
  const labelsOf = form =>
    Array.prototype.map.call(
      form.querySelectorAll(".attribute-row .attribute-rating-header span:not(.ratingVal)"),
      el => el.textContent.trim()
    );
  assert(
    labelsOf(research).join(" | ") === EXPECT_LABELS.join(" | "),
    "Research labels not ranked: " + labelsOf(research).join(" | ")
  );
  assert(
    labelsOf(upgrade).join(" | ") === EXPECT_LABELS.join(" | "),
    "Upgrade labels not ranked: " + labelsOf(upgrade).join(" | ")
  );
  // The rank is written once: re-render must not stack "#1 #1".
  assert(
    labelsOf(research).every(x => !/^#\d+ #/.test(x)) &&
      labelsOf(upgrade).every(x => !/^#\d+ #/.test(x)),
    "duplicated rank prefix: " + labelsOf(research).join(" | ")
  );
  s.close();
});

t("Repair advisor: Fix/Replace buttons coloured, card titles not written", () => {
  const s = bootOn(load("cars-repair.html"), URL_IGP);
  const clean = el =>
    String(el.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  const bg = el => String(el.style.getPropertyValue("background-color") || "").toLowerCase();
  const heads = Array.prototype.slice.call(s.doc.querySelectorAll("#repair .c-head"));
  assert(heads.length === 2, "car cards must be 2, got " + heads.length);
  // No advice text is added to card titles.
  assert(clean(heads[0]) === "Car 1", "Car 1 title changed: " + clean(heads[0]));
  assert(clean(heads[1]) === "Car 2", "Car 2 title changed: " + clean(heads[1]));
  assert(!heads[0].hasAttribute("data-igpas-orig"), "Car 1 title was written by the advisor");
  assert(!heads[0].hasAttribute("title"), "advisor title attached to the Car 1 title");
  const fix = s.doc.getElementById("c1PartSwap");
  const eng = s.doc.getElementById("c1EngSwap");
  // Buttons stay game buttons: text & href intact, no clicks.
  assert(/^Fix\s+6$/.test(clean(fix)), "Fix button text changed: " + clean(fix));
  assert(/^Replace\s+1$/.test(clean(eng)), "Replace button text changed: " + clean(eng));
  assert(fix.getAttribute("href").indexOf("btn=c1PartSwap") >= 0, "Fix button href changed");
  assert(!fix.hasAttribute("data-igpas-orig"), "Fix button was written by the advisor");
  // Parts 30% = red (act now); engine 62% = grey (defer).
  assert(
    bg(fix) === "#c0392b" || bg(fix) === "rgb(192, 57, 43)",
    "Fix 30% must be red, got: " + bg(fix)
  );
  assert(
    bg(eng) === "#5d6d7e" || bg(eng) === "rgb(93, 109, 126)",
    "Replace 62% must be grey, got: " + bg(eng)
  );
  // Stock/restock/estimate details stay in the button + circle title.
  const fixTitle = fix.getAttribute("title") || "";
  const engTitle = eng.getAttribute("title") || "";
  const condTitle = s.doc.getElementById("c6745727Condition").getAttribute("title") || "";
  assert(/fix now/.test(fixTitle), "Fix button title without advice: " + fixTitle);
  assert(/6 parts/.test(fixTitle) && /stock 51/.test(fixTitle), "Fix title without cost/stock");
  assert(/defer replace/.test(engTitle), "Replace button title without advice: " + engTitle);
  assert(
    /1 engine/.test(engTitle) && /stock 40/.test(engTitle),
    "Replace title without cost/stock"
  );
  assert(/restock 15 races/.test(engTitle), "Replace title without restock");
  assert(/fix now/.test(condTitle), "parts condition title without advice");
  assert(/estimate/i.test(fixTitle), "button title without estimate label");
  assert(
    !s.doc.querySelector("#repair [class*='igpas-adv']"),
    "advisor element leaked into Repair"
  );
  s.close();
});

t("Repair advisor: 55% condition uses amber colour (prepare)", () => {
  const html = load("cars-repair.html")
    .replace(/data-value="30"/g, 'data-value="55"')
    .replace(/data-value="62"/g, 'data-value="55"');
  const s = bootOn(html, URL_IGP);
  const bg = el => String(el.style.getPropertyValue("background-color") || "").toLowerCase();
  const fix = s.doc.getElementById("c1PartSwap");
  const eng = s.doc.getElementById("c1EngSwap");
  assert(
    bg(fix) === "#d68910" || bg(fix) === "rgb(214, 137, 16)",
    "Fix 55% must be amber, got: " + bg(fix)
  );
  assert(
    bg(eng) === "#d68910" || bg(eng) === "rgb(214, 137, 16)",
    "Replace 55% must be amber, got: " + bg(eng)
  );
  assert(/prepare to fix/.test(fix.getAttribute("title") || ""), "Fix title is not prepare");
  assert(
    /prepare to replace/.test(eng.getAttribute("title") || ""),
    "Replace title is not prepare"
  );
  s.close();
});

ta("Restore: Repair button colour/title returns after page change", async () => {
  const s = bootOn(load("cars-repair.html"), URL_IGP);
  const head = s.doc.querySelector("#repair .c-head");
  const cond = s.doc.getElementById("c6745727Condition");
  const fix = s.doc.getElementById("c1PartSwap");
  assert(head.textContent.replace(/\s+/g, " ").trim() === "Car 1", "Repair title changed");
  assert(fix.getAttribute("style"), "Repair button colour not applied");
  assert(fix.getAttribute("title"), "Repair button title not applied");
  assert(cond.getAttribute("title"), "condition title not applied");
  s.doc.getElementById("pageId").value = "staff";
  s.doc.getElementById("repair").appendChild(s.doc.createElement("div"));
  await new Promise(r => setTimeout(r, 25));
  assert(
    head.textContent.replace(/\s+/g, " ").trim() === "Car 1",
    "Repair title did not return: " + head.textContent
  );
  assert(!head.hasAttribute("data-igpas-orig"), "data-igpas-orig left behind on the title");
  assert(!head.hasAttribute("title"), "advisor title left behind on the title");
  assert(
    !fix.hasAttribute("style"),
    "Repair button style left behind: " + fix.getAttribute("style")
  );
  assert(!fix.hasAttribute("title"), "Repair button title left behind");
  assert(!fix.hasAttribute("data-igpas-orig-style"), "data-igpas-orig-style left behind");
  assert(!fix.hasAttribute("data-igpas-written-style"), "data-igpas-written-style left behind");
  assert(!cond.hasAttribute("title"), "advisor title left behind on the condition");
  assert(!cond.hasAttribute("data-igpas-title"), "data-igpas-title left behind on the condition");
  s.close();
});

t("Supply advisor: alternative buttons coloured by recommendation, cost text intact", () => {
  const s = bootOn(load("supply-engine.html"), URL_IGP);
  assert(!s.doc.querySelector("section.igpas-adv-panel"), "separate panel still present");
  const links = Array.prototype.slice.call(s.doc.querySelectorAll(".supplyDialog a.btn.confirm"));
  assert(links.length === 5, "alternative cards must be 5, got " + links.length);
  const textOf = a => {
    for (const nd of a.childNodes) {
      if (nd.nodeType === 3 && nd.textContent.trim() !== "") return nd.textContent.trim();
    }
    return "";
  };
  const texts = links.map(textOf);
  assert(
    texts.join("|") === "350k|500k|500k|500k|400k",
    "game cost text changed: " + texts.join(" | ")
  );
  const btnByEid = eid => {
    const re = new RegExp("eId=" + eid + "\\b");
    return links.find(a => re.test(a.getAttribute("data-tip") || ""));
  };
  const bg = el => String(el.style.getPropertyValue("background-color") || "").toLowerCase();
  // Active 8/1M vs best alternative Σ6/400k = 15/1M → eId6 red, the rest grey.
  assert(bg(btnByEid(6)) === "rgb(192, 57, 43)", "eId6 must be red: " + bg(btnByEid(6)));
  assert(bg(btnByEid(1)) === "rgb(93, 109, 126)", "eId1 must be grey: " + bg(btnByEid(1)));
  // The dialog header stays game-owned: no inline style at all, so the active card
  // keeps the original background instead of an advisor tint.
  const subhead = s.doc.querySelector(".supplyDialog .dialog-subhead");
  assert(
    !subhead.getAttribute("style"),
    "dialog header was styled: " + subhead.getAttribute("style")
  );
  const h2 = s.doc.querySelector(".dialog-subhead-content h2");
  assert(h2.textContent === "Engine supply", "dialog title was written: " + h2.textContent);
  assert(!h2.hasAttribute("data-igpas-orig"), "title still uses the old text annotation");
  const ht = h2.getAttribute("title") || "";
  assert(/value\/1M 15/.test(ht), "header title without alternative value: " + ht);
  assert(/switch advised/.test(ht), "header title without verdict: " + ht);
  assert(/(#4 of 6)/.test(ht), "header title without active rank: " + ht);
  assert(
    /Rule: switch only when an alternative is ≥5% more efficient/.test(ht),
    "title without threshold rule"
  );
  assert(/estimate/i.test(ht), "header title without estimate label");
  // Details stay in the card title; game price/icon/data-tip text is untouched.
  const card1 = btnByEid(1).closest(".inline-block");
  const t1 = card1.getAttribute("title") || "";
  assert(/#2 of 6/.test(t1), "card title without rank: " + t1);
  assert(/Σ bonus \+5/.test(t1), "card title without Σ bonus: " + t1);
  assert(/value\/1M/.test(t1), "card title without value/1M");
  assert(/estimate/i.test(t1), "card title without estimate label");
  const card6 = btnByEid(6).closest(".inline-block");
  assert(/#1 of 6/.test(card6.getAttribute("title") || ""), "best card without #1");
  assert(
    /switch recommended/.test(card6.getAttribute("title") || ""),
    "best card without a recommendation"
  );
  assert(btnByEid(1).querySelector('img[src*="/img/cash2-64.webp"]'), "game cost icon is missing");
  assert(/eId=1/.test(btnByEid(1).getAttribute("data-tip") || ""), "game data-tip changed");
  assert(btnByEid(6).hasAttribute("data-igpas-orig-style"), "button style is not marked");
  s.close();
});

t("Supply advisor: active supplier is more efficient → grey buttons, header untouched", () => {
  // Complaint scenario: active supplier Σ4 @250k = 16/1M, best alternative
  // Σ6 @400k = 15/1M. Do not crown the alternative — keep the active one.
  const s = bootOn(load("supply-engine.html").replace("500k per race", "250k per race"), URL_IGP);
  const links = Array.prototype.slice.call(s.doc.querySelectorAll(".supplyDialog a.btn.confirm"));
  assert(links.length === 5, "alternative cards must be 5, got " + links.length);
  const bg = el => String(el.style.getPropertyValue("background-color") || "").toLowerCase();
  assert(
    links.every(a => bg(a) === "rgb(93, 109, 126)"),
    "a button other than grey is still present: " + links.map(bg).join(" | ")
  );
  const subhead = s.doc.querySelector(".supplyDialog .dialog-subhead");
  assert(
    !subhead.getAttribute("style"),
    "dialog header was styled: " + subhead.getAttribute("style")
  );
  const h2 = s.doc.querySelector(".dialog-subhead-content h2");
  assert(h2.textContent === "Engine supply", "dialog title was written: " + h2.textContent);
  const ht = h2.getAttribute("title") || "";
  assert(/value\/1M 16/.test(ht), "header title without active value: " + ht);
  assert(/Verdict: keep/.test(ht), "header title does not state keep: " + ht);
  assert(/(#1 of 6)/.test(ht), "header title without active rank: " + ht);
  const card = links[0].closest(".inline-block");
  assert(
    /active #1 \(16\/1M\) — keep/.test(card.getAttribute("title") || ""),
    "card title does not confirm keep: " + card.getAttribute("title")
  );
  s.close();
});

t("Supply advisor: Fuel dialog — best button red, original price intact", () => {
  const s = bootOn(load("supply-fuel.html"), URL_IGP);
  assert(!s.doc.querySelector("section.igpas-adv-panel"), "separate panel still present");
  const links = Array.prototype.slice.call(s.doc.querySelectorAll(".supplyDialog a.btn.confirm"));
  assert(links.length === 4, "fuel cards must be 4, got " + links.length);
  const textOf = a => {
    for (const nd of a.childNodes) {
      if (nd.nodeType === 3 && nd.textContent.trim() !== "") return nd.textContent.trim();
    }
    return "";
  };
  assert(
    links.map(textOf).join("|") === "35k|60k|30k|40k",
    "fuel cost text changed: " + links.map(textOf).join(" | ")
  );
  const btnByEid = eid => {
    const re = new RegExp("eId=" + eid + "\\b");
    return links.find(a => re.test(a.getAttribute("data-tip") || ""));
  };
  const bg = el => String(el.style.getPropertyValue("background-color") || "").toLowerCase();
  // Active 40/1M. Alternative 30k Σ2 = 66.67/1M → eId10 red.
  assert(bg(btnByEid(10)) === "rgb(192, 57, 43)", "eId10 fuel must be red");
  assert(bg(btnByEid(7)) === "rgb(93, 109, 126)", "eId7 fuel must be grey");
  const h2 = s.doc.querySelector(".dialog-subhead-content h2");
  assert(/^Fuel supply/.test(h2.textContent), "fuel dialog title changed: " + h2.textContent);
  assert(!/·/.test(h2.textContent), "fuel title still has verdict text: " + h2.textContent);
  const ht = h2.getAttribute("title") || "";
  assert(/switch advised/.test(ht), "fuel title without verdict: " + ht);
  s.close();
});

t("Supply advisor: Tyre dialog — best button red, original price intact", () => {
  const s = bootOn(load("supply-tyre.html"), URL_IGP);
  assert(!s.doc.querySelector("section.igpas-adv-panel"), "separate panel still present");
  const links = Array.prototype.slice.call(s.doc.querySelectorAll(".supplyDialog a.btn.confirm"));
  assert(links.length === 4, "tyre cards must be 4, got " + links.length);
  const textOf = a => {
    for (const nd of a.childNodes) {
      if (nd.nodeType === 3 && nd.textContent.trim() !== "") return nd.textContent.trim();
    }
    return "";
  };
  assert(
    links.map(textOf).join("|") === "100k|60k|90k|50k",
    "tyre cost text changed: " + links.map(textOf).join(" | ")
  );
  const btnByEid = eid => {
    const re = new RegExp("eId=" + eid + "\\b");
    return links.find(a => re.test(a.getAttribute("data-tip") || ""));
  };
  const bg = el => String(el.style.getPropertyValue("background-color") || "").toLowerCase();
  // Active 20/1M (tie with 100k, active wins). 60k Σ2 = 66.67/1M → eId14 red.
  assert(bg(btnByEid(14)) === "rgb(192, 57, 43)", "eId14 tyre must be red");
  assert(bg(btnByEid(12)) === "rgb(93, 109, 126)", "eId12 tyre must be grey");
  const h2 = s.doc.querySelector(".dialog-subhead-content h2");
  assert(/^Tyre supply/.test(h2.textContent), "tyre dialog title changed: " + h2.textContent);
  assert(!/·/.test(h2.textContent), "tyre title still has verdict text: " + h2.textContent);
  const ht = h2.getAttribute("title") || "";
  assert(/switch advised/.test(ht), "tyre title without verdict: " + ht);
  s.close();
});

t(
  "Manufacturers advisor: ranks written into the original engine & chassis rows, without new elements",
  () => {
    const s = bootOn(
      load("manufacturers-engines.html"),
      "https://www.igpmanager.com/app/p=manufacturers"
    );
    assert(!s.doc.querySelector("section.igpas-adv-panel"), "separate panel still present");
    for (const tid of ["engine-table", "chassis-table"]) {
      const rows = s.doc.querySelectorAll("#" + tid + " tbody tr");
      assert(rows.length > 0, "table " + tid + " is empty");
      const names = Array.prototype.map.call(rows, tr => {
        const tds = tr.querySelectorAll("td");
        for (const nd of tds[0].childNodes) {
          if (nd.nodeType === 3 && nd.textContent.trim() !== "") return nd.textContent;
        }
        return "";
      });
      assert(
        names.every(x => /^#\d+ /.test(x)),
        tid + ": row without rank (" + names.slice(0, 3).join(" | ") + "…)"
      );
      assert(
        names.filter(x => /^#1 /.test(x)).length === 1,
        tid + ": there must be exactly one #1 rank"
      );
    }
    // Engine: rating 100 + highest rating/1M → CAVEIRA #1.
    const engNames = Array.prototype.map.call(
      s.doc.querySelectorAll("#engine-table tbody tr td:first-child"),
      td => {
        for (const nd of td.childNodes) {
          if (nd.nodeType === 3 && nd.textContent.trim() !== "") return nd.textContent;
        }
        return "";
      }
    );
    assert(
      engNames.some(x => /^#1 CAVEIRA$/.test(x)),
      "rank #1 engine must be CAVEIRA (got: " +
        engNames
          .filter(x => /^#\d+ /.test(x))
          .slice(0, 5)
          .join(" | ") +
        ")"
    );
    // Chassis: highest rating → '0 failures' #1 (local name order).
    const chNames = Array.prototype.map.call(
      s.doc.querySelectorAll("#chassis-table tbody tr td:first-child"),
      td => {
        for (const nd of td.childNodes) {
          if (nd.nodeType === 3 && nd.textContent.trim() !== "") return nd.textContent;
        }
        return "";
      }
    );
    assert(
      chNames.some(x => /^#1 0 failures$/.test(x)),
      "rank #1 chassis is wrong (got: " + chNames.filter(y => /^#1 /.test(y)).join(" | ") + ")"
    );
    // Original name stored; links, flags, game ratings untouched.
    const caveira = Array.prototype.slice
      .call(s.doc.querySelectorAll("#engine-table tbody tr"))
      .filter(tr => /^#1 /.test(tr.textContent))[0];
    assert(
      caveira.getAttribute("data-igpas-orig") === "CAVEIRA",
      "original name not stored in data-igpas-orig"
    );
    assert(caveira.querySelector('a[href*="id="]'), "game link is missing");
    assert(
      /Rating: 100%/.test(caveira.querySelector(".tooltip").getAttribute("data-tip") || ""),
      "game rating changed"
    );
    // Details + estimate in the same row's title.
    assert(/rating 100%/.test(caveira.getAttribute("title") || ""), "title without rating");
    assert(
      /rating\/1M/.test(caveira.getAttribute("title") || ""),
      "engine title without rating/1M"
    );
    assert(/estimate/i.test(caveira.getAttribute("title") || ""), "title without estimate label");
    s.close();
  }
);

t("PageCapture: surface census maps structure only (no text, no values)", () => {
  const s = bootOn(load("cars-tabs.html"), URL_IGP);
  const copied = [];
  s.win.GM_setClipboard = (data, type) => copied.push({ data: String(data), type: type });
  runMenu(s, /census/i);
  assert(copied.length === 1, "census menu did not fill the clipboard");
  assert(copied[0].type === "text/plain", "census clipboard type is " + copied[0].type);
  const txt = copied[0].data;
  assert(/^I\.G\.P\.A\.S surface census/.test(txt), "census header missing:\n" + txt);
  assert(/page: cars/.test(txt), "pageId missing from census:\n" + txt);
  assert(
    /#designInline type=design cb=carsDesignSaved/.test(txt),
    "Upgrade form not mapped:\n" + txt
  );
  assert(
    /#researchInline type=research cb=carsResearchSaved/.test(txt),
    "Research form not mapped:\n" + txt
  );
  assert(/number:acceleration/.test(txt), "Upgrade number field not listed:\n" + txt);
  assert(/checkbox:c\[\]/.test(txt), "Research checkbox field not listed:\n" + txt);
  assert(/hidden×/.test(txt), "hidden fields not counted:\n" + txt);
  assert(
    /attribute rows: #carAttributesDisplay=8 #designInline=8 #researchInline=8/.test(txt),
    "attribute-row counts wrong:\n" + txt
  );
  assert(/data-tip×/.test(txt), "data-* vocabulary missing:\n" + txt);
  assert(/#carAttributes children=/.test(txt), "region list missing:\n" + txt);
  assert(/not captured by design/.test(txt), "privacy footer missing:\n" + txt);
  // Structure only: no row label text, no input values, no advisor output.
  assert(!/Acceleration|Tyre economy/.test(txt), "page text leaked into the census");
  assert(!/value=|#1 /.test(txt), "values or advisor ranks leaked into the census");
  s.close();
});

t("PageCapture: surface census never copies identity, credentials, or values", () => {
  const s = bootOn(
    "<!doctype html><html><body>" +
      '<input id="pageId" value="develop">' +
      '<span id="myProfileName">Rahasia Manager</span>' +
      '<span id="balanceText">$12.345.678</span>' +
      '<span id="tokens-total">42</span>' +
      '<span id="managerRankValue">777</span>' +
      '<form id="f1" action="send&addon=igp&type=develop">' +
      '<input type="number" name="budget" value="987654">' +
      '<input type="hidden" name="csrfToken" value="abc123secret">' +
      "</form></body></html>",
    "https://www.igpmanager.com/app/p=develop"
  );
  const copied = [];
  s.win.GM_setClipboard = data => copied.push(String(data));
  runMenu(s, /census/i);
  const txt = copied.join("\n");
  for (const secret of ["Rahasia Manager", "12.345.678", "987654", "abc123secret"]) {
    assert(txt.indexOf(secret) === -1, "census leaked: " + secret + "\n" + txt);
  }
  assert(/#f1 type=develop/.test(txt), "form not mapped:\n" + txt);
  assert(/hidden×1/.test(txt), "hidden field not counted:\n" + txt);
  assert(/number:budget/.test(txt), "named field not summarised:\n" + txt);
  s.close();
});

t("Security: other pages (race without a tab container/unknown) get no advisor UI at all", () => {
  const s = bootOn(
    '<!doctype html><html><body><input id="pageId" value="race"></body></html>',
    "https://www.igpmanager.com/app/index.php?page=raceStrategy"
  );
  for (const id of [
    "igpas-adv-toggle",
    "igpas-adv-design",
    "igpas-adv-supply",
    "igpas-adv-supply-compare",
    "igpas-adv-mfg-engine",
    "igpas-adv-mfg-chassis",
    "igpas-adv-team",
    "igpas-adv-team-compare",
    "igpas-adv-tx-driver",
    "igpas-adv-tx-staff",
    "igpas-adv-tx-compare",
    "igpas-adv-rsetup",
    "igpas-adv-rsetup-wrap",
    "igpas-adv-rstrategy",
    "igpas-adv-rstrategy-wrap",
  ]) {
    assert(!s.doc.getElementById(id), "advisor element leaked on the race page: " + id);
  }
  assert(
    !s.doc.querySelector(".igpas-adv-panel"),
    "advisor panel leaked on race without a tab container"
  );
  s.close();
});

t("Advisor read-only: does not write GM storage", () => {
  const s = bootOn(load("cars.html"), URL_IGP);
  assert(!s.writes.length, "advisor wrote storage: " + s.writes.join(","));
  s.close();
});

t("No extra advisor elements or toggle", () => {
  const s = bootOn(load("cars.html"), URL_IGP);
  assert(!s.doc.querySelector(".igpas-adv-panel"), "advisor panel still present");
  assert(!s.doc.getElementById("igpas-adv-toggle"), "advisor toggle still present");
  assert(!s.doc.getElementById("igpas-adv-style"), "advisor style still present");
  s.close();
});

t("PageCapture: Tampermonkey menu copies the DOM with PII redacted (without page UI)", () => {
  const s = bootOn(
    "<!doctype html><html><body>" +
      '<input id="pageId" value="develop">' +
      '<span id="myProfileName">Rahasia Manager</span>' +
      '<span id="balanceText">$12.345.678</span>' +
      '<span id="tokens-total">42</span>' +
      '<span id="managerRankValue">1234</span>' +
      '<div id="design-target">Design page harness</div>' +
      "</body></html>",
    "https://www.igpmanager.com/app/p=develop"
  );
  const captured = [];
  // simulate the user-driven capture menu (no UI is injected into the page)
  s.win.GM_setClipboard = (data, type) => captured.push({ data: data, type: type });
  const handler = s.win.__igpasMenuHandler;
  assert(typeof handler === "function", "capture menu is not registered");
  assert(
    !s.doc.getElementById("igpas-adv-toggle") && !s.doc.getElementById("igpas-adv-design"),
    "develop page is not mapped yet but advisor UI is present (it should not be)"
  );
  handler();
  assert(captured.length === 1, "clipboard not filled");
  assert(captured[0].type === "text/html", "clipboard type is not text/html");
  const html = captured[0].data;
  assert(
    html.indexOf("Rahasia Manager") === -1 && html.indexOf("[REDACTED]") >= 0,
    "manager name not redacted"
  );
  assert(html.indexOf("$12.345.678") === -1, "balance not redacted");
  assert(html.indexOf(">42<") === -1, "token not redacted");
  assert(html.indexOf("1234") === -1, "rank number not redacted");
  assert(html.indexOf("design-target") >= 0, "page DOM content was not copied");
  s.close();
});

t("PageCapture: sensitive fields, email, and executable scripts are not copied", () => {
  const s = bootOn(
    "<!doctype html><html><body>" +
      '<input id="pageId" value="develop">' +
      '<input type="hidden" id="csrfToken" value="abc123secret">' +
      '<input id="d1AdvancedFuel" type="number" value="174">' +
      '<textarea id="notes">private text</textarea>' +
      '<div id="bio">hubungi manager@example.com</div>' +
      '<div data-token="tok_live_123">x</div>' +
      '<script>window.__token = "inline-secret";</script>' +
      '<script type="application/json" id="d1StrategyJson">{"stint":{"1":{"tyre":"M","laps":16}}}</script>' +
      "</body></html>",
    "https://www.igpmanager.com/app/p=develop"
  );
  const captured = [];
  s.win.GM_setClipboard = data => captured.push(data);
  s.win.__igpasMenuHandler();
  const html = captured[0];
  assert(html.indexOf("abc123secret") === -1, "hidden input value (csrf) leaked");
  assert(html.indexOf("private text") === -1, "textarea content leaked");
  assert(html.indexOf("manager@example.com") === -1, "email leaked");
  assert(html.indexOf("tok_live_123") === -1, "data-token attribute leaked");
  assert(html.indexOf("inline-secret") === -1, "executable script was copied");
  // Game data needed for mapping stays intact.
  assert(html.indexOf('value="174"') >= 0, "game fuel value was redacted");
  assert(html.indexOf('"tyre":"M"') >= 0, "strategy JSON block is missing");
  s.close();
});

ta("Restore: title-only annotation (staff portrait) cleaned up after page change", async () => {
  const s = bootOn(load("staff.html"), "https://www.igpmanager.com/app/p=staff");
  const name = s.doc.querySelector("#d1Pic .driverName");
  assert(name, ".driverName is missing");
  assert(/Health|recovery/.test(name.getAttribute("title") || ""), "advisor title not applied");
  assert(name.hasAttribute("data-igpas-title"), "advisor title marker is missing");
  // Page change: the next renderAll must restore the original title.
  s.doc.getElementById("pageId").value = "cars";
  s.doc.getElementById("staff").appendChild(s.doc.createElement("div"));
  await new Promise(r => setTimeout(r, 25));
  assert(!name.hasAttribute("title"), "advisor title left behind: " + name.getAttribute("title"));
  assert(!name.hasAttribute("data-igpas-title"), "data-igpas-title left behind");
  assert(!name.hasAttribute("data-igpas-written-title"), "data-igpas-written-title left behind");
  s.close();
});

ta("Restore: game text changed after the advisor's write is not overwritten", async () => {
  const s = bootOn(load("transfers.html"), URL_TRANSFERS);
  const td = s.doc.querySelector("#driver-table tbody tr td");
  assert(/^#\d+ /.test(td.textContent), "advisor ranking not written");
  // The game updates the cell (AJAX/re-render) after the advisor writes.
  td.textContent = "NEW DRIVER NAME";
  s.doc.getElementById("pageId").value = "cars";
  s.doc.getElementById("driver-table").appendChild(s.doc.createElement("div"));
  await new Promise(r => setTimeout(r, 25));
  assert(
    td.textContent === "NEW DRIVER NAME",
    "game data overwritten by restore: " + td.textContent
  );
  assert(!td.hasAttribute("data-igpas-orig"), "data-igpas-orig left behind");
  s.close();
});

t("Staff advisor in-place", () => {
  const s = bootOn(load("staff.html"), "https://www.igpmanager.com/app/p=staff");
  assert(!s.doc.querySelector(".igpas-adv-panel"), "team panel still present");
  const d = s.doc.querySelector("#d1Pic .driverName");
  assert(d, ".driverName is missing");
  // <br> does not contribute a space to textContent: check both name parts.
  assert(d.textContent.indexOf("Syarif") >= 0, "driver first name is missing");
  assert(d.textContent.indexOf("Hartono") >= 0, "driver last name is missing");
  // Game structure intact: br + span still present, no new advisor elements.
  assert(d.querySelector("br") && d.querySelector("span"), ".driverName structure is broken");
  assert(!d.querySelector("[class*=igpas]"), "advisor element leaked into .driverName");
  // Clean label: name | Full Recover <countdown>, not "low health" jargon.
  const span = d.querySelector("span");
  assert(
    / \| Full Recover 14h 49m$/.test(span.textContent),
    "Full Recover label is wrong: " + span.textContent
  );
  const tip = d.getAttribute("title") || "";
  assert(/Health 2%/.test(tip), "health not included in title: " + tip);
  assert(/recovery 6\.615\/hr/.test(tip), "recovery rate not included in title: " + tip);
  assert(/Full Recover ±14h 49m/.test(tip), "ETA not included in title: " + tip);
  assert(/estimate/i.test(tip), "title without estimate label: " + tip);
  const h = s.doc.querySelector("#staff .c-wrap .c-head");
  assert(h && /Chief Designer/i.test(h.textContent), "staff header is missing");
  assert(
    /Wage|contract|card rating/i.test(h.getAttribute("title") || ""),
    "staff details not included in title"
  );
  s.close();
});

t("Transfers advisor in-place for driver and staff", () => {
  const s = bootOn(load("transfers.html"), "https://www.igpmanager.com/app/p=transfers");
  assert(!s.doc.querySelector(".igpas-adv-panel"), "transfers panel still present");
  const d = s.doc.querySelector("#driver-table tbody tr td");
  const st = s.doc.querySelector("#staff-table tbody tr td");
  assert(d && /^#\d+ /.test(d.textContent), "driver was not ranked in-place");
  assert(st && /^#\d+ /.test(st.textContent), "staff was not ranked in-place");
  // Game links & flags inside the cell stay alive (not victims of textContent).
  assert(d.querySelector("a.linkParent"), "driver contract link is broken");
  assert(d.querySelector("img.flag"), "driver flag is missing");
  assert(
    /overall|estimate/i.test(d.getAttribute("title") || ""),
    "driver details not included in title"
  );
  assert(
    /overall|estimate/i.test(st.getAttribute("title") || ""),
    "staff details not included in title"
  );
  s.close();
});

/* In-place advisor contract: no comparison panels are injected. */
t("Transfers comparison does not inject a panel", () => {
  const s = bootOn(load("transfers.html"), URL_TRANSFERS);
  assert(!s.doc.querySelector(".igpas-adv-panel"), "comparison panel still present");
  s.close();
});

/* Sponsor dialog (Finances): "best value" ranking on the original Sign buttons. */
t("Sponsor advisor: highest income green + ★, highest cash bonus amber", () => {
  const s = bootOn(load("sponsor-secondary.html"), URL_FINANCES);
  const table = s.doc.getElementById("sponsorSignTable");
  assert(table, "sponsor table is missing");
  const links = Array.prototype.slice.call(table.querySelectorAll('a[data-tip*="eId="]'));
  assert(links.length === 4, "Sign buttons must be 4, got " + links.length);
  const btnByEid = eid => {
    const re = new RegExp("eId=" + eid + "\\b");
    return links.find(a => re.test(a.getAttribute("data-tip") || ""));
  };
  const bg = el => String(el.style.getPropertyValue("background-color") || "").toLowerCase();
  const best = btnByEid(19);
  assert(/Sign ★/.test(best.textContent), "eId19 is not the primary choice: " + best.textContent);
  assert(bg(best) === "rgb(30, 132, 73)", "eId19 is not green: " + bg(best));
  const tip = best.getAttribute("title") || "";
  assert(/best value #1/.test(tip), "title without #1 verdict: " + tip);
  assert(/income 1\.6 M\/race \(guaranteed every race\)/.test(tip), "title without income: " + tip);
  assert(
    /cash bonus 102 K\/race if the objective is met/.test(tip),
    "title without bonus/race: " + tip
  );
  assert(/guaranteed 8 M \(5 races\)/.test(tip), "title without guarantee: " + tip);
  assert(/max potential 8\.5 M/.test(tip), "title without potential: " + tip);
  assert(/estimate, not the game formula/.test(tip), "title without estimate label: " + tip);
  const second = btnByEid(17);
  assert(/^Sponsor #2 of 4/.test(second.getAttribute("title") || ""), "eId17 is not #2");
  assert(
    /guaranteed 7\.5 M \(5 races\)/.test(second.getAttribute("title") || ""),
    "eId17 without guarantee"
  );
  assert(/max potential 9 M/.test(second.getAttribute("title") || ""), "eId17 without potential");
  assert(bg(second) === "", "eId17 must not be coloured: " + bg(second));
  // Highest cash bonus (eId2) = amber alternative + objective break-even.
  const alt = btnByEid(2);
  assert(bg(alt) === "rgb(185, 119, 14)", "eId2 is not amber: " + bg(alt));
  assert(!/Sign ★/.test(alt.textContent), "eId2 must not have ★");
  const altTip = alt.getAttribute("title") || "";
  assert(/^Sponsor #4 of 4/.test(altTip), "eId2 is not #4: " + altTip);
  assert(/highest cash bonus — trade-off against income/.test(altTip), "eId2 without trade-off");
  assert(/>84% of races/.test(altTip), "eId2 without break-even: " + altTip);
  assert(/max potential 9\.9 M/.test(altTip), "eId2 without potential: " + altTip);
  // Game numbers do not change.
  const rows = table.querySelectorAll("tr");
  const income = Array.prototype.map.call(rows[1].querySelectorAll("td"), td =>
    td.textContent.trim()
  );
  const bonus = Array.prototype.map.call(rows[2].querySelectorAll("td"), td =>
    td.textContent.trim()
  );
  assert(income.join("|") === "171k|428k|1.5m|1.6m", "income changed: " + income.join("|"));
  assert(bonus.join("|") === "1.8m|1.5m|306k|102k", "bonus changed: " + bonus.join("|"));
  // No new elements & no storage.
  assert(!s.doc.querySelector('[id^="igpas-adv"]'), "new advisor element was created");
  assert(!s.doc.querySelector(".igpas-adv-panel"), "advisor panel was created");
  assert(!s.writes.length, "advisor wrote storage: " + s.writes.join(","));
  s.close();
});

t("Sponsor advisor: term not read → income ranking, no invented totals", () => {
  const s = bootOn(load("sponsor-secondary.html").replace("5 race(s)", "—"), URL_FINANCES);
  const links = Array.prototype.slice.call(
    s.doc.querySelectorAll('#sponsorSignTable a[data-tip*="eId="]')
  );
  const best = links.find(a => /eId=19\b/.test(a.getAttribute("data-tip") || ""));
  assert(/Sign ★/.test(best.textContent), "eId19 is not the primary choice when the term is empty");
  const tip = best.getAttribute("title") || "";
  assert(/contract term not read/.test(tip), "title is not honest about the term: " + tip);
  assert(!/total \d/.test(tip), "total invented when the term is empty: " + tip);
  const first = links.find(a => /eId=2\b/.test(a.getAttribute("data-tip") || ""));
  assert(/^Sponsor #4 of 4/.test(first.getAttribute("title") || ""), "eId2 is not #4");
  assert(
    String(first.style.getPropertyValue("background-color") || "").toLowerCase() ===
      "rgb(185, 119, 14)",
    "eId2 is not amber when the term is empty"
  );
  s.close();
});

t("Sponsor advisor (primary): tokens first, cash bonus amber trade-off", () => {
  const s = bootOn(load("sponsor-primary.html"), URL_HOME);
  const table = s.doc.getElementById("sponsorSignTable");
  assert(table, "primary sponsor table is missing");
  const links = Array.prototype.slice.call(table.querySelectorAll('a[data-tip*="eId="]'));
  assert(links.length === 16, "Sign buttons must be 16, got " + links.length);
  const btnByEid = eid => {
    const re = new RegExp("eId=" + eid + "\\b");
    return links.find(a => re.test(a.getAttribute("data-tip") || ""));
  };
  const bg = el => String(el.style.getPropertyValue("background-color") || "").toLowerCase();
  // 3 tokens/race + cash bonus 612k = rank #1 (tokens first).
  const best = btnByEid(14);
  assert(/Sign ★/.test(best.textContent), "eId14 is not the primary choice: " + best.textContent);
  assert(bg(best) === "rgb(30, 132, 73)", "eId14 is not green: " + bg(best));
  const tip = best.getAttribute("title") || "";
  assert(/best value #1/.test(tip), "title without #1 verdict: " + tip);
  assert(/3 token\/race/.test(tip), "title without token/race: " + tip);
  assert(/cash bonus 612 K/.test(tip), "title without cash bonus: " + tip);
  assert(/contract term not read/.test(tip), "title is not honest about the term: " + tip);
  assert(
    /cash bonus 612 K\/race if the objective is met/.test(tip),
    "title without bonus/race: " + tip
  );
  assert(/token preferred/.test(tip), "title without the token model: " + tip);
  assert(!/total \d/.test(tip), "tokens must not be summed with cash: " + tip);
  // Highest cash bonus (eId2: 1 token + 1.8m) = amber alternative, not ★.
  const alt = btnByEid(2);
  assert(bg(alt) === "rgb(185, 119, 14)", "eId2 is not amber: " + bg(alt));
  assert(!/Sign ★/.test(alt.textContent), "eId2 must not have ★");
  const altTip = alt.getAttribute("title") || "";
  assert(/^Sponsor #14 of 16/.test(altTip), "eId2 is not #14: " + altTip);
  assert(
    /highest cash bonus — trade-off against tokens/.test(altTip),
    "eId2 without the trade-off label"
  );
  assert(/cash bonus 1\.8 M/.test(altTip), "eId2 without cash bonus: " + altTip);
  // 2 tokens/race, bonus 1.5m = #5, no colour.
  const mid = btnByEid(5);
  assert(/^Sponsor #5 of 16/.test(mid.getAttribute("title") || ""), "eId5 is not #5");
  assert(bg(mid) === "", "eId5 must not be coloured: " + bg(mid));
  // Game numbers (tokens & bonus) do not change.
  const rows = table.querySelectorAll("tr");
  const income = Array.prototype.map.call(rows[1].querySelectorAll("td"), td =>
    td.textContent.trim()
  );
  const bonus = Array.prototype.map.call(rows[2].querySelectorAll("td"), td =>
    td.textContent.trim()
  );
  assert(
    income.join("|") === "1|1|1|2|2|2|2|2|2|2|2|2|3|3|3|3",
    "token income changed: " + income.join("|")
  );
  assert(
    bonus.join("|") ===
      "1.8m|1.7m|1.6m|1.5m|1.4m|1.3m|1.2m|1.1m|1m|918k|816k|714k|612k|510k|306k|102k",
    "bonus changed: " + bonus.join("|")
  );
  assert(!s.doc.querySelector('[id^="igpas-adv"]'), "new advisor element was created");
  assert(!s.writes.length, "advisor wrote storage: " + s.writes.join(","));
  s.close();
});

ta("Sponsor advisor: idempotent re-render — ★ is not duplicated", async () => {
  const s = bootOn(load("sponsor-secondary.html"), URL_FINANCES);
  const table = s.doc.getElementById("sponsorSignTable");
  table.appendChild(s.doc.createElement("div")); // game mutation → observer render
  await new Promise(r => setTimeout(r, 50));
  assert(
    (table.textContent.match(/★/g) || []).length === 1,
    "★ duplicated after render: " + table.textContent
  );
  const marked = Array.prototype.filter.call(table.querySelectorAll('a[data-tip*="eId="]'), a =>
    /Sign ★/.test(a.textContent)
  );
  assert(marked.length === 1, "there must be one ★ button, got " + marked.length);
  s.close();
});

/* Race live/setup/strategy remain untouched: no advisor-owned DOM. */
t("Race does not inject advisor elements", () => {
  const s = bootOn(load("race.html"), URL_RACE);
  assert(!s.doc.querySelector(".igpas-adv-panel"), "race panel still present");
  assert(!s.doc.querySelector('[id^="igpas-adv"]'), "race advisor element still present");
  s.close();
});

ta("Race live (#race): innerHTML identical before/after boot & re-render", async () => {
  const s = bootOn(load("race.html"), URL_RACE, ["race"]);
  assert(s.before.race != null, "#race snapshot is not available");
  // A full re-render (user navigation) must not touch the live Race tab.
  s.doc.body.dispatchEvent(new s.win.Event("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  assert(
    s.doc.getElementById("race").innerHTML === s.before.race,
    "#race changed after render (live race must be read-only)"
  );
  s.close();
});

ta("Restore manufacturers: original name returns exactly, without duplication", async () => {
  const s = bootOn(
    load("manufacturers-engines.html"),
    "https://www.igpmanager.com/app/p=manufacturers"
  );
  const rows = Array.prototype.slice.call(s.doc.querySelectorAll("#engine-table tbody tr"));
  const tr = rows.filter(x => /Akina SpeedStars/.test(x.textContent))[0];
  assert(tr, "Akina row not found");
  const td = tr.querySelector("td");
  assert(/^#\d+ /.test(td.textContent), "ranking not written: " + td.textContent);
  s.doc.getElementById("pageId").value = "cars";
  s.doc.getElementById("engine-table").appendChild(s.doc.createElement("div"));
  await new Promise(r => setTimeout(r, 25));
  assert(
    td.textContent.trim() === "Akina SpeedStars",
    "manufacturers restore is wrong: " + JSON.stringify(td.textContent)
  );
  assert(
    td.textContent.split("Akina SpeedStars").length === 2,
    "name duplicated after restore: " + td.textContent
  );
  assert(!tr.hasAttribute("data-igpas-orig"), "data-igpas-orig left behind");
  s.close();
});

ta(
  "Instant render: Cars rows injected asynchronously by the game are ranked immediately without user action",
  async () => {
    // Build a render-async fixture: empty table (the game has not committed DOM yet).
    const base = new JSDOM(load("cars.html"));
    const bdoc = base.window.document;
    const rowsHtml = bdoc.getElementById("carAttributesDisplay").innerHTML;
    assert(
      (rowsHtml.match(/attribute-row/g) || []).length >= 8,
      "fixture precondition: needs 8 rows"
    );
    bdoc.getElementById("carAttributesDisplay").innerHTML = "";
    const s = bootOn(base.serialize(), URL_IGP);
    base.window.close();
    const disp = s.doc.getElementById("carAttributesDisplay");
    assert(disp && disp.children.length === 0, "precondition: table must be empty");
    assert(
      !s.doc.querySelector(".attribute-row[data-igpas-orig]"),
      "precondition: nothing written yet"
    );
    // The game commits DOM asynchronously (one innerHTML, no user click/keyboard/navigation).
    disp.innerHTML = rowsHtml;
    // Wait for the jsdom observer queue — without calling renderAll manually.
    await new Promise(r => setTimeout(r, 100));
    const rows = s.doc.querySelectorAll("#carAttributesDisplay .attribute-row");
    const labels = Array.prototype.map.call(
      rows,
      r => r.querySelector(".attribute-rating-header span:not(.ratingVal)").textContent
    );
    assert(labels.length === 8, "observer did not render: " + labels.length + " label");
    assert(
      labels.every(x => /^#\d+ /.test(x)),
      "unranked label: " + labels.join(" | ")
    );
    assert(labels[0] === "#1 Fuel economy · 26 DP", "priority #1 is wrong: " + labels.join(" | "));
    const order = Array.prototype.map.call(rows, r => r.id).join(",");
    assert(
      order ===
        "wrap-fuel_economy,wrap-tyre_economy,wrap-cooling,wrap-downforce," +
          "wrap-handling,wrap-reliability,wrap-acceleration,wrap-braking",
      "row order does not follow priority: " + order
    );
    assert(
      Array.prototype.every.call(rows, r => !r.hasAttribute("style")),
      "Cars rows are still given colour styles"
    );
    // Stable: no render loop (one extra pass does not change the result).
    await new Promise(r => setTimeout(r, 100));
    const labels2 = Array.prototype.map.call(
      s.doc.querySelectorAll(
        "#carAttributesDisplay .attribute-row .attribute-rating-header span:not(.ratingVal)"
      ),
      el => el.textContent
    );
    const order2 = Array.prototype.map
      .call(s.doc.querySelectorAll("#carAttributesDisplay .attribute-row"), r => r.id)
      .join(",");
    assert(labels2.join("|") === labels.join("|"), "labels changed on their own (observer loop?)");
    assert(order2 === order, "order changed on its own (observer loop?)");
    s.close();
  }
);

const tick = ms => new Promise(r => setTimeout(r, ms || 20));

ta(
  "Restore: game updates the Cars label → single annotation & orig follows the new text",
  async () => {
    const s = bootOn(load("cars.html"), URL_IGP);
    await tick();
    const row = s.doc.getElementById("wrap-acceleration");
    assert(
      row && row.hasAttribute("data-igpas-orig"),
      "precondition: advisor has not written the label yet"
    );
    const label = row.querySelector(".attribute-rating-header span:not(.ratingVal)");
    label.textContent = "Acceleration MAX"; // the game rewrites the label
    await tick(40);
    const text = label.textContent;
    assert(
      /^#\d+ Acceleration MAX · \d+ DP$/.test(text),
      "annotation does not follow the new game text: " + text
    );
    assert((text.match(/ · /g) || []).length === 1, "annotation is stacked: " + text);
    assert(
      row.getAttribute("data-igpas-orig") === "Acceleration MAX",
      "data-igpas-orig is stale: " + row.getAttribute("data-igpas-orig")
    );
    assert(!row.hasAttribute("style"), "Cars rows must not be coloured");
    const title = row.getAttribute("title") || "";
    assert(/Acceleration MAX/.test(title), "title does not follow the new label: " + title);
    assert(/Priority #\d+/.test(title), "title is not a priority: " + title);
    s.close();
  }
);

ta(
  "Restore: game updates the Supply title → colour/title recalculated without duplicate text",
  async () => {
    const s = bootOn(load("supply-engine.html"), URL_IGP);
    await tick();
    const dlg = s.doc.querySelector(".supplyDialog");
    const h2 = dlg.querySelector(".dialog-subhead-content h2");
    assert(h2 && h2.textContent === "Engine supply", "precondition: title changed");
    assert(
      !dlg.querySelector(".dialog-subhead").getAttribute("style"),
      "precondition: header must stay untouched"
    );
    // The game switches the dialog to another type: title + all cards change too.
    for (const a of dlg.querySelectorAll('a[data-tip*="supplyType=engine"]')) {
      a.setAttribute(
        "data-tip",
        a.getAttribute("data-tip").replace("supplyType=engine", "supplyType=fuel")
      );
    }
    h2.textContent = "Fuel supply";
    await tick(40);
    assert(
      h2.textContent === "Fuel supply",
      "game title overwritten by verdict: " + h2.textContent
    );
    assert(!h2.hasAttribute("data-igpas-orig"), "title uses the old text annotation");
    const ht = h2.getAttribute("title") || "";
    assert(/Active supplier/.test(ht), "header title not recalculated: " + ht);
    const subhead = dlg.querySelector(".dialog-subhead");
    assert(
      !subhead.getAttribute("style"),
      "header was styled after re-render: " + subhead.getAttribute("style")
    );
    assert(
      dlg.querySelectorAll(".dialog-subhead[data-igpas-orig-style]").length === 0,
      "header style marker appeared after re-render"
    );
    const btn6 = Array.prototype.find.call(dlg.querySelectorAll(".supplyDialog a.btn.confirm"), a =>
      /eId=6\b/.test(a.getAttribute("data-tip") || "")
    );
    assert(btn6, "eId6 button is missing");
    assert(
      String(btn6.style.getPropertyValue("background-color") || "").toLowerCase() ===
        "rgb(192, 57, 43)",
      "recommendation button colour is missing after re-render"
    );
    s.close();
  }
);

ta(
  "Restore: navigating away returns the Cars order/text, the latest game label stays intact",
  async () => {
    const s = bootOn(load("cars.html"), URL_IGP);
    await tick();
    const row = s.doc.getElementById("wrap-acceleration");
    assert(
      row && row.hasAttribute("data-igpas-orig"),
      "precondition: advisor has not written the label yet"
    );
    const label = row.querySelector(".attribute-rating-header span:not(.ratingVal)");
    label.textContent = "Acceleration MAX";
    await tick(40);
    // The game moves to a study page → not a page the advisor handles.
    s.doc.getElementById("pageId").value = "standings";
    s.doc.dispatchEvent(new s.win.Event("click", { bubbles: true }));
    await tick(350); // 250 ms navigation debounce
    assert(
      label.textContent === "Acceleration MAX",
      "latest game label changed: " + label.textContent
    );
    const order = Array.prototype.map
      .call(s.doc.querySelectorAll("#carAttributesDisplay .attribute-row"), r => r.id)
      .join(",");
    assert(
      order ===
        "wrap-acceleration,wrap-braking,wrap-cooling,wrap-downforce," +
          "wrap-fuel_economy,wrap-handling,wrap-reliability,wrap-tyre_economy",
      "original order did not return: " + order
    );
    assert(!row.hasAttribute("style"), "advisor style left behind: " + row.getAttribute("style"));
    assert(!row.hasAttribute("data-igpas-orig"), "data-igpas-orig left behind");
    assert(!row.hasAttribute("data-igpas-orig-order"), "data-igpas-orig-order left behind");
    assert(!row.hasAttribute("title"), "advisor title left behind: " + row.getAttribute("title"));
    s.close();
  }
);

ta("Cars tabs: re-render keeps the priority order without duplicating rows", async () => {
  const s = bootOn(load("cars-tabs.html"), URL_IGP);
  const upgrade = s.doc.getElementById("designInline");
  const names = () =>
    Array.prototype.map
      .call(upgrade.querySelectorAll('.attribute-row input[type="number"]'), i =>
        i.getAttribute("name")
      )
      .join(",");
  const before = names();
  s.doc.dispatchEvent(new s.win.Event("click", { bubbles: true }));
  await tick(320); // 250 ms navigation debounce
  assert(names() === before, "order changed on re-render: " + names());
  assert(
    upgrade.querySelectorAll(".attribute-row").length === 8,
    "row count changed: " + upgrade.querySelectorAll(".attribute-row").length
  );
  // Rank prefix is written once, even after several renders.
  const labels = Array.prototype.map.call(
    upgrade.querySelectorAll(".attribute-row .attribute-rating-header span:not(.ratingVal)"),
    el => el.textContent.trim()
  );
  assert(
    labels.join(" | ") ===
      "#1 Acceleration | #2 Fuel economy | #3 Handling | #4 Downforce | #5 Braking | " +
        "#6 Cooling | #7 Reliability | #8 Tyre economy",
    "rank labels changed on re-render: " + labels.join(" | ")
  );
  s.close();
});

ta("Restore: Research/Upgrade rows return to the server order on page change", async () => {
  const s = bootOn(load("cars-tabs.html"), URL_IGP);
  const upgrade = s.doc.getElementById("designInline");
  const research = s.doc.getElementById("researchInline");
  const alpha =
    "acceleration,braking,cooling,downforce,fuel_economy,handling,reliability,tyre_economy";
  s.doc.getElementById("pageId").value = "standings";
  upgrade.appendChild(s.doc.createElement("div"));
  await tick(40);
  const upNames = Array.prototype.map
    .call(upgrade.querySelectorAll('.attribute-row input[type="number"]'), i =>
      i.getAttribute("name")
    )
    .join(",");
  assert(upNames === alpha, "Upgrade order not restored: " + upNames);
  const rsValues = Array.prototype.map
    .call(research.querySelectorAll('.attribute-row input[type="checkbox"]'), i =>
      i.getAttribute("value")
    )
    .join(",");
  assert(rsValues === alpha, "Research order not restored: " + rsValues);
  // Labels are back to the game text (no "#n " prefix left behind).
  const plain =
    "Acceleration | Braking | Cooling | Downforce | Fuel economy | Handling | Reliability | Tyre economy";
  const labelText = form =>
    Array.prototype.map
      .call(
        form.querySelectorAll(".attribute-row .attribute-rating-header span:not(.ratingVal)"),
        el => el.textContent.trim()
      )
      .join(" | ");
  assert(labelText(upgrade) === plain, "Upgrade labels not restored: " + labelText(upgrade));
  assert(labelText(research) === plain, "Research labels not restored: " + labelText(research));
  assert(
    !upgrade.querySelector("[data-igpas-form-orig]") &&
      !research.querySelector("[data-igpas-form-orig]"),
    "label marker left behind after restore"
  );
  assert(
    !upgrade.querySelector(".attribute-row[data-igpas-orig-order]") &&
      !research.querySelector(".attribute-row[data-igpas-orig-order]"),
    "order marker left behind after restore"
  );
  const kids = Array.from(upgrade.children);
  const lastRow = kids.map(el => el.classList.contains("attribute-row")).lastIndexOf(true);
  const hiddenAt = kids.findIndex(el => el.getAttribute && el.getAttribute("name") === "league");
  assert(
    hiddenAt > lastRow,
    "hidden field is not after the rows after restore (row " +
      lastRow +
      ", hidden " +
      hiddenAt +
      ")"
  );
  s.close();
});

(async () => {
  for (const [name, fn] of asyncTests) {
    try {
      await fn();
      pass++;
      console.log("  ✔ " + name);
    } catch (e) {
      fail++;
      console.error("  ✗ " + name + " — " + e.message);
    }
  }
  console.log(
    (fail ? "\n" : "") +
      (pass + fail) +
      " advisor tests, " +
      fail +
      " failed" +
      (fail ? "" : " — all passed ✔")
  );
  process.exit(fail ? 1 : 0);
})();
