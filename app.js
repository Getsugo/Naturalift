/* =========================================================
   NaturaLift — app.js
   Calculateur nutritionnel pour pratiquants naturels + suivi quotidien.
   Vanilla JS, aucune dépendance. Compatible anciens navigateurs Android
   (pas d'optional chaining ni de nullish coalescing).
   ========================================================= */

(function () {
  "use strict";

  var STORAGE_PROFILE = "nl_profile_v1";
  var STORAGE_LOG = "nl_log_v1";

  /* ---------------------------------------------------------
     Constantes métier
     --------------------------------------------------------- */

  // Ajustement calorique par objectif, différencié par sexe car les
  // femmes naturelles tolèrent en général moins bien les gros déficits
  // (impact hormonal / cycle) : le déficit est donc plus modéré.
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

  // Plancher lipidique minimal (g/kg) — la santé hormonale (testostérone
  // chez l'homme, cycle chez la femme) est compromise en-dessous.
  var FAT_FLOOR_PER_KG = { H: 0.8, F: 0.95 };

  var KCAL_PER_G = { protein: 4, fat: 9, carbs: 4 };

  var MACRO_META = {
    protein: { label: "Protéines", unit: "g", color: "var(--lime)" },
    fat: { label: "Lipides", unit: "g", color: "var(--amber)" },
    carbs: { label: "Glucides", unit: "g", color: "var(--cyan)" }
  };

  /* ---------------------------------------------------------
     Utilitaires
     --------------------------------------------------------- */

  function $(id) { return document.getElementById(id); }

  function round(n) { return Math.round(n); }

  function todayKey() {
    var d = new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }

  function readJSON(key) {
    var raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  /* ---------------------------------------------------------
     Calcul du métabolisme et des macros
     Formule de Mifflin-St Jeor (référence la plus fiable et la mieux
     validée pour des sujets non obèses, hommes et femmes confondus).
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
    var kcalAdjustRatio = config.kcalAdjust[sex];
    var targetKcal = tdee * (1 + kcalAdjustRatio);

    // Protéines : priorité absolue chez le naturel pour préserver la masse
    // musculaire, en particulier en déficit calorique.
    var proteinG = config.proteinPerKg[sex] * weight;

    // Lipides : au moins le plancher hormonal, sinon un pourcentage
    // raisonnable des calories totales.
    var fatFromRatio = config.fatPerKg[sex] * weight;
    var fatFloor = FAT_FLOOR_PER_KG[sex] * weight;
    var fatG = Math.max(fatFromRatio, fatFloor);

    // Glucides : ce qui reste du budget calorique une fois protéines et
    // lipides couverts (jamais négatif).
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

    // Projection hebdomadaire / mensuelle
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

    renderResults(targets, sex);

    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function loadExistingProfile() {
    var profile = readJSON(STORAGE_PROFILE);
    if (!profile) return;

    // Réinjecte les valeurs du formulaire
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
     Journal quotidien — lecture / écriture / reset automatique
     --------------------------------------------------------- */

  function getTodayLog() {
    var log = readJSON(STORAGE_LOG);
    var today = todayKey();
    if (!log || log.date !== today) {
      log = { date: today, entries: [] };
      writeJSON(STORAGE_LOG, log);
    }
    return log;
  }

  function saveLog(log) {
    writeJSON(STORAGE_LOG, log);
  }

  function addFoodEntry(entry) {
    var log = getTodayLog();
    entry.id = Date.now() + "-" + Math.floor(Math.random() * 1000);
    log.entries.push(entry);
    saveLog(log);
    return log;
  }

  function removeFoodEntry(id) {
    var log = getTodayLog();
    var filtered = [];
    for (var i = 0; i < log.entries.length; i++) {
      if (log.entries[i].id !== id) filtered.push(log.entries[i]);
    }
    log.entries = filtered;
    saveLog(log);
    return log;
  }

  function sumLog(log) {
    var totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    for (var i = 0; i < log.entries.length; i++) {
      var e = log.entries[i];
      totals.kcal += e.kcal;
      totals.protein += e.protein;
      totals.fat += e.fat;
      totals.carbs += e.carbs;
    }
    return totals;
  }

  /* ---------------------------------------------------------
     Rendu — Suivi
     --------------------------------------------------------- */

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

  function renderGauges(totals, targets) {
    var defs = [
      { key: "kcal", label: "Calories", unit: "kcal", isProtein: false },
      { key: "protein", label: "Protéines", unit: "g", isProtein: true },
      { key: "fat", label: "Lipides", unit: "g", isProtein: false },
      { key: "carbs", label: "Glucides", unit: "g", isProtein: false }
    ];

    var html = "";
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var value = totals[d.key];
      var target = targets[d.key];
      var pct = target > 0 ? (value / target) * 100 : 0;
      var displayPct = Math.min(pct, 100);
      var color = gaugeColor(pct, d.isProtein);

      html +=
        '<div class="gauge">' +
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
    $("gaugesGrid").innerHTML = html;
  }

  function renderFoodLog(log) {
    var listEl = $("foodLog");
    var emptyEl = $("logEmpty");

    if (log.entries.length === 0) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    var html = "";
    for (var i = log.entries.length - 1; i >= 0; i--) {
      var e = log.entries[i];
      html +=
        '<li class="food-item">' +
          '<span class="food-name">' + escapeHtml(e.name) +
            '<span class="food-macros">P ' + e.protein + 'g · L ' + e.fat + 'g · G ' + e.carbs + 'g</span>' +
          '</span>' +
          '<span class="food-kcal">' + e.kcal + '</span>' +
          '<button type="button" class="food-del" data-id="' + e.id + '" aria-label="Supprimer">×</button>' +
        '</li>';
    }
    listEl.innerHTML = html;

    var delButtons = listEl.querySelectorAll(".food-del");
    for (var j = 0; j < delButtons.length; j++) {
      delButtons[j].addEventListener("click", function (ev) {
        var id = ev.currentTarget.getAttribute("data-id");
        var updatedLog = removeFoodEntry(id);
        refreshTracker(updatedLog);
      });
    }
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function refreshTracker(log) {
    var profile = readJSON(STORAGE_PROFILE);
    if (!profile) {
      $("noProfile").hidden = false;
      $("trackerContent").hidden = true;
      return;
    }
    $("noProfile").hidden = true;
    $("trackerContent").hidden = false;

    var totals = sumLog(log);
    renderGauges(totals, profile.targets);
    renderFoodLog(log);

    var d = new Date();
    var dateLabel = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    $("trackDate").textContent = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);
  }

  function handleFoodSubmit(e) {
    e.preventDefault();

    var entry = {
      name: $("foodName").value.trim(),
      kcal: parseFloat($("foodKcal").value) || 0,
      protein: parseFloat($("foodProtein").value) || 0,
      fat: parseFloat($("foodFat").value) || 0,
      carbs: parseFloat($("foodCarbs").value) || 0
    };
    if (!entry.name) return;

    var log = addFoodEntry(entry);
    refreshTracker(log);

    document.getElementById("foodForm").reset();
    $("foodKcal").focus();
  }

  function handleResetDay() {
    var confirmed = window.confirm("Réinitialiser le journal du jour ? Cette action est irréversible.");
    if (!confirmed) return;
    var log = { date: todayKey(), entries: [] };
    saveLog(log);
    refreshTracker(log);
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

    $("panel-calc").hidden = tabName !== "calc";
    $("panel-calc").classList.toggle("active", tabName === "calc");
    $("panel-track").hidden = tabName !== "track";
    $("panel-track").classList.toggle("active", tabName === "track");

    if (tabName === "track") {
      refreshTracker(getTodayLog());
    }
  }

  /* ---------------------------------------------------------
     Initialisation
     --------------------------------------------------------- */

  function init() {
    $("calcForm").addEventListener("submit", handleCalcSubmit);
    $("foodForm").addEventListener("submit", handleFoodSubmit);
    $("resetDay").addEventListener("click", handleResetDay);

    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function (ev) {
        switchTab(ev.currentTarget.getAttribute("data-tab"));
      });
    }

    $("goToTracker").addEventListener("click", function () {
      switchTab("track");
    });
    $("goToCalcFromTrack").addEventListener("click", function () {
      switchTab("calc");
    });

    loadExistingProfile();

    if (readJSON(STORAGE_PROFILE)) {
      $("noProfile").hidden = true;
    }

    // Service worker (chemin relatif pour compatibilité GitHub Pages,
    // y compris quand le site est servi depuis un sous-dossier /repo/).
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        var swUrl = new URL("sw.js", document.baseURI).href;
        navigator.serviceWorker.register(swUrl).catch(function () {
          // Échec silencieux : l'app reste utilisable en ligne.
        });
      });
    }

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && !$("panel-track").hidden) {
        refreshTracker(getTodayLog());
      }
    });

    init._done = true;
  }

  document.addEventListener("DOMContentLoaded", init);
})();
