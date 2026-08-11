/* =========================================================
   NaturaLift — app.js
   Calculateur nutritionnel pour pratiquants naturels + suivi
   quotidien + historique long terme + bilans hebdo/mensuels.
   Vanilla JS, aucune dépendance. Compatible anciens navigateurs
   Android (pas d'optional chaining ni de nullish coalescing).
   ========================================================= */

(function () {
  "use strict";

  var STORAGE_PROFILE = "nl_profile_v1";
  var STORAGE_HISTORY = "nl_history_v1";   // { "YYYY-MM-DD": dayRecord }
  var STORAGE_LOG_LEGACY = "nl_log_v1";    // ancienne version (migration)
  var MAX_HISTORY_DAYS = 400;              // ~13 mois, borne la taille du localStorage

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

  var WEEKDAY_SHORT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

  /* ---------------------------------------------------------
     Utilitaires génériques
     --------------------------------------------------------- */

  function $(id) { return document.getElementById(id); }

  function round(n) { return Math.round(n); }

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
    keys.sort(); // tri chronologique croissant (format YYYY-MM-DD trie naturellement)
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

  // Garantit qu'un enregistrement existe pour aujourd'hui, en lui
  // attribuant les cibles courantes du profil au moment de sa création.
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
    entry.id = Date.now() + "-" + Math.floor(Math.random() * 1000);
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

  // Migration ponctuelle depuis l'ancienne version qui ne gardait que le
  // jour courant (nl_log_v1), pour ne pas perdre les données déjà saisies.
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
     Statut d'une journée (couleur) — réutilisé par la liste,
     le calendrier et le calcul de régularité.
     Réussite = calories dans [90%,110%] ET protéines >= 90%.
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
     Réutilisé par le Suivi, le détail d'une journée passée et
     les bilans hebdo/mensuels (ces derniers en version réduite).
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

    // Si un enregistrement existe déjà pour aujourd'hui mais sans aucun
    // aliment saisi, on rafraîchit ses cibles pour refléter le nouveau
    // calcul (évite de figer un objectif obsolète sur une journée vide).
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

    var record = ensureTodayRecord();
    addFoodToDay(record.date, entry);
    refreshTracker();

    document.getElementById("foodForm").reset();
    $("foodKcal").focus();
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
    mode: "list",          // "list" | "calendar"
    calendarCursor: new Date(), // mois affiché dans le calendrier
    currentDetailKey: null // date actuellement ouverte en détail, ou null
  };

  function refreshHistory() {
    var history = loadHistory();
    var keys = Object.keys(history);

    $("historyEmpty").hidden = keys.length > 0;
    $("historyBrowse").hidden = keys.length === 0;

    if ($("historyDetail").hidden === false) {
      // on reste sur le détail si on y était déjà (ex: après suppression d'un aliment)
      renderHistoryDetail(historyState.currentDetailKey);
      return;
    }

    if (keys.length === 0) return;

    renderHistoryList(history);
    renderHistoryCalendar(history);
  }

  function renderHistoryList(history) {
    var keys = Object.keys(history);
    keys.sort(); // ascendant
    keys.reverse(); // le plus récent d'abord

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
    // Lundi = premier jour de la semaine : getDay() renvoie 0 pour dimanche
    var firstWeekday = (firstOfMonth.getDay() + 6) % 7; // 0 = lundi
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

  function handleDetailFoodSubmit(e) {
    e.preventDefault();
    var dateKey = historyState.currentDetailKey;
    if (!dateKey) return;

    var entry = {
      name: $("detailFoodName").value.trim(),
      kcal: parseFloat($("detailFoodKcal").value) || 0,
      protein: parseFloat($("detailFoodProtein").value) || 0,
      fat: parseFloat($("detailFoodFat").value) || 0,
      carbs: parseFloat($("detailFoodCarbs").value) || 0
    };
    if (!entry.name) return;

    addFoodToDay(dateKey, entry);
    renderHistoryDetail(dateKey);

    document.getElementById("detailFoodForm").reset();
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
     Navigation par onglets
     --------------------------------------------------------- */

  function switchTab(tabName) {
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      var isActive = tabs[i].getAttribute("data-tab") === tabName;
      tabs[i].classList.toggle("active", isActive);
      tabs[i].setAttribute("aria-selected", isActive ? "true" : "false");
    }

    var panels = { calc: "panel-calc", track: "panel-track", history: "panel-history", stats: "panel-stats" };
    for (var key in panels) {
      if (!panels.hasOwnProperty(key)) continue;
      var panelEl = $(panels[key]);
      var isTarget = key === tabName;
      panelEl.hidden = !isTarget;
      panelEl.classList.toggle("active", isTarget);
    }

    if (tabName === "track") refreshTracker();
    if (tabName === "history") {
      // en revenant sur l'onglet on repart toujours de la vue liste/calendrier
      $("historyDetail").hidden = true;
      historyState.currentDetailKey = null;
      refreshHistory();
    }
    if (tabName === "stats") refreshStats();
  }

  /* ---------------------------------------------------------
     Initialisation
     --------------------------------------------------------- */

  function init() {
    migrateLegacyLog();

    $("calcForm").addEventListener("submit", handleCalcSubmit);
    $("foodForm").addEventListener("submit", handleFoodSubmit);
    $("resetDay").addEventListener("click", handleResetDay);
    $("validateDay").addEventListener("click", handleValidateDay);

    $("detailFoodForm").addEventListener("submit", handleDetailFoodSubmit);
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

    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function (ev) {
        switchTab(ev.currentTarget.getAttribute("data-tab"));
      });
    }

    $("goToTracker").addEventListener("click", function () { switchTab("track"); });
    $("goToCalcFromTrack").addEventListener("click", function () { switchTab("calc"); });

    loadExistingProfile();

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
