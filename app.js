/* =========================================================
   NaturaLift — app.js
   Calculateur nutritionnel + suivi quotidien + historique long
   terme + bilans hebdo/mensuels + base d'aliments réutilisables.
   Vanilla JS, aucune dépendance. Compatible anciens navigateurs
   Android (pas d'optional chaining ni de nullish coalescing).
   ========================================================= */

(function () {
  "use strict";

  var STORAGE_PROFILE = "nl_profile_v1";
  var STORAGE_HISTORY = "nl_history_v1";   // { "YYYY-MM-DD": dayRecord }
  var STORAGE_FOODS = "nl_foods_v1";       // [ { id, name, kcal, protein, fat, carbs } ] pour 100g
  var STORAGE_LOG_LEGACY = "nl_log_v1";    // ancienne version (migration)
  var MAX_HISTORY_DAYS = 400;              // ~13 mois, borne la taille du localStorage
  var MAX_SUGGESTIONS = 8;

  /* ---------------------------------------------------------
     Constantes métier
     --------------------------------------------------------- */

  var OBJECTIVE_CONFIG = {
    seche: {
      label: "Sèche",
      kcalAdjust: { H: -0.20, F: -0.17 },
      proteinPerKg: { H: 2.4, F: 2.3 },
      fatPerKg: { H: 0.9, F: 1.0 }
    },
    prise: {
      label: "Prise de masse",
      kcalAdjust: { H: 0.12, F: 0.10 },
      proteinPerKg: { H: 1.9, F: 1.8 },
      fatPerKg: { H: 1.0, F: 1.1 }
    },
    maintien: {
      label: "Maintien",
      kcalAdjust: { H: 0, F: 0 },
      proteinPerKg: { H: 1.9, F: 1.8 },
      fatPerKg: { H: 1.0, F: 1.1 }
    },
    recomp: {
      label: "Recomposition corporelle",
      kcalAdjust: { H: -0.05, F: -0.03 },
      proteinPerKg: { H: 2.2, F: 2.1 },
      fatPerKg: { H: 1.0, F: 1.1 }
    }
  };

  var FAT_FLOOR_PER_KG = { H: 0.8, F: 0.95 };
  var KCAL_PER_G = { protein: 4, fat: 9, carbs: 4 };

  var MACRO_META = {
    protein: { label: "Protéines", unit: "g", color: "var(--lime)" },
    fat: { label: "Lipides", unit: "g", color: "var(--amber)" },
    carbs: { label: "Glucides", unit: "g", color: "var(--cyan)" }
  };

  // Base d'aliments de départ (valeurs usuelles pour 100g, pratiquants naturels).
  var DEFAULT_FOODS = [
    { id: "d-poulet", name: "Blanc de poulet (cru)", kcal: 165, protein: 31, fat: 3.6, carbs: 0 },
    { id: "d-riz", name: "Riz basmati (cru)", kcal: 350, protein: 7.5, fat: 0.6, carbs: 78 },
    { id: "d-oeuf", name: "Œuf entier", kcal: 155, protein: 13, fat: 11, carbs: 1.1 },
    { id: "d-avoine", name: "Flocons d'avoine", kcal: 375, protein: 13, fat: 7, carbs: 60 },
    { id: "d-fromageblanc", name: "Fromage blanc 0%", kcal: 45, protein: 8, fat: 0.2, carbs: 4 },
    { id: "d-huileolive", name: "Huile d'olive", kcal: 900, protein: 0, fat: 100, carbs: 0 },
    { id: "d-pates", name: "Pâtes (crues)", kcal: 350, protein: 12, fat: 1.5, carbs: 70 },
    { id: "d-patatedouce", name: "Patate douce (crue)", kcal: 86, protein: 1.6, fat: 0.1, carbs: 20 },
    { id: "d-banane", name: "Banane", kcal: 89, protein: 1.1, fat: 0.3, carbs: 23 },
    { id: "d-amandes", name: "Amandes", kcal: 579, protein: 21, fat: 50, carbs: 22 },
    { id: "d-saumon", name: "Saumon", kcal: 208, protein: 20, fat: 13, carbs: 0 },
    { id: "d-boeufhache", name: "Bœuf haché 5% MG", kcal: 137, protein: 21, fat: 5, carbs: 0 },
    { id: "d-lait", name: "Lait demi-écrémé", kcal: 46, protein: 3.3, fat: 1.6, carbs: 4.8 },
    { id: "d-yaourtgrec", name: "Yaourt grec nature", kcal: 97, protein: 9, fat: 5, carbs: 4 },
    { id: "d-thon", name: "Thon au naturel (boîte)", kcal: 116, protein: 26, fat: 1, carbs: 0 },
    { id: "d-paincomplet", name: "Pain complet", kcal: 247, protein: 9, fat: 3.5, carbs: 41 },
    { id: "d-brocoli", name: "Brocoli", kcal: 34, protein: 2.8, fat: 0.4, carbs: 7 },
    { id: "d-beurrecacahuete", name: "Beurre de cacahuète", kcal: 588, protein: 25, fat: 50, carbs: 20 },
    { id: "d-lentilles", name: "Lentilles cuites", kcal: 116, protein: 9, fat: 0.4, carbs: 20 },
    { id: "d-whey", name: "Whey protéine (poudre)", kcal: 380, protein: 75, fat: 6, carbs: 8 }
  ];

  /* ---------------------------------------------------------
     Utilitaires génériques
     --------------------------------------------------------- */

  function $(id) { return document.getElementById(id); }

  function round(n) { return Math.round(n); }
  function round1(n) { return Math.round(n * 10) / 10; }

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  function dateKeyFromDate(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function todayKey() { return dateKeyFromDate(new Date()); }

  function parseDateKey(key) {
    var parts = key.split("-");
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  function addDays(d, n) {
    var copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() + n);
    return copy;
  }

  function formatDateLong(key) {
    var d = parseDateKey(key);
    var label = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function formatDateShort(key) {
    var d = parseDateKey(key);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  function readJSON(key) {
    var raw = localStorage.getItem(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function genId(prefix) {
    return prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  }

  /* ---------------------------------------------------------
     Calcul du métabolisme et des macros (Mifflin-St Jeor)
     --------------------------------------------------------- */

  function computeTargets(profile) {
    var sex = profile.sex;
    var age = profile.age;
    var weight = profile.weight;
    var height = profile.height;
    var activity = profile.activity;
    var objective = profile.objective;

    var bmr;
    if (sex === "H") {
      bmr = 10 * weight + 6.25 * height - 5 * age + 5;
    } else {
      bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    }

    var tdee = bmr * activity;
    var config = OBJECTIVE_CONFIG[objective];
    var targetKcal = tdee * (1 + config.kcalAdjust[sex]);

    var proteinG = config.proteinPerKg[sex] * weight;
    var fatFromRatio = config.fatPerKg[sex] * weight;
    var fatFloor = FAT_FLOOR_PER_KG[sex] * weight;
    var fatG = Math.max(fatFromRatio, fatFloor);

    var kcalUsedByProteinAndFat = proteinG * KCAL_PER_G.protein + fatG * KCAL_PER_G.fat;
    var carbsKcal = targetKcal - kcalUsedByProteinAndFat;
    var carbsG = carbsKcal > 0 ? carbsKcal / KCAL_PER_G.carbs : 0;

    return {
      bmr: round(bmr),
      tdee: round(tdee),
      kcal: round(targetKcal),
      protein: round(proteinG),
      fat: round(fatG),
      carbs: round(carbsG),
      objectiveLabel: config.label
    };
  }

  /* ---------------------------------------------------------
     Base d'aliments — stockage et CRUD
     --------------------------------------------------------- */

  function loadFoods() {
    var foods = readJSON(STORAGE_FOODS);
    if (!foods) {
      foods = DEFAULT_FOODS.slice();
      writeJSON(STORAGE_FOODS, foods);
    }
    return foods;
  }

  function saveFoods(foods) {
    writeJSON(STORAGE_FOODS, foods);
  }

  function findFoodByName(foods, name) {
    var lower = name.trim().toLowerCase();
    if (!lower) return null;
    for (var i = 0; i < foods.length; i++) {
      if (foods[i].name.trim().toLowerCase() === lower) return foods[i];
    }
    return null;
  }

  function findFoodById(foods, id) {
    for (var i = 0; i < foods.length; i++) {
      if (foods[i].id === id) return foods[i];
    }
    return null;
  }

  function searchFoods(query, limit) {
    var lower = query.trim().toLowerCase();
    if (!lower) return [];
    var foods = loadFoods().slice();
    foods.sort(function (a, b) { return a.name.localeCompare(b.name, "fr"); });
    var matches = [];
    for (var i = 0; i < foods.length && matches.length < limit; i++) {
      if (foods[i].name.toLowerCase().indexOf(lower) !== -1) matches.push(foods[i]);
    }
    return matches;
  }

  function createFood(data) {
    var foods = loadFoods();
    var food = {
      id: genId("food"),
      name: data.name,
      kcal: data.kcal,
      protein: data.protein,
      fat: data.fat,
      carbs: data.carbs
    };
    foods.push(food);
    saveFoods(foods);
    return foods;
  }

  function updateFoodRecord(id, data) {
    var foods = loadFoods();
    var food = findFoodById(foods, id);
    if (!food) return foods;
    food.name = data.name;
    food.kcal = data.kcal;
    food.protein = data.protein;
    food.fat = data.fat;
    food.carbs = data.carbs;
    saveFoods(foods);
    return foods;
  }

  function deleteFoodRecord(id) {
    var foods = loadFoods();
    var filtered = [];
    for (var i = 0; i < foods.length; i++) {
      if (foods[i].id !== id) filtered.push(foods[i]);
    }
    saveFoods(filtered);
    return filtered;
  }

  /* ---------------------------------------------------------
     Historique — couche de stockage
     Structure : un objet indexé par date, chaque entrée porte
     ses propres cibles (photo de l'objectif du jour) afin que
     les bilans restent exacts même si l'objectif change plus tard.
     --------------------------------------------------------- */

  function loadHistory() {
    var h = readJSON(STORAGE_HISTORY);
    return h || {};
  }

  function pruneHistory(history) {
    var keys = Object.keys(history);
    if (keys.length <= MAX_HISTORY_DAYS) return history;
    keys.sort();
    var toRemove = keys.length - MAX_HISTORY_DAYS;
    for (var i = 0; i < toRemove; i++) {
      delete history[keys[i]];
    }
    return history;
  }

  function saveHistory(history) {
    writeJSON(STORAGE_HISTORY, pruneHistory(history));
  }

  function getDayRecord(dateKey) {
    var history = loadHistory();
    return history[dateKey] || null;
  }

  function upsertDayRecord(record) {
    var history = loadHistory();
    history[record.date] = record;
    saveHistory(history);
    return record;
  }

  function ensureTodayRecord() {
    var profile = readJSON(STORAGE_PROFILE);
    if (!profile) return null;

    var key = todayKey();
    var history = loadHistory();
    var record = history[key];
    if (!record) {
      record = { date: key, entries: [], targets: profile.targets, validated: false };
      history[key] = record;
      saveHistory(history);
    }
    return record;
  }

  function addFoodToDay(dateKey, entry) {
    var history = loadHistory();
    var record = history[dateKey];
    if (!record) return null;
    entry.id = genId("entry");
    record.entries.push(entry);
    saveHistory(history);
    return record;
  }

  function removeFoodFromDay(dateKey, entryId) {
    var history = loadHistory();
    var record = history[dateKey];
    if (!record) return null;
    var filtered = [];
    for (var i = 0; i < record.entries.length; i++) {
      if (record.entries[i].id !== entryId) filtered.push(record.entries[i]);
    }
    record.entries = filtered;
    saveHistory(history);
    return record;
  }

  function setDayValidated(dateKey, validated) {
    var history = loadHistory();
    var record = history[dateKey];
    if (!record) return null;
    record.validated = validated;
    saveHistory(history);
    return record;
  }

  function deleteDayRecord(dateKey) {
    var history = loadHistory();
    delete history[dateKey];
    saveHistory(history);
  }

  function sumEntries(entries) {
    var totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      totals.kcal += e.kcal;
      totals.protein += e.protein;
      totals.fat += e.fat;
      totals.carbs += e.carbs;
    }
    return totals;
  }

  function migrateLegacyLog() {
    var legacy = readJSON(STORAGE_LOG_LEGACY);
    if (!legacy || !legacy.date || !legacy.entries) {
      localStorage.removeItem(STORAGE_LOG_LEGACY);
      return;
    }
    var history = loadHistory();
    if (!history[legacy.date]) {
      var profile = readJSON(STORAGE_PROFILE);
      var targets = profile ? profile.targets : { kcal: 0, protein: 0, fat: 0, carbs: 0 };
      history[legacy.date] = {
        date: legacy.date,
        entries: legacy.entries,
        targets: targets,
        validated: false
      };
      saveHistory(history);
    }
    localStorage.removeItem(STORAGE_LOG_LEGACY);
  }

  /* ---------------------------------------------------------
     Statut d'une journée (couleur)
     --------------------------------------------------------- */

  function dayStatus(record) {
    if (!record || record.entries.length === 0) return "none";
    var totals = sumEntries(record.entries);
    var t = record.targets;
    if (!t || t.kcal <= 0) return "none";

    var kcalPct = (totals.kcal / t.kcal) * 100;
    var proteinPct = t.protein > 0 ? (totals.protein / t.protein) * 100 : 100;

    var kcalOk = kcalPct >= 90 && kcalPct <= 110;
    var proteinOk = proteinPct >= 90;

    if (kcalOk && proteinOk) return "green";
    if (kcalOk || proteinOk) return "amber";
    return "red";
  }

  function gaugeColor(pct, isProtein) {
    if (isProtein) {
      if (pct < 90) return "var(--amber)";
      if (pct <= 140) return "var(--lime)";
      return "var(--cyan)";
    }
    if (pct < 95) return "var(--cyan)";
    if (pct <= 110) return "var(--lime)";
    return "var(--red)";
  }

  /* ---------------------------------------------------------
     Rendu générique — jauges circulaires
     --------------------------------------------------------- */

  function gaugesHtml(totals, targets, small) {
    var defs = [
      { key: "kcal", label: "Calories", unit: "kcal", isProtein: false },
      { key: "protein", label: "Protéines", unit: "g", isProtein: true },
      { key: "fat", label: "Lipides", unit: "g", isProtein: false },
      { key: "carbs", label: "Glucides", unit: "g", isProtein: false }
    ];

    var html = "";
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var value = totals[d.key] || 0;
      var target = targets[d.key] || 0;
      var pct = target > 0 ? (value / target) * 100 : 0;
      var displayPct = Math.min(pct, 100);
      var color = gaugeColor(pct, d.isProtein);

      html +=
        '<div class="gauge' + (small ? ' gauge-sm' : '') + '">' +
          '<div class="gauge-ring" style="--pct:' + displayPct.toFixed(0) + ';--ring-color:' + color + '">' +
            '<div class="gauge-ring-inner"></div>' +
            '<div class="gauge-text">' +
              '<span class="gauge-value">' + round(value) + '</span>' +
              '<span class="gauge-target">/ ' + round(target) + ' ' + d.unit + '</span>' +
            '</div>' +
          '</div>' +
          '<span class="gauge-label">' + d.label + '</span>' +
        '</div>';
    }
    return html;
  }

  /* ---------------------------------------------------------
     Rendu — Calculateur
     --------------------------------------------------------- */

  function renderResults(targets, sex) {
    $("kcalDaily").textContent = targets.kcal;
    $("objectiveLabel").textContent = targets.objectiveLabel;

    var macroKeys = ["protein", "fat", "carbs"];
    var html = "";
    for (var i = 0; i < macroKeys.length; i++) {
      var key = macroKeys[i];
      var meta = MACRO_META[key];
      var grams = targets[key];
      var kcal = grams * KCAL_PER_G[key];
      html +=
        '<div class="macro-row">' +
          '<span class="macro-dot" style="background:' + meta.color + '"></span>' +
          '<span class="macro-name">' + meta.label +
            '<span class="macro-sub">' + kcal + ' kcal</span>' +
          '</span>' +
          '<span class="macro-value">' + grams + ' ' + meta.unit + '</span>' +
        '</div>';
    }
    $("macroList").innerHTML = html;

    var periods = [
      { label: "Jour", mult: 1, unit: "kcal" },
      { label: "Semaine", mult: 7, unit: "kcal" },
      { label: "Mois", mult: 30, unit: "kcal" }
    ];
    var periodHtml = "";
    for (var p = 0; p < periods.length; p++) {
      var period = periods[p];
      periodHtml +=
        '<div class="period-cell">' +
          '<span class="p-label">' + period.label + '</span>' +
          '<span class="p-value">' + (targets.kcal * period.mult).toLocaleString("fr-FR") + '</span>' +
          '<span class="p-unit">' + period.unit + '</span>' +
        '</div>';
    }
    $("periodTable").innerHTML = periodHtml;

    $("femaleNote").hidden = sex !== "F";
    $("results").hidden = false;
  }

  function handleCalcSubmit(e) {
    e.preventDefault();

    var sex = document.querySelector('input[name="sex"]:checked').value;
    var profile = {
      sex: sex,
      age: parseFloat($("age").value),
      weight: parseFloat($("weight").value),
      height: parseFloat($("height").value),
      activity: parseFloat($("activity").value),
      objective: $("objective").value
    };

    var targets = computeTargets(profile);
    profile.targets = targets;
    writeJSON(STORAGE_PROFILE, profile);

    var todayRecord = getDayRecord(todayKey());
    if (todayRecord && todayRecord.entries.length === 0) {
      todayRecord.targets = targets;
      upsertDayRecord(todayRecord);
    }

    renderResults(targets, sex);
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function loadExistingProfile() {
    var profile = readJSON(STORAGE_PROFILE);
    if (!profile) return;

    var sexInput = document.getElementById(profile.sex === "F" ? "sexF" : "sexH");
    if (sexInput) sexInput.checked = true;
    $("age").value = profile.age;
    $("weight").value = profile.weight;
    $("height").value = profile.height;
    $("activity").value = profile.activity;
    $("objective").value = profile.objective;

    renderResults(profile.targets, profile.sex);
  }

  /* ---------------------------------------------------------
     Ajout d'aliment générique — réutilisé par le Suivi et le
     détail d'une journée passée (base de données + saisie
     manuelle). Le choix d'un aliment se fait via un menu
     déroulant HTML/CSS entièrement custom (pas de <datalist>,
     dont le rendu natif sur Android est peu fiable et peut
     s'afficher par-dessus le clavier).
     --------------------------------------------------------- */

  function setupFoodEntryUI(cfg) {
    // cfg = {
    //   modeDb, modeManual,                     radios
    //   dbForm, manualForm,                     <form> éléments
    //   searchInput, suggestionsEl, noMatchEl, previewEl, gramsInput, dbSubmitBtn,
    //   manualFields: { name, kcal, protein, fat, carbs },
    //   getDateKey, onAdded
    // }

    var activeIndex = -1;
    var currentMatches = [];

    function currentExactMatch() {
      var foods = loadFoods();
      return findFoodByName(foods, cfg.searchInput.value);
    }

    function updatePreview() {
      var match = currentExactMatch();
      if (!match) {
        cfg.previewEl.hidden = true;
        cfg.noMatchEl.hidden = cfg.searchInput.value.trim() === "";
        cfg.dbSubmitBtn.disabled = true;
        return;
      }
      cfg.noMatchEl.hidden = true;
      cfg.previewEl.hidden = false;
      cfg.previewEl.innerHTML =
        '<span class="fp-name">' + escapeHtml(match.name) +
          '<span class="fp-macros">P ' + match.protein + 'g · L ' + match.fat + 'g · G ' + match.carbs + 'g /100g</span>' +
        '</span>' +
        '<span class="fp-kcal">' + match.kcal + ' kcal/100g</span>';
      cfg.dbSubmitBtn.disabled = false;
    }

    function hideSuggestions() {
      cfg.suggestionsEl.hidden = true;
      cfg.suggestionsEl.innerHTML = "";
      activeIndex = -1;
      currentMatches = [];
    }

    function highlightActive() {
      var items = cfg.suggestionsEl.querySelectorAll(".autocomplete-item");
      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle("active", i === activeIndex);
      }
      if (items[activeIndex]) items[activeIndex].scrollIntoView({ block: "nearest" });
    }

    function selectMatch(food) {
      cfg.searchInput.value = food.name;
      hideSuggestions();
      updatePreview();
      cfg.gramsInput.focus();
      cfg.gramsInput.select();
    }

    function renderSuggestions() {
      var query = cfg.searchInput.value.trim();
      if (!query) { hideSuggestions(); return; }

      currentMatches = searchFoods(query, MAX_SUGGESTIONS);
      if (currentMatches.length === 0) { hideSuggestions(); return; }

      activeIndex = -1;
      var html = "";
      for (var i = 0; i < currentMatches.length; i++) {
        var f = currentMatches[i];
        html +=
          '<div class="autocomplete-item" data-index="' + i + '">' +
            escapeHtml(f.name) +
            '<span class="ai-macros">' + f.kcal + ' kcal · P' + f.protein + ' L' + f.fat + ' G' + f.carbs + ' /100g</span>' +
          '</div>';
      }
      cfg.suggestionsEl.innerHTML = html;
      cfg.suggestionsEl.hidden = false;

      var items = cfg.suggestionsEl.querySelectorAll(".autocomplete-item");
      for (var j = 0; j < items.length; j++) {
        // mousedown + preventDefault : évite que le champ perde le focus
        // (et donc que le clavier se ferme) avant que le clic soit traité.
        items[j].addEventListener("mousedown", function (ev) {
          ev.preventDefault();
          var idx = parseInt(ev.currentTarget.getAttribute("data-index"), 10);
          selectMatch(currentMatches[idx]);
        });
      }
    }

    cfg.searchInput.addEventListener("input", function () {
      updatePreview();
      renderSuggestions();
    });

    cfg.searchInput.addEventListener("focus", function () {
      if (cfg.searchInput.value.trim() !== "") renderSuggestions();
    });

    cfg.searchInput.addEventListener("blur", function () {
      // délai court pour laisser le "mousedown" d'une suggestion s'exécuter
      window.setTimeout(hideSuggestions, 150);
    });

    cfg.searchInput.addEventListener("keydown", function (ev) {
      if (cfg.suggestionsEl.hidden) return;
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        activeIndex = Math.min(activeIndex + 1, currentMatches.length - 1);
        highlightActive();
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        highlightActive();
      } else if (ev.key === "Enter") {
        if (activeIndex >= 0 && currentMatches[activeIndex]) {
          ev.preventDefault();
          selectMatch(currentMatches[activeIndex]);
        }
      } else if (ev.key === "Escape") {
        hideSuggestions();
      }
    });

    cfg.modeDb.addEventListener("change", function () {
      cfg.dbForm.hidden = false;
      cfg.manualForm.hidden = true;
    });
    cfg.modeManual.addEventListener("change", function () {
      cfg.dbForm.hidden = true;
      cfg.manualForm.hidden = false;
      hideSuggestions();
    });

    cfg.dbForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var match = currentExactMatch();
      if (!match) return;
      var grams = parseFloat(cfg.gramsInput.value) || 0;
      if (grams <= 0) return;
      var factor = grams / 100;

      var entry = {
        name: match.name,
        kcal: round(match.kcal * factor),
        protein: round1(match.protein * factor),
        fat: round1(match.fat * factor),
        carbs: round1(match.carbs * factor),
        grams: grams,
        foodId: match.id
      };

      var dateKey = cfg.getDateKey();
      if (!dateKey) return;
      addFoodToDay(dateKey, entry);

      cfg.dbForm.reset();
      cfg.gramsInput.value = "100";
      cfg.previewEl.hidden = true;
      cfg.noMatchEl.hidden = true;
      cfg.dbSubmitBtn.disabled = true;
      hideSuggestions();
      cfg.onAdded();
    });

    cfg.manualForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var entry = {
        name: cfg.manualFields.name.value.trim(),
        kcal: parseFloat(cfg.manualFields.kcal.value) || 0,
        protein: parseFloat(cfg.manualFields.protein.value) || 0,
        fat: parseFloat(cfg.manualFields.fat.value) || 0,
        carbs: parseFloat(cfg.manualFields.carbs.value) || 0
      };
      if (!entry.name) return;

      var dateKey = cfg.getDateKey();
      if (!dateKey) return;
      addFoodToDay(dateKey, entry);

      cfg.manualForm.reset();
      cfg.onAdded();
    });
  }

  /* ---------------------------------------------------------
     Rendu — Suivi (jour courant)
     --------------------------------------------------------- */

  function renderFoodListInto(listEl, emptyEl, entries, onDelete) {
    if (entries.length === 0) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    var html = "";
    for (var i = entries.length - 1; i >= 0; i--) {
      var e = entries[i];
      var qtyLabel = e.grams ? (e.grams + ' g · ') : '';
      html +=
        '<li class="food-item">' +
          '<span class="food-name">' + escapeHtml(e.name) +
            '<span class="food-macros">' + qtyLabel + 'P ' + e.protein + 'g · L ' + e.fat + 'g · G ' + e.carbs + 'g</span>' +
          '</span>' +
          '<span class="food-kcal">' + e.kcal + '</span>' +
          '<button type="button" class="food-del" data-id="' + e.id + '" aria-label="Supprimer">×</button>' +
        '</li>';
    }
    listEl.innerHTML = html;

    var delButtons = listEl.querySelectorAll(".food-del");
    for (var j = 0; j < delButtons.length; j++) {
      delButtons[j].addEventListener("click", function (ev) {
        onDelete(ev.currentTarget.getAttribute("data-id"));
      });
    }
  }

  function refreshTracker() {
    var profile = readJSON(STORAGE_PROFILE);
    if (!profile) {
      $("noProfile").hidden = false;
      $("trackerContent").hidden = true;
      return;
    }
    $("noProfile").hidden = true;
    $("trackerContent").hidden = false;

    var record = ensureTodayRecord();
    var totals = sumEntries(record.entries);

    $("gaugesGrid").innerHTML = gaugesHtml(totals, record.targets, false);
    renderFoodListInto($("foodLog"), $("logEmpty"), record.entries, function (id) {
      removeFoodFromDay(record.date, id);
      refreshTracker();
    });

    $("trackDate").textContent = formatDateLong(record.date);
    $("validatedChip").hidden = !record.validated;
    $("validateDay").hidden = record.validated;
  }

  function handleResetDay() {
    var confirmed = window.confirm("Réinitialiser le journal du jour ? Cette action est irréversible.");
    if (!confirmed) return;
    var record = ensureTodayRecord();
    record.entries = [];
    record.validated = false;
    upsertDayRecord(record);
    refreshTracker();
  }

  function handleValidateDay() {
    var record = ensureTodayRecord();
    setDayValidated(record.date, true);
    refreshTracker();
  }

  /* ---------------------------------------------------------
     Historique — état de navigation interne
     --------------------------------------------------------- */

  var historyState = {
    mode: "list",
    calendarCursor: new Date(),
    currentDetailKey: null
  };

  function refreshHistory() {
    var history = loadHistory();
    var keys = Object.keys(history);

    $("historyEmpty").hidden = keys.length > 0;
    $("historyBrowse").hidden = keys.length === 0;

    if ($("historyDetail").hidden === false) {
      renderHistoryDetail(historyState.currentDetailKey);
      return;
    }

    if (keys.length === 0) return;

    renderHistoryList(history);
    renderHistoryCalendar(history);
  }

  function renderHistoryList(history) {
    var keys = Object.keys(history);
    keys.sort();
    keys.reverse();

    var html = "";
    for (var i = 0; i < keys.length; i++) {
      var record = history[keys[i]];
      var totals = sumEntries(record.entries);
      var status = dayStatus(record);
      var isToday = record.date === todayKey();

      html +=
        '<li>' +
          '<button type="button" class="history-row" data-date="' + record.date + '">' +
            '<span class="status-dot st-' + status + '"></span>' +
            '<span class="h-date">' + (isToday ? "Aujourd'hui" : formatDateShort(record.date)) +
              '<span class="h-sub">' + record.entries.length + ' aliment' + (record.entries.length > 1 ? 's' : '') +
                (record.validated ? ' · validée' : '') +
              '</span>' +
            '</span>' +
            '<span class="h-kcal">' + round(totals.kcal) + ' / ' + round(record.targets.kcal) + ' kcal</span>' +
          '</button>' +
        '</li>';
    }
    $("historyList").innerHTML = html;

    var rows = $("historyList").querySelectorAll(".history-row");
    for (var j = 0; j < rows.length; j++) {
      rows[j].addEventListener("click", function (ev) {
        openHistoryDetail(ev.currentTarget.getAttribute("data-date"));
      });
    }
  }

  function renderHistoryCalendar(history) {
    var cursor = historyState.calendarCursor;
    var year = cursor.getFullYear();
    var month = cursor.getMonth();

    var monthLabel = cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    $("calLabel").textContent = monthLabel;

    var firstOfMonth = new Date(year, month, 1);
    var firstWeekday = (firstOfMonth.getDay() + 6) % 7;
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var today = todayKey();

    var html = "";
    for (var i = 0; i < firstWeekday; i++) {
      html += '<div class="cal-cell cal-empty"></div>';
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var d = new Date(year, month, day);
      var key = dateKeyFromDate(d);
      var record = history[key];
      var status = record ? dayStatus(record) : "none";
      var hasData = !!record;
      var classes = "cal-cell st-" + status + (hasData ? " has-data" : "") + (key === today ? " is-today" : "");
      html += '<button type="button" class="' + classes + '" data-date="' + key + '"' + (hasData ? "" : " disabled") + '>' + day + '</button>';
    }
    $("calendarGrid").innerHTML = html;

    var cells = $("calendarGrid").querySelectorAll(".cal-cell.has-data");
    for (var c = 0; c < cells.length; c++) {
      cells[c].addEventListener("click", function (ev) {
        openHistoryDetail(ev.currentTarget.getAttribute("data-date"));
      });
    }
  }

  function switchHistoryView(mode) {
    historyState.mode = mode;
    $("historyListView").hidden = mode !== "list";
    $("historyCalendarView").hidden = mode !== "calendar";
  }

  function openHistoryDetail(dateKey) {
    historyState.currentDetailKey = dateKey;
    $("historyBrowse").hidden = true;
    $("historyEmpty").hidden = true;
    $("historyDetail").hidden = false;
    renderHistoryDetail(dateKey);
  }

  function closeHistoryDetail() {
    historyState.currentDetailKey = null;
    $("historyDetail").hidden = true;
    refreshHistory();
  }

  function renderHistoryDetail(dateKey) {
    var record = getDayRecord(dateKey);
    if (!record) {
      closeHistoryDetail();
      return;
    }

    var totals = sumEntries(record.entries);

    $("detailDate").textContent = formatDateLong(record.date);
    $("detailValidatedChip").hidden = !record.validated;
    $("detailGauges").innerHTML = gaugesHtml(totals, record.targets, false);

    renderFoodListInto($("detailFoodLog"), $("detailLogEmpty"), record.entries, function (id) {
      removeFoodFromDay(record.date, id);
      renderHistoryDetail(dateKey);
    });

    $("detailValidate").textContent = record.validated ? "Retirer la validation" : "Valider cette journée";
  }

  function handleDetailValidateToggle() {
    var dateKey = historyState.currentDetailKey;
    if (!dateKey) return;
    var record = getDayRecord(dateKey);
    if (!record) return;
    setDayValidated(dateKey, !record.validated);
    renderHistoryDetail(dateKey);
  }

  function handleDetailDelete() {
    var dateKey = historyState.currentDetailKey;
    if (!dateKey) return;
    var confirmed = window.confirm("Supprimer définitivement cette journée de l'historique ?");
    if (!confirmed) return;
    deleteDayRecord(dateKey);
    closeHistoryDetail();
  }

  /* ---------------------------------------------------------
     Bilans hebdomadaire / mensuel
     --------------------------------------------------------- */

  function computePeriodStats(nDays) {
    var history = loadHistory();
    var today = new Date();
    var recordsWithData = [];
    var successCount = 0;

    for (var i = 0; i < nDays; i++) {
      var d = addDays(today, -i);
      var key = dateKeyFromDate(d);
      var record = history[key];
      if (record && record.entries.length > 0) {
        recordsWithData.push(record);
        if (dayStatus(record) === "green") successCount++;
      }
    }

    var daysLogged = recordsWithData.length;
    var regularityPct = nDays > 0 ? round((successCount / nDays) * 100) : 0;

    if (daysLogged === 0) {
      return {
        daysLogged: 0,
        totalDays: nDays,
        regularityPct: 0,
        avgConsumed: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
        avgTarget: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
        totalConsumed: { kcal: 0, protein: 0, fat: 0, carbs: 0 }
      };
    }

    var sumConsumed = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    var sumTarget = { kcal: 0, protein: 0, fat: 0, carbs: 0 };

    for (var j = 0; j < recordsWithData.length; j++) {
      var t = sumEntries(recordsWithData[j].entries);
      sumConsumed.kcal += t.kcal;
      sumConsumed.protein += t.protein;
      sumConsumed.fat += t.fat;
      sumConsumed.carbs += t.carbs;

      var tg = recordsWithData[j].targets;
      sumTarget.kcal += tg.kcal;
      sumTarget.protein += tg.protein;
      sumTarget.fat += tg.fat;
      sumTarget.carbs += tg.carbs;
    }

    var avgConsumed = {
      kcal: sumConsumed.kcal / daysLogged,
      protein: sumConsumed.protein / daysLogged,
      fat: sumConsumed.fat / daysLogged,
      carbs: sumConsumed.carbs / daysLogged
    };
    var avgTarget = {
      kcal: sumTarget.kcal / daysLogged,
      protein: sumTarget.protein / daysLogged,
      fat: sumTarget.fat / daysLogged,
      carbs: sumTarget.carbs / daysLogged
    };

    return {
      daysLogged: daysLogged,
      totalDays: nDays,
      regularityPct: regularityPct,
      avgConsumed: avgConsumed,
      avgTarget: avgTarget,
      totalConsumed: sumConsumed
    };
  }

  function regularityChipClass(pct) {
    if (pct >= 80) return "chip";
    if (pct >= 50) return "chip chip-amber";
    return "chip chip-red";
  }

  function renderStatsBlock(prefix, stats) {
    $(prefix + "DaysLogged").textContent = stats.daysLogged + " / " + stats.totalDays + " jours renseignés";

    var chip = $(prefix + "Regularity");
    chip.className = regularityChipClass(stats.regularityPct);
    chip.textContent = stats.regularityPct + "% de régularité";

    if (stats.daysLogged === 0) {
      $(prefix + "Gauges").innerHTML = "";
      $(prefix + "Totals").innerHTML = '<p class="note">Aucune donnée sur cette période pour le moment.</p>';
      return;
    }

    $(prefix + "Gauges").innerHTML = gaugesHtml(stats.avgConsumed, stats.avgTarget, true);

    var weeklyTargetTotal = stats.avgTarget.kcal * stats.totalDays;
    var cells = [
      { label: "Total kcal", value: round(stats.totalConsumed.kcal).toLocaleString("fr-FR") + " / " + round(weeklyTargetTotal).toLocaleString("fr-FR") },
      { label: "Total protéines", value: round(stats.totalConsumed.protein) + " g" },
      { label: "Moy. kcal / jour", value: round(stats.avgConsumed.kcal) + " kcal" },
      { label: "Jours dans la cible", value: Math.round(stats.regularityPct * stats.totalDays / 100) + " / " + stats.totalDays }
    ];
    var html = "";
    for (var i = 0; i < cells.length; i++) {
      html +=
        '<div class="stat-total-cell">' +
          '<span class="st-label">' + cells[i].label + '</span>' +
          '<span class="st-value">' + cells[i].value + '</span>' +
        '</div>';
    }
    $(prefix + "Totals").innerHTML = html;
  }

  function refreshStats() {
    var history = loadHistory();
    var hasAnyData = Object.keys(history).length > 0;

    $("statsEmpty").hidden = hasAnyData;
    $("statsContent").hidden = !hasAnyData;
    if (!hasAnyData) return;

    renderStatsBlock("week", computePeriodStats(7));
    renderStatsBlock("month", computePeriodStats(30));
  }

  /* ---------------------------------------------------------
     Aliments — gestion de la base (onglet "Aliments")
     --------------------------------------------------------- */

  var foodsEditState = { editingId: null };

  function refreshFoodsPanel() {
    var filterText = $("foodsFilter").value.trim().toLowerCase();
    var foods = loadFoods().slice();
    foods.sort(function (a, b) { return a.name.localeCompare(b.name, "fr"); });

    if (filterText) {
      foods = foods.filter(function (f) { return f.name.toLowerCase().indexOf(filterText) !== -1; });
    }

    $("foodsDbEmpty").hidden = foods.length > 0;

    var html = "";
    for (var i = 0; i < foods.length; i++) {
      var f = foods[i];
      html +=
        '<li class="food-db-row">' +
          '<div class="fdb-info">' +
            '<span class="fdb-name">' + escapeHtml(f.name) + '</span>' +
            '<span class="fdb-macros">' + f.kcal + ' kcal · P' + f.protein + ' L' + f.fat + ' G' + f.carbs + ' /100g</span>' +
          '</div>' +
          '<div class="fdb-actions">' +
            '<button type="button" class="icon-btn" data-edit="' + f.id + '" aria-label="Modifier">✎</button>' +
            '<button type="button" class="icon-btn icon-danger" data-delete="' + f.id + '" aria-label="Supprimer">×</button>' +
          '</div>' +
        '</li>';
    }
    $("foodsDbList").innerHTML = html;

    var editBtns = $("foodsDbList").querySelectorAll("[data-edit]");
    for (var j = 0; j < editBtns.length; j++) {
      editBtns[j].addEventListener("click", function (ev) {
        openFoodEditForm(ev.currentTarget.getAttribute("data-edit"));
      });
    }
    var delBtns = $("foodsDbList").querySelectorAll("[data-delete]");
    for (var k = 0; k < delBtns.length; k++) {
      delBtns[k].addEventListener("click", function (ev) {
        var id = ev.currentTarget.getAttribute("data-delete");
        var confirmed = window.confirm("Supprimer cet aliment de ta base ? Les entrées déjà enregistrées dans ton journal ne seront pas modifiées.");
        if (!confirmed) return;
        deleteFoodRecord(id);
        refreshFoodsPanel();
      });
    }
  }

  function openFoodEditForm(id) {
    var form = $("foodEditForm");
    if (id) {
      var foods = loadFoods();
      var food = findFoodById(foods, id);
      if (!food) return;
      foodsEditState.editingId = id;
      $("foodEditTitle").textContent = "Modifier l'aliment";
      $("editFoodId").value = id;
      $("editFoodName").value = food.name;
      $("editFoodKcal").value = food.kcal;
      $("editFoodProtein").value = food.protein;
      $("editFoodFat").value = food.fat;
      $("editFoodCarbs").value = food.carbs;
    } else {
      foodsEditState.editingId = null;
      $("foodEditTitle").textContent = "Nouvel aliment";
      form.reset();
      $("editFoodId").value = "";
    }
    form.hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeFoodEditForm() {
    foodsEditState.editingId = null;
    $("foodEditForm").hidden = true;
    $("foodEditForm").reset();
  }

  function handleFoodEditSubmit(e) {
    e.preventDefault();
    var data = {
      name: $("editFoodName").value.trim(),
      kcal: parseFloat($("editFoodKcal").value) || 0,
      protein: parseFloat($("editFoodProtein").value) || 0,
      fat: parseFloat($("editFoodFat").value) || 0,
      carbs: parseFloat($("editFoodCarbs").value) || 0
    };
    if (!data.name) return;

    if (foodsEditState.editingId) {
      updateFoodRecord(foodsEditState.editingId, data);
    } else {
      createFood(data);
    }

    closeFoodEditForm();
    refreshFoodsPanel();
  }

  /* ---------------------------------------------------------
     Navigation par onglets
     --------------------------------------------------------- */

  function switchTab(tabName) {
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      var isActive = tabs[i].getAttribute("data-tab") === tabName;
      tabs[i].classList.toggle("active", isActive);
      tabs[i].setAttribute("aria-selected", isActive ? "true" : "false");
    }

    var panels = { calc: "panel-calc", track: "panel-track", history: "panel-history", stats: "panel-stats", foods: "panel-foods" };
    for (var key in panels) {
      if (!panels.hasOwnProperty(key)) continue;
      var panelEl = $(panels[key]);
      var isTarget = key === tabName;
      panelEl.hidden = !isTarget;
      panelEl.classList.toggle("active", isTarget);
    }

    if (tabName === "track") refreshTracker();
    if (tabName === "history") {
      $("historyDetail").hidden = true;
      historyState.currentDetailKey = null;
      refreshHistory();
    }
    if (tabName === "stats") refreshStats();
    if (tabName === "foods") {
      closeFoodEditForm();
      refreshFoodsPanel();
    }
  }

  /* ---------------------------------------------------------
     Initialisation
     --------------------------------------------------------- */

  function init() {
    migrateLegacyLog();
    loadFoods();

    $("calcForm").addEventListener("submit", handleCalcSubmit);
    $("resetDay").addEventListener("click", handleResetDay);
    $("validateDay").addEventListener("click", handleValidateDay);

    setupFoodEntryUI({
      modeDb: $("addModeDb"),
      modeManual: $("addModeManual"),
      dbForm: $("dbAddForm"),
      manualForm: $("foodForm"),
      searchInput: $("foodSearch"),
      suggestionsEl: $("foodSuggestions"),
      noMatchEl: $("foodNoMatch"),
      previewEl: $("foodPreview"),
      gramsInput: $("foodGrams"),
      dbSubmitBtn: $("dbAddSubmit"),
      manualFields: { name: $("foodName"), kcal: $("foodKcal"), protein: $("foodProtein"), fat: $("foodFat"), carbs: $("foodCarbs") },
      getDateKey: function () { var r = ensureTodayRecord(); return r ? r.date : null; },
      onAdded: refreshTracker
    });

    setupFoodEntryUI({
      modeDb: $("detailAddModeDb"),
      modeManual: $("detailAddModeManual"),
      dbForm: $("detailDbAddForm"),
      manualForm: $("detailFoodForm"),
      searchInput: $("detailFoodSearch"),
      suggestionsEl: $("detailFoodSuggestions"),
      noMatchEl: $("detailFoodNoMatch"),
      previewEl: $("detailFoodPreview"),
      gramsInput: $("detailFoodGrams"),
      dbSubmitBtn: $("detailDbAddSubmit"),
      manualFields: { name: $("detailFoodName"), kcal: $("detailFoodKcal"), protein: $("detailFoodProtein"), fat: $("detailFoodFat"), carbs: $("detailFoodCarbs") },
      getDateKey: function () { return historyState.currentDetailKey; },
      onAdded: function () { renderHistoryDetail(historyState.currentDetailKey); }
    });

    $("detailValidate").addEventListener("click", handleDetailValidateToggle);
    $("detailDelete").addEventListener("click", handleDetailDelete);
    $("detailBack").addEventListener("click", closeHistoryDetail);

    $("viewList").addEventListener("change", function () { switchHistoryView("list"); });
    $("viewCalendar").addEventListener("change", function () { switchHistoryView("calendar"); });

    $("calPrev").addEventListener("click", function () {
      historyState.calendarCursor = new Date(historyState.calendarCursor.getFullYear(), historyState.calendarCursor.getMonth() - 1, 1);
      refreshHistory();
    });
    $("calNext").addEventListener("click", function () {
      historyState.calendarCursor = new Date(historyState.calendarCursor.getFullYear(), historyState.calendarCursor.getMonth() + 1, 1);
      refreshHistory();
    });

    $("showAddFood").addEventListener("click", function () { openFoodEditForm(null); });
    $("cancelFoodEdit").addEventListener("click", closeFoodEditForm);
    $("foodEditForm").addEventListener("submit", handleFoodEditSubmit);
    $("foodsFilter").addEventListener("input", refreshFoodsPanel);

    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function (ev) {
        switchTab(ev.currentTarget.getAttribute("data-tab"));
      });
    }

    $("goToTracker").addEventListener("click", function () { switchTab("track"); });
    $("goToCalcFromTrack").addEventListener("click", function () { switchTab("calc"); });

    loadExistingProfile();

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        var swUrl = new URL("sw.js", document.baseURI).href;
        navigator.serviceWorker.register(swUrl).catch(function () {
          // Échec silencieux : l'app reste utilisable en ligne.
        });
      });
    }

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      var activeTab = document.querySelector(".tab.active");
      if (!activeTab) return;
      var name = activeTab.getAttribute("data-tab");
      if (name === "track") refreshTracker();
      if (name === "stats") refreshStats();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
