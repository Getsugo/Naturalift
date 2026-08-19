/* =========================================================
   NaturaLift — app.js
   Calculateur nutritionnel + suivi quotidien + historique long
   terme + bilans hebdo/mensuels + base d'aliments réutilisables
   + scanner de code-barres (Open Food Facts).
   Vanilla JS, aucune dépendance de build. Compatible anciens
   navigateurs Android (pas d'optional chaining ni de nullish
   coalescing).
   ========================================================= */

(function () {
  "use strict";

  var STORAGE_PROFILE = "nl_profile_v1";
  var STORAGE_HISTORY = "nl_history_v1";   // { "YYYY-MM-DD": dayRecord }
  var STORAGE_FOODS = "nl_foods_v1";       // [ { id, name, kcal, protein, fat, carbs } ] pour 100g
  var STORAGE_WEIGHTS = "nl_weights_v1";   // [ { date, weight } ]
  var STORAGE_MEASUREMENTS = "nl_measurements_v1"; // [ { date, waist?, chest?, hips?, arm?, thigh? } ]
  var STORAGE_FAVORITES = "nl_favorites_v1";       // [ { id, name, items: [...] } ]
  var STORAGE_USAGE = "nl_food_usage_v1";          // { foodId: count }
  var STORAGE_LOG_LEGACY = "nl_log_v1";    // ancienne version (migration)
  var MAX_HISTORY_DAYS = 400;              // ~13 mois, borne la taille du localStorage
  var MAX_SUGGESTIONS = 8;
  var OFF_API_BASE = "https://world.openfoodfacts.org/api/v0/product/";

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

  function findFoodByBarcode(foods, barcode) {
    if (!barcode) return null;
    for (var i = 0; i < foods.length; i++) {
      if (foods[i].barcode && foods[i].barcode === barcode) return foods[i];
    }
    return null;
  }

  function searchFoods(query, limit) {
    var lower = query.trim().toLowerCase();
    if (!lower) return [];
    var usage = loadUsage();
    var foods = loadFoods().slice();
    foods.sort(function (a, b) {
      var ua = usage[a.id] || 0, ub = usage[b.id] || 0;
      if (ub !== ua) return ub - ua; // les plus utilisés d'abord
      return a.name.localeCompare(b.name, "fr");
    });
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
      carbs: data.carbs,
      barcode: data.barcode || null
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
    if (data.barcode !== undefined) food.barcode = data.barcode;
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
     Poids — stockage, statistiques, graphique, suggestion
     d'ajustement calorique basée sur la tendance réelle.
     --------------------------------------------------------- */

  // Cible indicative de variation hebdomadaire (% du poids corporel),
  // repères usuels pour un pratiquant naturel.
  var OBJECTIVE_WEEKLY_TARGET_PCT = {
    seche: -0.5,
    prise: 0.3,
    maintien: 0,
    recomp: 0
  };
  var KCAL_PER_KG = 7700; // approximation usuelle 1 kg de tissu ≈ 7700 kcal

  function loadWeights() {
    var w = readJSON(STORAGE_WEIGHTS);
    var arr = w || [];
    arr.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    return arr;
  }

  function saveWeights(arr) { writeJSON(STORAGE_WEIGHTS, arr); }

  function upsertWeight(date, weight) {
    var arr = loadWeights();
    var found = false;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].date === date) { arr[i].weight = weight; found = true; break; }
    }
    if (!found) arr.push({ date: date, weight: weight });
    saveWeights(arr);
  }

  function deleteWeight(date) {
    var arr = loadWeights().filter(function (w) { return w.date !== date; });
    saveWeights(arr);
  }

  function computeWeightStats(sorted) {
    if (sorted.length === 0) return null;
    var latest = sorted[sorted.length - 1];
    var today = new Date();

    function findClosestBefore(daysAgo) {
      var targetTime = addDays(today, -daysAgo).getTime();
      var best = null;
      for (var i = 0; i < sorted.length; i++) {
        if (parseDateKey(sorted[i].date).getTime() <= targetTime) best = sorted[i];
      }
      return best;
    }

    var ref7 = findClosestBefore(7);
    var ref30 = findClosestBefore(30);

    return {
      current: latest.weight,
      currentDate: latest.date,
      change7: ref7 && ref7.date !== latest.date ? round1(latest.weight - ref7.weight) : null,
      change30: ref30 && ref30.date !== latest.date ? round1(latest.weight - ref30.weight) : null
    };
  }

  function renderWeightStats(stats) {
    function cell(label, value) {
      var display = value === null ? "—" : (value > 0 ? "+" : "") + value + " kg";
      var cls = "ws-value";
      if (value !== null) cls += value < -0.05 ? " ws-down" : (value > 0.05 ? " ws-up" : " ws-flat");
      return '<div class="weight-stat-cell"><span class="ws-label">' + label + '</span><span class="' + cls + '">' + display + '</span></div>';
    }
    var html =
      '<div class="weight-stat-cell"><span class="ws-label">Actuel</span><span class="ws-value">' + stats.current + ' kg</span></div>' +
      cell("7 jours", stats.change7) +
      cell("30 jours", stats.change30);
    $("weightStatsGrid").innerHTML = html;
  }

  function buildWeightChartSvg(entries) {
    if (entries.length < 2) {
      return '<p class="weight-chart-empty">Ajoute au moins deux pesées pour voir apparaître un graphique.</p>';
    }

    var W = 320, H = 150, padL = 34, padR = 10, padT = 10, padB = 10;
    var chartW = W - padL - padR;
    var chartH = H - padT - padB;

    var dates = entries.map(function (e) { return parseDateKey(e.date).getTime(); });
    var minDate = Math.min.apply(null, dates);
    var maxDate = Math.max.apply(null, dates);
    var spanDate = (maxDate - minDate) || 1;

    var weights = entries.map(function (e) { return e.weight; });
    var minW = Math.min.apply(null, weights);
    var maxW = Math.max.apply(null, weights);
    if (minW === maxW) { minW -= 1; maxW += 1; }
    var pad = (maxW - minW) * 0.18;
    minW -= pad; maxW += pad;
    var spanW = maxW - minW;

    function xAt(date) { return padL + ((date - minDate) / spanDate) * chartW; }
    function yAt(w) { return padT + chartH - ((w - minW) / spanW) * chartH; }

    var trendPts = [];
    for (var i = 0; i < entries.length; i++) {
      var start = Math.max(0, i - 6);
      var slice = entries.slice(start, i + 1);
      var avg = slice.reduce(function (s, e) { return s + e.weight; }, 0) / slice.length;
      trendPts.push({ x: xAt(parseDateKey(entries[i].date).getTime()), y: yAt(avg) });
    }
    var rawPts = entries.map(function (e) {
      return { x: xAt(parseDateKey(e.date).getTime()), y: yAt(e.weight) };
    });

    function toPolyline(pts) {
      var out = [];
      for (var i = 0; i < pts.length; i++) out.push(pts[i].x.toFixed(1) + "," + pts[i].y.toFixed(1));
      return out.join(" ");
    }

    var gridLines = "";
    var steps = 3;
    for (var g = 0; g <= steps; g++) {
      var wVal = minW + (spanW * g / steps);
      var y = yAt(wVal);
      gridLines +=
        '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>' +
        '<text x="2" y="' + (y + 3).toFixed(1) + '" font-size="8" fill="#8a93a3" font-family="ui-monospace,monospace">' + wVal.toFixed(1) + '</text>';
    }

    var dots = "";
    for (var d = 0; d < rawPts.length; d++) {
      dots += '<circle cx="' + rawPts[d].x.toFixed(1) + '" cy="' + rawPts[d].y.toFixed(1) + '" r="2.2" fill="#8a93a3" />';
    }

    return (
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Courbe de poids">' +
        gridLines +
        '<polyline points="' + toPolyline(rawPts) + '" fill="none" stroke="#8a93a3" stroke-width="1" opacity="0.5" />' +
        dots +
        '<polyline points="' + toPolyline(trendPts) + '" fill="none" stroke="#c6ff3d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />' +
      '</svg>'
    );
  }

  // Tendance lissée sur ~14 jours (moyenne des premières vs dernières
  // pesées de la fenêtre) : moins bruitée qu'un simple point à point,
  // qui peut être trompé par la rétention d'eau d'un seul jour.
  function computeWeightTrendPerWeek(sorted) {
    var today = new Date();
    var cutoff = addDays(today, -14).getTime();
    var recent = sorted.filter(function (e) { return parseDateKey(e.date).getTime() >= cutoff; });
    if (recent.length < 4) return null;

    var first = recent[0];
    var last = recent[recent.length - 1];
    var daysSpan = (parseDateKey(last.date).getTime() - parseDateKey(first.date).getTime()) / 86400000;
    if (daysSpan < 6) return null;

    var n = recent.length;
    var headCount = Math.min(3, Math.ceil(n / 2));
    var tailCount = Math.min(3, Math.floor(n / 2));
    var head = recent.slice(0, headCount);
    var tail = recent.slice(n - tailCount);
    var avgHead = head.reduce(function (s, e) { return s + e.weight; }, 0) / head.length;
    var avgTail = tail.reduce(function (s, e) { return s + e.weight; }, 0) / tail.length;

    return { perWeek: (avgTail - avgHead) / (daysSpan / 7), currentWeight: avgTail };
  }

  function buildWeightSuggestion(trend, objective, currentWeight) {
    if (!trend || !objective || !OBJECTIVE_WEEKLY_TARGET_PCT.hasOwnProperty(objective)) return null;

    var targetPct = OBJECTIVE_WEEKLY_TARGET_PCT[objective];
    var targetKgPerWeek = (targetPct / 100) * currentWeight;
    var actual = trend.perWeek;

    if (objective === "maintien" || objective === "recomp") {
      var tolerance = 0.0015 * currentWeight;
      if (Math.abs(actual) <= tolerance) return null;
      var word = actual > 0 ? "pris" : "perdu";
      var kcalDelta = round(Math.abs(actual) * KCAL_PER_KG / 7);
      return "Ton poids a " + word + " en moyenne " + Math.abs(round1(actual)) + " kg/semaine ces 14 derniers jours, alors que l'objectif est le maintien. Essaie d'ajuster tes calories d'environ " + kcalDelta + " kcal/jour dans l'autre sens, puis recalcule tes cibles.";
    }

    var isRightDirection = (objective === "seche" && actual < 0) || (objective === "prise" && actual > 0);
    var magnitudeRatio = targetKgPerWeek !== 0 ? actual / targetKgPerWeek : 0;

    if (isRightDirection && magnitudeRatio >= 0.5 && magnitudeRatio <= 1.8) {
      return null; // trajectoire cohérente avec l'objectif, rien à signaler
    }

    var kcalGap = round(Math.abs(targetKgPerWeek - actual) * KCAL_PER_KG / 7);
    var trendLabel = (actual >= 0 ? "+" : "") + round1(actual) + " kg/semaine";

    if (!isRightDirection || magnitudeRatio < 0.5) {
      var action = objective === "seche" ? "réduire" : "augmenter";
      return "Ta tendance de poids (" + trendLabel + ") n'avance pas assez vite vers ton objectif ces 14 derniers jours. Envisage de " + action + " tes calories d'environ " + kcalGap + " kcal/jour et recalcule tes cibles.";
    }

    var actionFast = objective === "seche" ? "remonter" : "réduire";
    return "Ta tendance de poids (" + trendLabel + ") est plus rapide que ce qui est recommandé pour un naturel — risque de perte musculaire ou de prise de gras superflue. Envisage de " + actionFast + " tes calories d'environ " + kcalGap + " kcal/jour.";
  }

  function renderWeightList(weights) {
    var sorted = weights.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var recent = sorted.slice(0, 30);
    var today = todayKey();

    var html = "";
    for (var i = 0; i < recent.length; i++) {
      var w = recent[i];
      var label = w.date === today ? "Aujourd'hui" : formatDateShort(w.date);
      html +=
        '<li class="weight-row">' +
          '<span class="wr-date">' + label + '</span>' +
          '<span class="wr-value">' + w.weight + ' kg</span>' +
          '<button type="button" class="wr-del" data-date="' + w.date + '" aria-label="Supprimer">×</button>' +
        '</li>';
    }
    $("weightList").innerHTML = html;

    var delButtons = $("weightList").querySelectorAll(".wr-del");
    for (var j = 0; j < delButtons.length; j++) {
      delButtons[j].addEventListener("click", function (ev) {
        deleteWeight(ev.currentTarget.getAttribute("data-date"));
        refreshWeightPanel();
      });
    }
  }

  function refreshWeightPanel() {
    var weights = loadWeights();
    var today = todayKey();
    var todayEntry = null;
    for (var i = 0; i < weights.length; i++) {
      if (weights[i].date === today) { todayEntry = weights[i]; break; }
    }
    $("weightInput").value = todayEntry ? todayEntry.weight : "";
    $("weightSubmitBtn").textContent = todayEntry ? "Mettre à jour" : "Enregistrer";

    refreshMeasurements();

    if (weights.length === 0) {
      $("weightEmpty").hidden = false;
      $("weightContent").hidden = true;
      return;
    }
    $("weightEmpty").hidden = true;
    $("weightContent").hidden = false;

    var stats = computeWeightStats(weights);
    renderWeightStats(stats);

    var cutoff = addDays(new Date(), -30).getTime();
    var windowEntries = weights.filter(function (w) { return parseDateKey(w.date).getTime() >= cutoff; });
    $("weightChart").innerHTML = buildWeightChartSvg(windowEntries);

    var profile = readJSON(STORAGE_PROFILE);
    var suggestionEl = $("weightSuggestion");
    var msg = profile ? buildWeightSuggestion(computeWeightTrendPerWeek(weights), profile.objective, stats.current) : null;
    if (msg) {
      $("weightSuggestionText").textContent = msg;
      suggestionEl.hidden = false;
    } else {
      suggestionEl.hidden = true;
    }

    renderWeightList(weights);
  }

  function handleWeightSubmit(e) {
    e.preventDefault();
    var val = parseFloat($("weightInput").value);
    if (!val || val <= 0) return;
    upsertWeight(todayKey(), round1(val));
    refreshWeightPanel();
  }

  /* ---------------------------------------------------------
     Mensurations — facultatives, complètent le poids pour
     suivre une recomposition corporelle.
     --------------------------------------------------------- */

  var MEASUREMENT_META = {
    waist: "Taille",
    chest: "Poitrine",
    hips: "Hanches",
    arm: "Bras",
    thigh: "Cuisse"
  };
  var MEASUREMENT_FIELDS = ["waist", "chest", "hips", "arm", "thigh"];

  function loadMeasurements() {
    var m = readJSON(STORAGE_MEASUREMENTS);
    var arr = m || [];
    arr.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    return arr;
  }

  function saveMeasurements(arr) { writeJSON(STORAGE_MEASUREMENTS, arr); }

  function upsertMeasurement(date, data) {
    var arr = loadMeasurements();
    var found = null;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].date === date) { found = arr[i]; break; }
    }
    if (!found) { found = { date: date }; arr.push(found); }
    for (var j = 0; j < MEASUREMENT_FIELDS.length; j++) {
      var key = MEASUREMENT_FIELDS[j];
      var val = data[key];
      if (val !== null && val !== undefined && !isNaN(val)) found[key] = val;
    }
    saveMeasurements(arr);
  }

  function refreshMeasurements() {
    var arr = loadMeasurements();
    $("measurementsEmpty").hidden = arr.length > 0;

    // pré-remplit avec la dernière valeur connue de chaque champ (utile
    // car on ne mesure pas forcément tout le monde à chaque fois).
    var latestByField = {};
    for (var i = 0; i < arr.length; i++) {
      for (var f = 0; f < MEASUREMENT_FIELDS.length; f++) {
        var key = MEASUREMENT_FIELDS[f];
        if (arr[i][key] !== undefined) latestByField[key] = arr[i][key];
      }
    }
    $("measWaist").value = latestByField.waist !== undefined ? latestByField.waist : "";
    $("measChest").value = latestByField.chest !== undefined ? latestByField.chest : "";
    $("measHips").value = latestByField.hips !== undefined ? latestByField.hips : "";
    $("measArm").value = latestByField.arm !== undefined ? latestByField.arm : "";
    $("measThigh").value = latestByField.thigh !== undefined ? latestByField.thigh : "";

    var cutoff = addDays(new Date(), -30).getTime();
    var trendHtml = "";
    for (var t = 0; t < MEASUREMENT_FIELDS.length; t++) {
      var mkey = MEASUREMENT_FIELDS[t];
      var withField = arr.filter(function (e) { return e[mkey] !== undefined; });
      if (withField.length < 2) continue;
      var latest = withField[withField.length - 1];
      var older = withField[0];
      for (var k = 0; k < withField.length; k++) {
        if (parseDateKey(withField[k].date).getTime() <= cutoff) older = withField[k];
      }
      if (older.date === latest.date) continue;
      var delta = round1(latest[mkey] - older[mkey]);
      trendHtml += '<span class="mt-chip">' + MEASUREMENT_META[mkey] + ' : ' + (delta > 0 ? "+" : "") + delta + ' cm /30j</span>';
    }
    $("measurementsTrends").innerHTML = trendHtml;

    var sorted = arr.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 20);
    var today = todayKey();
    var html = "";
    for (var s = 0; s < sorted.length; s++) {
      var e = sorted[s];
      var parts = [];
      for (var p = 0; p < MEASUREMENT_FIELDS.length; p++) {
        var pkey = MEASUREMENT_FIELDS[p];
        if (e[pkey] !== undefined) parts.push(MEASUREMENT_META[pkey].charAt(0) + ":" + e[pkey]);
      }
      if (parts.length === 0) continue;
      var label = e.date === today ? "Aujourd'hui" : formatDateShort(e.date);
      html += '<li class="weight-row"><span class="wr-date">' + label + '</span><span class="wr-value">' + parts.join(" · ") + "</span></li>";
    }
    $("measurementsList").innerHTML = html;
  }

  function handleMeasurementsSubmit(e) {
    e.preventDefault();
    var data = {
      waist: parseFloat($("measWaist").value),
      chest: parseFloat($("measChest").value),
      hips: parseFloat($("measHips").value),
      arm: parseFloat($("measArm").value),
      thigh: parseFloat($("measThigh").value)
    };
    var hasAny = false;
    for (var k = 0; k < MEASUREMENT_FIELDS.length; k++) {
      if (!isNaN(data[MEASUREMENT_FIELDS[k]])) hasAny = true;
    }
    if (!hasAny) return;
    upsertMeasurement(todayKey(), data);
    refreshMeasurements();
  }

  /* ---------------------------------------------------------
     Hydratation — compteur quotidien simple, rattaché au
     dayRecord du jour (repère : ~35 ml/kg de poids corporel).
     --------------------------------------------------------- */

  function addWater(dateKey, deltaMl) {
    var history = loadHistory();
    var record = history[dateKey];
    if (!record) return null;
    record.waterMl = Math.max(0, (record.waterMl || 0) + deltaMl);
    saveHistory(history);
    return record;
  }

  function refreshHydrationUI(record, profile) {
    var target = (profile && profile.weight) ? Math.round(profile.weight * 35) : 2000;
    var current = record.waterMl || 0;
    var pct = Math.min(100, (current / target) * 100);
    $("hydrationBarFill").style.width = pct + "%";
    $("hydrationValue").textContent = current + " / " + target + " ml";
  }

  /* ---------------------------------------------------------
     Repas favoris — regroupe plusieurs entrées du journal sous
     un nom réutilisable en un tap (ex : "Petit-déj type").
     --------------------------------------------------------- */

  function loadFavorites() { return readJSON(STORAGE_FAVORITES) || []; }
  function saveFavorites(arr) { writeJSON(STORAGE_FAVORITES, arr); }

  function createFavoriteFromEntries(name, entries) {
    var favs = loadFavorites();
    var items = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      items.push({ name: e.name, kcal: e.kcal, protein: e.protein, fat: e.fat, carbs: e.carbs, grams: e.grams || null });
    }
    favs.push({ id: genId("fav"), name: name, items: items });
    saveFavorites(favs);
    return favs;
  }

  function deleteFavorite(id) {
    var favs = loadFavorites().filter(function (f) { return f.id !== id; });
    saveFavorites(favs);
    return favs;
  }

  function favoriteTotalKcal(fav) {
    var total = 0;
    for (var i = 0; i < fav.items.length; i++) total += fav.items[i].kcal;
    return total;
  }

  function renderFavoritesQuickAdd() {
    var favs = loadFavorites();
    var card = $("favoritesCard");
    if (favs.length === 0) { card.hidden = true; return; }
    card.hidden = false;

    var html = "";
    for (var i = 0; i < favs.length; i++) {
      var f = favs[i];
      html +=
        '<li><button type="button" class="favorite-row" data-id="' + f.id + '">' +
          '<span class="fav-icon">☆</span>' +
          '<span class="fav-name">' + escapeHtml(f.name) +
            '<span class="fav-sub">' + f.items.length + ' aliment' + (f.items.length > 1 ? "s" : "") + '</span>' +
          '</span>' +
          '<span class="fav-kcal">' + round(favoriteTotalKcal(f)) + ' kcal</span>' +
        '</button></li>';
    }
    $("favoritesList").innerHTML = html;

    var rows = $("favoritesList").querySelectorAll(".favorite-row");
    for (var j = 0; j < rows.length; j++) {
      rows[j].addEventListener("click", function (ev) {
        var id = ev.currentTarget.getAttribute("data-id");
        var fav = null;
        var all = loadFavorites();
        for (var k = 0; k < all.length; k++) { if (all[k].id === id) { fav = all[k]; break; } }
        if (!fav) return;

        var record = ensureTodayRecord();
        if (!record) return;
        for (var m = 0; m < fav.items.length; m++) {
          var item = fav.items[m];
          addFoodToDay(record.date, { name: item.name, kcal: item.kcal, protein: item.protein, fat: item.fat, carbs: item.carbs, grams: item.grams });
        }
        refreshTracker();
      });
    }
  }

  function refreshFavoritesManage() {
    var favs = loadFavorites();
    $("favoritesManageEmpty").hidden = favs.length > 0;

    var html = "";
    for (var i = 0; i < favs.length; i++) {
      var f = favs[i];
      html +=
        '<li class="food-db-row">' +
          '<div class="fdb-info">' +
            '<span class="fdb-name">' + escapeHtml(f.name) + '</span>' +
            '<span class="fdb-macros">' + f.items.length + ' aliment' + (f.items.length > 1 ? "s" : "") + ' · ' + round(favoriteTotalKcal(f)) + ' kcal</span>' +
          '</div>' +
          '<div class="fdb-actions">' +
            '<button type="button" class="icon-btn icon-danger" data-fav-delete="' + f.id + '" aria-label="Supprimer">×</button>' +
          '</div>' +
        '</li>';
    }
    $("favoritesManageList").innerHTML = html;

    var delBtns = $("favoritesManageList").querySelectorAll("[data-fav-delete]");
    for (var j = 0; j < delBtns.length; j++) {
      delBtns[j].addEventListener("click", function (ev) {
        var confirmed = window.confirm("Supprimer ce repas favori ?");
        if (!confirmed) return;
        deleteFavorite(ev.currentTarget.getAttribute("data-fav-delete"));
        refreshFavoritesManage();
        renderFavoritesQuickAdd();
      });
    }
  }

  function handleSaveAsFavorite() {
    var record = ensureTodayRecord();
    if (!record || record.entries.length === 0) return;
    var name = window.prompt("Nom de ce repas favori (ex : Petit-déj type) :");
    if (!name || !name.trim()) return;
    createFavoriteFromEntries(name.trim(), record.entries);
    renderFavoritesQuickAdd();
    window.alert('Repas favori "' + name.trim() + '" enregistré — retrouve-le en haut de l\'onglet Suivi ou dans Aliments > Repas favoris.');
  }

  /* ---------------------------------------------------------
     Aliments fréquents — comptage d'usage pour faire remonter
     ce que tu manges souvent, dans la recherche et une rangée
     de raccourcis rapides.
     --------------------------------------------------------- */

  function loadUsage() { return readJSON(STORAGE_USAGE) || {}; }
  function saveUsage(u) { writeJSON(STORAGE_USAGE, u); }

  function bumpUsage(foodId) {
    if (!foodId) return;
    var u = loadUsage();
    u[foodId] = (u[foodId] || 0) + 1;
    saveUsage(u);
  }

  function topFrequentFoods(limit) {
    var usage = loadUsage();
    var foods = loadFoods();
    var scored = [];
    for (var i = 0; i < foods.length; i++) {
      var count = usage[foods[i].id] || 0;
      if (count > 0) scored.push({ food: foods[i], count: count });
    }
    scored.sort(function (a, b) { return b.count - a.count; });
    var out = [];
    for (var j = 0; j < scored.length && j < limit; j++) out.push(scored[j].food);
    return out;
  }

  function renderFrequentChips(cfg) {
    if (!cfg.frequentListEl) return;
    var top = topFrequentFoods(6);
    if (top.length === 0) { cfg.frequentContainer.hidden = true; return; }
    cfg.frequentContainer.hidden = false;

    var html = "";
    for (var i = 0; i < top.length; i++) {
      html += '<button type="button" class="frequent-chip" data-id="' + top[i].id + '">' + escapeHtml(top[i].name) + '</button>';
    }
    cfg.frequentListEl.innerHTML = html;

    var chips = cfg.frequentListEl.querySelectorAll(".frequent-chip");
    for (var j = 0; j < chips.length; j++) {
      chips[j].addEventListener("click", function (ev) {
        var food = findFoodById(loadFoods(), ev.currentTarget.getAttribute("data-id"));
        if (!food) return;
        cfg.searchInput.value = food.name;
        cfg.searchInput.dispatchEvent(new Event("input"));
        cfg.gramsInput.focus();
        cfg.gramsInput.select();
      });
    }
  }

  /* ---------------------------------------------------------
     Photo de repas — redimensionnée et compressée côté client
     avant stockage (le localStorage a une capacité limitée).
     --------------------------------------------------------- */

  function readAndCompressImage(file, maxDim, quality, callback) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var cw = Math.max(1, Math.round(img.width * scale));
        var ch = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement("canvas");
        canvas.width = cw; canvas.height = ch;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, cw, ch);
        var dataUrl = null;
        try { dataUrl = canvas.toDataURL("image/jpeg", quality); } catch (e) { dataUrl = null; }
        callback(dataUrl);
      };
      img.onerror = function () { callback(null); };
      img.src = reader.result;
    };
    reader.onerror = function () { callback(null); };
    reader.readAsDataURL(file);
  }

  function setupPhotoCapture(cfg) {
    // cfg = { btn, input, previewEl, imgEl, removeBtn }
    var pendingDataUrl = null;

    cfg.btn.addEventListener("click", function () { cfg.input.click(); });

    cfg.input.addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      readAndCompressImage(file, 200, 0.55, function (dataUrl) {
        if (!dataUrl) return;
        pendingDataUrl = dataUrl;
        cfg.imgEl.src = dataUrl;
        cfg.previewEl.hidden = false;
      });
    });

    cfg.removeBtn.addEventListener("click", function () {
      pendingDataUrl = null;
      cfg.previewEl.hidden = true;
      cfg.imgEl.src = "";
    });

    return {
      getPhoto: function () { return pendingDataUrl; },
      clear: function () { pendingDataUrl = null; cfg.previewEl.hidden = true; cfg.imgEl.src = ""; }
    };
  }

  /* ---------------------------------------------------------
     Sauvegarde — export / import de toutes les données locales
     --------------------------------------------------------- */

  function exportAllData() {
    var payload = {
      app: "NaturaLift",
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: readJSON(STORAGE_PROFILE),
      history: readJSON(STORAGE_HISTORY),
      foods: readJSON(STORAGE_FOODS),
      weights: readJSON(STORAGE_WEIGHTS),
      measurements: readJSON(STORAGE_MEASUREMENTS),
      favorites: readJSON(STORAGE_FAVORITES),
      usage: readJSON(STORAGE_USAGE)
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "naturalift-sauvegarde-" + todayKey() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function showBackupStatus(msg, isError) {
    var el = $("backupStatus");
    el.hidden = false;
    el.textContent = msg;
    el.style.borderLeftColor = isError ? "var(--red)" : "var(--lime)";
  }

  function importAllData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        showBackupStatus("Fichier invalide : ce n'est pas une sauvegarde NaturaLift lisible.", true);
        return;
      }
      if (!data || data.app !== "NaturaLift") {
        showBackupStatus("Fichier invalide : ce n'est pas une sauvegarde NaturaLift.", true);
        return;
      }
      var confirmed = window.confirm("Importer cette sauvegarde va remplacer toutes tes données actuelles sur cet appareil (profil, historique, aliments, poids). Continuer ?");
      if (!confirmed) return;

      if (data.profile) writeJSON(STORAGE_PROFILE, data.profile);
      if (data.history) writeJSON(STORAGE_HISTORY, data.history);
      if (data.foods) writeJSON(STORAGE_FOODS, data.foods);
      if (data.weights) writeJSON(STORAGE_WEIGHTS, data.weights);
      if (data.measurements) writeJSON(STORAGE_MEASUREMENTS, data.measurements);
      if (data.favorites) writeJSON(STORAGE_FAVORITES, data.favorites);
      if (data.usage) writeJSON(STORAGE_USAGE, data.usage);

      showBackupStatus("Import réussi. Rechargement de l'application…", false);
      window.setTimeout(function () { window.location.reload(); }, 800);
    };
    reader.onerror = function () {
      showBackupStatus("Impossible de lire ce fichier.", true);
    };
    reader.readAsText(file);
  }

  /* ---------------------------------------------------------
     Open Food Facts — recherche par code-barres
     --------------------------------------------------------- */

  function lookupOpenFoodFacts(barcode, onDone) {
    var url = OFF_API_BASE + encodeURIComponent(barcode) + ".json";

    fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error("http-" + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data || data.status !== 1 || !data.product) {
          onDone({ found: false, barcode: barcode });
          return;
        }

        var p = data.product;
        var nutr = p.nutriments || {};

        var name = p.product_name || p.product_name_fr || p.generic_name || ("Produit " + barcode);

        var kcal = nutr["energy-kcal_100g"];
        if (kcal === undefined || kcal === null) {
          var kj = nutr["energy_100g"];
          kcal = (kj !== undefined && kj !== null) ? (kj / 4.184) : 0;
        }

        onDone({
          found: true,
          barcode: barcode,
          name: name,
          kcal: round(kcal || 0),
          protein: round1(nutr["proteins_100g"] || 0),
          fat: round1(nutr["fat_100g"] || 0),
          carbs: round1(nutr["carbohydrates_100g"] || 0)
        });
      })
      .catch(function () {
        onDone({ found: false, barcode: barcode, networkError: true });
      });
  }

  /* ---------------------------------------------------------
     Scanner caméra — overlay partagé (une seule session à la fois)
     Utilise la bibliothèque html5-qrcode chargée via CDN. Si elle
     n'est pas disponible (pas de réseau, bloquée, etc.) ou si la
     caméra est refusée/absente, un message clair est affiché et
     l'utilisateur peut basculer sur la saisie manuelle.
     --------------------------------------------------------- */

  var scannerState = { instance: null, active: false, onResult: null };

  function showScannerError(msg) {
    $("scannerHint").hidden = true;
    $("scannerError").hidden = false;
    $("scannerError").textContent = msg;
  }

  function stopScannerCamera() {
    if (scannerState.instance && scannerState.active) {
      scannerState.active = false;
      scannerState.instance.stop().then(function () {
        try { scannerState.instance.clear(); } catch (e) { /* noop */ }
      }).catch(function () { /* déjà arrêté */ });
    }
  }

  function closeScanner() {
    stopScannerCamera();
    $("scannerOverlay").hidden = true;
  }

  function openScanner(onBarcodeFound) {
    scannerState.onResult = onBarcodeFound;
    $("scannerOverlay").hidden = false;
    $("scannerHint").hidden = false;
    $("scannerError").hidden = true;
    $("scannerReader").innerHTML = "";

    if (!window.isSecureContext) {
      showScannerError("Le scanner nécessite une connexion sécurisée (HTTPS). Impossible d'accéder à la caméra ici.");
      return;
    }
    if (typeof Html5Qrcode === "undefined") {
      showScannerError("Scanner indisponible : la bibliothèque de lecture n'a pas pu être chargée. Vérifie ta connexion internet et réessaie.");
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showScannerError("Caméra non disponible sur cet appareil ou ce navigateur.");
      return;
    }

    var scanConfig = { fps: 10, qrbox: { width: 260, height: 160 } };
    if (typeof Html5QrcodeSupportedFormats !== "undefined") {
      scanConfig.formatsToSupport = [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128
      ];
    }

    scannerState.instance = new Html5Qrcode("scannerReader");
    scannerState.active = true;

    scannerState.instance.start(
      { facingMode: "environment" },
      scanConfig,
      function (decodedText) {
        stopScannerCamera();
        $("scannerOverlay").hidden = true;
        if (scannerState.onResult) scannerState.onResult(decodedText);
      },
      function () { /* aucune détection sur cette frame : normal, on ignore */ }
    ).catch(function (err) {
      scannerState.active = false;
      var str = (err && err.toString) ? err.toString() : String(err);
      var msg = "Impossible d'accéder à la caméra.";
      if (str.indexOf("NotAllowedError") !== -1 || str.indexOf("Permission") !== -1) {
        msg = "Accès à la caméra refusé. Autorise la caméra dans les paramètres de ton navigateur pour scanner un produit.";
      } else if (str.indexOf("NotFoundError") !== -1) {
        msg = "Aucune caméra détectée sur cet appareil.";
      } else if (str.indexOf("NotReadableError") !== -1) {
        msg = "La caméra est déjà utilisée par une autre application.";
      }
      showScannerError(msg);
    });
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
     Type de journée (repos / entraînement) — ajuste légèrement
     les glucides (et donc les calories) sans toucher protéines
     ni lipides. record.targets reste toujours la photo brute du
     profil ; l'ajustement est calculé à la volée à l'affichage.
     --------------------------------------------------------- */

  function setDayType(dateKey, type) {
    var history = loadHistory();
    var record = history[dateKey];
    if (!record) return null;
    record.dayType = (type === "neutral") ? null : type;
    saveHistory(history);
    return record;
  }

  function effectiveTargetsFor(record) {
    var base = record && record.targets;
    if (!base) return base;
    var type = record.dayType;
    if (type !== "training" && type !== "rest") return base;

    var carbFactor = type === "training" ? 1.15 : 0.85;
    var carbsAdjusted = Math.max(0, base.carbs * carbFactor);
    var kcalDelta = (carbsAdjusted - base.carbs) * KCAL_PER_G.carbs;

    return {
      kcal: round(base.kcal + kcalDelta),
      protein: base.protein,
      fat: base.fat,
      carbs: round(carbsAdjusted)
    };
  }

  /* ---------------------------------------------------------
     Statut d'une journée (couleur)
     --------------------------------------------------------- */

  function dayStatus(record) {
    if (!record || record.entries.length === 0) return "none";
    var totals = sumEntries(record.entries);
    var t = effectiveTargetsFor(record);
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

  function openSettings() { $("settingsOverlay").hidden = false; }
  function closeSettings() { $("settingsOverlay").hidden = true; }

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

    $("noProfileGoal").hidden = true;
    renderResults(targets, sex);
    closeSettings();
    switchTab("calc");
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function loadExistingProfile() {
    var profile = readJSON(STORAGE_PROFILE);
    if (!profile) {
      $("noProfileGoal").hidden = false;
      $("results").hidden = true;
      return;
    }
    $("noProfileGoal").hidden = true;

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
     détail d'une journée passée. Trois sous-modes partagent le
     même sélecteur segmenté : base de données (recherche +
     autocomplétion custom), scanner (caméra + Open Food Facts)
     et saisie manuelle.
     --------------------------------------------------------- */

  function setupFoodEntryUI(cfg) {
    // cfg = {
    //   modeDb, modeScan, modeManual,           radios
    //   dbForm, scanPanel, manualForm,          conteneurs des 3 modes
    //   searchInput, suggestionsEl, noMatchEl, previewEl, gramsInput, dbSubmitBtn,
    //   manualFields: { name, kcal, protein, fat, carbs },
    //   scan: {
    //     openBtn, statusEl, notFoundEl, notFoundMsgEl, useManualBtn,
    //     form, nameInput, kcalInput, proteinInput, fatInput, carbsInput,
    //     gramsInput, saveToDbCheckbox, incompleteEl
    //   },
    //   getDateKey, onAdded
    // }

    var activeIndex = -1;
    var currentMatches = [];

    /* ---------- Mode "Ma base" (recherche + autocomplétion) ---------- */

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
      bumpUsage(match.id);
      renderFrequentChips(cfg);

      cfg.dbForm.reset();
      cfg.gramsInput.value = "100";
      cfg.previewEl.hidden = true;
      cfg.noMatchEl.hidden = true;
      cfg.dbSubmitBtn.disabled = true;
      hideSuggestions();
      cfg.onAdded();
    });

    /* ---------- Mode "Manuel" ---------- */

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

      if (cfg.photoCtrl) {
        var photo = cfg.photoCtrl.getPhoto();
        if (photo) entry.photo = photo;
      }

      try {
        addFoodToDay(dateKey, entry);
      } catch (err) {
        // Le plus souvent une photo trop lourde qui dépasse le quota du
        // localStorage : on prévient plutôt que de perdre l'entrée en silence.
        window.alert("Impossible d'enregistrer (stockage local plein). Réessaie sans photo, ou libère de la place dans Aliments > Sauvegarde.");
        return;
      }

      cfg.manualForm.reset();
      if (cfg.photoCtrl) cfg.photoCtrl.clear();
      cfg.onAdded();
    });

    /* ---------- Mode "Scanner" ---------- */

    var scan = cfg.scan;

    function resetScanPanel() {
      scan.statusEl.hidden = true;
      scan.notFoundEl.hidden = true;
      scan.form.hidden = true;
    }

    function populateScanForm(data, barcode, sourceLabel, allowSaveToggle) {
      scan.nameInput.value = data.name;
      scan.kcalInput.value = data.kcal;
      scan.proteinInput.value = data.protein;
      scan.fatInput.value = data.fat;
      scan.carbsInput.value = data.carbs;
      scan.gramsInput.value = "100";
      scan.form.setAttribute("data-barcode", barcode);
      if (scan.barcodeLabelEl) scan.barcodeLabelEl.textContent = barcode;
      if (scan.sourceChipEl) scan.sourceChipEl.textContent = sourceLabel;

      if (allowSaveToggle) {
        scan.saveToDbCheckbox.checked = true;
        scan.saveToDbCheckbox.parentElement.hidden = false;
      } else {
        // Déjà dans la base locale : pas besoin de reproposer la case.
        scan.saveToDbCheckbox.checked = false;
        scan.saveToDbCheckbox.parentElement.hidden = true;
      }

      var looksEmpty = data.kcal === 0 && data.protein === 0 && data.fat === 0 && data.carbs === 0;
      scan.incompleteEl.hidden = !looksEmpty || !allowSaveToggle;

      scan.form.hidden = false;

      // Le nom vient parfois d'une base communautaire imparfaite : on
      // sélectionne le texte pour que corriger soit aussi simple que de
      // se mettre à taper.
      scan.nameInput.focus();
      scan.nameInput.select();
    }

    function handleBarcode(barcode) {
      resetScanPanel();

      // 1) Ta propre base d'abord — reconnaissance instantanée, fonctionne
      // même hors-ligne, aucun appel réseau nécessaire.
      var localMatch = findFoodByBarcode(loadFoods(), barcode);
      if (localMatch) {
        populateScanForm(localMatch, barcode, "⚡ Ta base", false);
        return;
      }

      // 2) Sinon on interroge Open Food Facts.
      scan.statusEl.hidden = false;
      scan.statusEl.textContent = "Recherche du produit (code " + barcode + ")…";

      lookupOpenFoodFacts(barcode, function (result) {
        scan.statusEl.hidden = true;

        if (!result.found) {
          scan.notFoundEl.hidden = false;
          scan.notFoundEl.setAttribute("data-barcode", result.barcode);
          scan.notFoundMsgEl.textContent = result.networkError ?
            "Impossible de contacter Open Food Facts — vérifie ta connexion internet." :
            "Produit introuvable dans Open Food Facts (code-barres : " + result.barcode + "). Ajoute-le une fois à ta base : il sera reconnu instantanément la prochaine fois, même hors-ligne.";
          return;
        }

        populateScanForm(result, result.barcode, "Open Food Facts", true);
      });
    }

    scan.openBtn.addEventListener("click", function () {
      resetScanPanel();
      openScanner(handleBarcode);
    });

    scan.useManualBtn.addEventListener("click", function () {
      resetScanPanel();
      cfg.modeManual.checked = true;
      cfg.modeManual.dispatchEvent(new Event("change"));
    });

    scan.createFromNotFoundBtn.addEventListener("click", function () {
      var barcode = scan.notFoundEl.getAttribute("data-barcode") || "";
      scan.notFoundEl.hidden = true;
      populateScanForm({ name: "", kcal: 0, protein: 0, fat: 0, carbs: 0 }, barcode, "Nouveau produit", true);
      scan.nameInput.value = "";
      scan.incompleteEl.hidden = true;
    });

    scan.form.addEventListener("submit", function (e) {
      e.preventDefault();
      var grams = parseFloat(scan.gramsInput.value) || 0;
      if (grams <= 0) return;
      var factor = grams / 100;

      var name = scan.nameInput.value.trim();
      if (!name) return;
      var per100 = {
        kcal: parseFloat(scan.kcalInput.value) || 0,
        protein: parseFloat(scan.proteinInput.value) || 0,
        fat: parseFloat(scan.fatInput.value) || 0,
        carbs: parseFloat(scan.carbsInput.value) || 0
      };
      var barcodeVal = scan.form.getAttribute("data-barcode") || null;

      var entry = {
        name: name,
        kcal: round(per100.kcal * factor),
        protein: round1(per100.protein * factor),
        fat: round1(per100.fat * factor),
        carbs: round1(per100.carbs * factor),
        grams: grams,
        barcode: barcodeVal
      };

      var dateKey = cfg.getDateKey();
      if (!dateKey) return;
      addFoodToDay(dateKey, entry);

      if (scan.saveToDbCheckbox.checked) {
        var foods = loadFoods();
        var existing = findFoodByName(foods, name);
        if (!existing) {
          createFood({ name: name, kcal: per100.kcal, protein: per100.protein, fat: per100.fat, carbs: per100.carbs, barcode: barcodeVal });
        } else if (barcodeVal && !existing.barcode) {
          // Aliment déjà présent par nom mais pas encore lié à ce code-barres.
          updateFoodRecord(existing.id, { name: existing.name, kcal: existing.kcal, protein: existing.protein, fat: existing.fat, carbs: existing.carbs, barcode: barcodeVal });
        }
      }

      resetScanPanel();
      cfg.onAdded();
    });

    /* ---------- Bascule entre les 3 modes ---------- */

    function showMode(mode) {
      cfg.dbForm.hidden = mode !== "db";
      cfg.scanPanel.hidden = mode !== "scan";
      cfg.manualForm.hidden = mode !== "manual";
      if (mode !== "db") hideSuggestions();
      if (mode !== "scan") resetScanPanel();
    }

    cfg.modeDb.addEventListener("change", function () { showMode("db"); });
    cfg.modeScan.addEventListener("change", function () { showMode("scan"); });
    cfg.modeManual.addEventListener("change", function () { showMode("manual"); });

    renderFrequentChips(cfg);
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
      var thumb = e.photo ? '<img class="food-thumb" src="' + e.photo + '" alt="">' : '';
      html +=
        '<li class="food-item">' + thumb +
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

    $("gaugesGrid").innerHTML = gaugesHtml(totals, effectiveTargetsFor(record), false);
    renderFoodListInto($("foodLog"), $("logEmpty"), record.entries, function (id) {
      removeFoodFromDay(record.date, id);
      refreshTracker();
    });

    $("trackDate").textContent = formatDateLong(record.date);
    $("validatedChip").hidden = !record.validated;
    $("validateDay").hidden = record.validated;
    $("saveAsFavorite").hidden = record.entries.length === 0;

    var dtVal = record.dayType || "neutral";
    var dtId = dtVal === "rest" ? "dayTypeRest" : (dtVal === "training" ? "dayTypeTraining" : "dayTypeNeutral");
    var dtInput = document.getElementById(dtId);
    if (dtInput) dtInput.checked = true;

    refreshHydrationUI(record, profile);
    renderFavoritesQuickAdd();
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
    $("detailGauges").innerHTML = gaugesHtml(totals, effectiveTargetsFor(record), false);

    var dtVal = record.dayType || "neutral";
    var dtId = dtVal === "rest" ? "detailDayTypeRest" : (dtVal === "training" ? "detailDayTypeTraining" : "detailDayTypeNeutral");
    var dtInput = document.getElementById(dtId);
    if (dtInput) dtInput.checked = true;

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

      var tg = effectiveTargetsFor(recordsWithData[j]);
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
    var usage = loadUsage();
    var foods = loadFoods().slice();
    foods.sort(function (a, b) {
      var ua = usage[a.id] || 0, ub = usage[b.id] || 0;
      if (ub !== ua) return ub - ua;
      return a.name.localeCompare(b.name, "fr");
    });

    if (filterText) {
      foods = foods.filter(function (f) { return f.name.toLowerCase().indexOf(filterText) !== -1; });
    }

    $("foodsDbEmpty").hidden = foods.length > 0;

    var html = "";
    for (var i = 0; i < foods.length; i++) {
      var f = foods[i];
      var barcodeTag = f.barcode ? ' · 📷 ' + f.barcode : '';
      html +=
        '<li class="food-db-row">' +
          '<div class="fdb-info">' +
            '<span class="fdb-name">' + escapeHtml(f.name) + '</span>' +
            '<span class="fdb-macros">' + f.kcal + ' kcal · P' + f.protein + ' L' + f.fat + ' G' + f.carbs + ' /100g' + barcodeTag + '</span>' +
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

    var panels = { calc: "panel-calc", track: "panel-track", history: "panel-history", stats: "panel-stats", weight: "panel-weight", foods: "panel-foods" };
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
    if (tabName === "weight") refreshWeightPanel();
    if (tabName === "foods") {
      closeFoodEditForm();
      refreshFoodsPanel();
      refreshFavoritesManage();
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
    $("scannerClose").addEventListener("click", closeScanner);

    var trackPhotoCtrl = setupPhotoCapture({
      btn: $("foodPhotoBtn"),
      input: $("foodPhotoInput"),
      previewEl: $("foodPhotoPreview"),
      imgEl: $("foodPhotoImg"),
      removeBtn: $("foodPhotoRemove")
    });

    setupFoodEntryUI({
      modeDb: $("addModeDb"),
      modeScan: $("addModeScan"),
      modeManual: $("addModeManual"),
      dbForm: $("dbAddForm"),
      scanPanel: $("scanAddPanel"),
      manualForm: $("foodForm"),
      searchInput: $("foodSearch"),
      suggestionsEl: $("foodSuggestions"),
      noMatchEl: $("foodNoMatch"),
      previewEl: $("foodPreview"),
      gramsInput: $("foodGrams"),
      dbSubmitBtn: $("dbAddSubmit"),
      manualFields: { name: $("foodName"), kcal: $("foodKcal"), protein: $("foodProtein"), fat: $("foodFat"), carbs: $("foodCarbs") },
      photoCtrl: trackPhotoCtrl,
      frequentContainer: $("frequentFoods"),
      frequentListEl: $("frequentFoodsList"),
      scan: {
        openBtn: $("openScannerBtn"),
        statusEl: $("scanStatus"),
        notFoundEl: $("scanNotFound"),
        notFoundMsgEl: $("scanNotFoundMsg"),
        createFromNotFoundBtn: $("scanCreateFromScan"),
        useManualBtn: $("scanUseManual"),
        form: $("scanAddForm"),
        nameInput: $("scanProductName"),
        kcalInput: $("scanKcal"),
        proteinInput: $("scanProtein"),
        fatInput: $("scanFat"),
        carbsInput: $("scanCarbs"),
        gramsInput: $("scanGrams"),
        saveToDbCheckbox: $("scanSaveToDb"),
        incompleteEl: $("scanIncomplete"),
        barcodeLabelEl: $("scanBarcodeLabel"),
        sourceChipEl: $("scanSourceChip")
      },
      getDateKey: function () { var r = ensureTodayRecord(); return r ? r.date : null; },
      onAdded: refreshTracker
    });

    var detailPhotoCtrl = setupPhotoCapture({
      btn: $("detailFoodPhotoBtn"),
      input: $("detailFoodPhotoInput"),
      previewEl: $("detailFoodPhotoPreview"),
      imgEl: $("detailFoodPhotoImg"),
      removeBtn: $("detailFoodPhotoRemove")
    });

    setupFoodEntryUI({
      modeDb: $("detailAddModeDb"),
      modeScan: $("detailAddModeScan"),
      modeManual: $("detailAddModeManual"),
      dbForm: $("detailDbAddForm"),
      scanPanel: $("detailScanAddPanel"),
      manualForm: $("detailFoodForm"),
      searchInput: $("detailFoodSearch"),
      suggestionsEl: $("detailFoodSuggestions"),
      noMatchEl: $("detailFoodNoMatch"),
      previewEl: $("detailFoodPreview"),
      gramsInput: $("detailFoodGrams"),
      dbSubmitBtn: $("detailDbAddSubmit"),
      manualFields: { name: $("detailFoodName"), kcal: $("detailFoodKcal"), protein: $("detailFoodProtein"), fat: $("detailFoodFat"), carbs: $("detailFoodCarbs") },
      photoCtrl: detailPhotoCtrl,
      scan: {
        openBtn: $("detailOpenScannerBtn"),
        statusEl: $("detailScanStatus"),
        notFoundEl: $("detailScanNotFound"),
        notFoundMsgEl: $("detailScanNotFoundMsg"),
        createFromNotFoundBtn: $("detailScanCreateFromScan"),
        useManualBtn: $("detailScanUseManual"),
        form: $("detailScanAddForm"),
        nameInput: $("detailScanProductName"),
        kcalInput: $("detailScanKcal"),
        proteinInput: $("detailScanProtein"),
        fatInput: $("detailScanFat"),
        carbsInput: $("detailScanCarbs"),
        gramsInput: $("detailScanGrams"),
        saveToDbCheckbox: $("detailScanSaveToDb"),
        incompleteEl: $("detailScanIncomplete"),
        barcodeLabelEl: $("detailScanBarcodeLabel"),
        sourceChipEl: $("detailScanSourceChip")
      },
      getDateKey: function () { return historyState.currentDetailKey; },
      onAdded: function () { renderHistoryDetail(historyState.currentDetailKey); }
    });

    $("detailValidate").addEventListener("click", handleDetailValidateToggle);
    $("detailDelete").addEventListener("click", handleDetailDelete);
    $("detailBack").addEventListener("click", closeHistoryDetail);

    $("dayTypeRest").addEventListener("change", function () {
      var r = ensureTodayRecord(); if (r) { setDayType(r.date, "rest"); refreshTracker(); }
    });
    $("dayTypeNeutral").addEventListener("change", function () {
      var r = ensureTodayRecord(); if (r) { setDayType(r.date, "neutral"); refreshTracker(); }
    });
    $("dayTypeTraining").addEventListener("change", function () {
      var r = ensureTodayRecord(); if (r) { setDayType(r.date, "training"); refreshTracker(); }
    });
    $("detailDayTypeRest").addEventListener("change", function () {
      if (historyState.currentDetailKey) { setDayType(historyState.currentDetailKey, "rest"); renderHistoryDetail(historyState.currentDetailKey); }
    });
    $("detailDayTypeNeutral").addEventListener("change", function () {
      if (historyState.currentDetailKey) { setDayType(historyState.currentDetailKey, "neutral"); renderHistoryDetail(historyState.currentDetailKey); }
    });
    $("detailDayTypeTraining").addEventListener("change", function () {
      if (historyState.currentDetailKey) { setDayType(historyState.currentDetailKey, "training"); renderHistoryDetail(historyState.currentDetailKey); }
    });

    $("hydrationPlus").addEventListener("click", function () {
      var r = ensureTodayRecord(); if (r) { addWater(r.date, 250); refreshTracker(); }
    });
    $("hydrationMinus").addEventListener("click", function () {
      var r = ensureTodayRecord(); if (r) { addWater(r.date, -250); refreshTracker(); }
    });

    $("saveAsFavorite").addEventListener("click", handleSaveAsFavorite);
    $("measurementsForm").addEventListener("submit", handleMeasurementsSubmit);

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

    $("weightForm").addEventListener("submit", handleWeightSubmit);
    $("weightGoToCalc").addEventListener("click", function () { openSettings(); });

    $("exportDataBtn").addEventListener("click", exportAllData);
    $("importDataBtn").addEventListener("click", function () { $("importDataFile").click(); });
    $("importDataFile").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) importAllData(file);
      e.target.value = "";
    });

    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function (ev) {
        switchTab(ev.currentTarget.getAttribute("data-tab"));
      });
    }

    $("goToTracker").addEventListener("click", function () { switchTab("track"); });
    $("goToCalcFromTrack").addEventListener("click", function () { openSettings(); });

    $("openSettingsBtn").addEventListener("click", openSettings);
    $("openSettingsFromGoal").addEventListener("click", openSettings);
    $("settingsClose").addEventListener("click", closeSettings);

    loadExistingProfile();

    // Une fois le profil configuré, l'écran d'accueil utile au quotidien
    // est le Suivi, pas l'onglet Objectif (consulté une fois puis oublié).
    if (readJSON(STORAGE_PROFILE)) {
      switchTab("track");
    }

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
      if (name === "weight") refreshWeightPanel();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
