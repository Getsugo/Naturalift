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
  var STORAGE_LAST_BACKUP = "nl_last_backup_v1"; // date du dernier export
  var STORAGE_LOG_LEGACY = "nl_log_v1";    // ancienne version (migration)
  var MAX_HISTORY_DAYS = 400;              // ~13 mois, borne la taille du localStorage
  var MAX_SUGGESTIONS = 8;
  // API v2 + liste de champs : réponse quelques Ko au lieu de ~100 Ko.
  var OFF_API_BASE = "https://world.openfoodfacts.org/api/v2/product/";
  var OFF_FIELDS = "product_name,product_name_fr,generic_name,generic_name_fr,brands,nutriments,serving_quantity";

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

  // Niveau d'activité = métier (hors sport) + séances de sport.
  // Facteurs du métier inspirés des niveaux d'activité physique (PAL) de la FAO/OMS ;
  // une séance de musculation d'environ 1 h ≈ 250-300 kcal, soit ≈ +0,025 par séance hebdomadaire.
  var JOB_FACTORS = { none: 1.25, assis: 1.35, debout: 1.5, actif: 1.6, physique: 1.8 };
  var JOB_LABELS = {
    none: "Sans emploi / études",
    assis: "Travail assis",
    debout: "Travail debout",
    actif: "Travail debout en marchant",
    physique: "Travail physique"
  };
  var SESSION_FACTOR = 0.025;
  var ACTIVITY_MIN = 1.2;
  var ACTIVITY_MAX = 2.2;

  function activityFromJob(job, sessions) {
    var base = JOB_FACTORS.hasOwnProperty(job) ? JOB_FACTORS[job] : JOB_FACTORS.debout;
    var n = Math.max(0, Math.min(7, sessions || 0));
    var value = base + n * SESSION_FACTOR;
    return Math.round(Math.max(ACTIVITY_MIN, Math.min(ACTIVITY_MAX, value)) * 1000) / 1000;
  }

  // Ancien profil (sélecteur unique) : on devine le métier le plus proche.
  function guessJobFromActivity(activity) {
    if (activity >= 1.85) return { job: "physique", sessions: 3 };
    if (activity >= 1.7) return { job: "actif", sessions: 4 };
    if (activity >= 1.5) return { job: "debout", sessions: 3 };
    if (activity >= 1.35) return { job: "assis", sessions: 2 };
    return { job: "assis", sessions: 0 };
  }

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

  // Portions usuelles des aliments de départ (« 2 œufs » plutôt que 100 g).
  var DEFAULT_PORTIONS = {
    "d-oeuf": { label: "œuf", grams: 50 },
    "d-banane": { label: "banane", grams: 120 },
    "d-paincomplet": { label: "tranche", grams: 35 },
    "d-yaourtgrec": { label: "pot", grams: 150 },
    "d-whey": { label: "dose", grams: 30 },
    "d-huileolive": { label: "c. à soupe", grams: 10 },
    "d-beurrecacahuete": { label: "c. à soupe", grams: 15 },
    "d-amandes": { label: "poignée", grams: 30 },
    "d-fromageblanc": { label: "pot", grams: 100 },
    "d-thon": { label: "boîte égouttée", grams: 112 }
  };
  var STORAGE_PORTIONS_SEEDED = "nl_portions_seeded_v1";

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
    var raw = null;
    try { raw = localStorage.getItem(key); } catch (e) { return null; }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e2) { return null; }
  }

  // Toutes les écritures passent par ici : si le stockage est plein
  // (souvent à cause des photos), on prévient au lieu de perdre la
  // donnée en silence. Retourne true si l'écriture a réussi.
  var lastStorageAlert = 0;
  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      var now = Date.now();
      if (now - lastStorageAlert > 3000) {
        lastStorageAlert = now;
        uiAlert("Stockage de l'appareil plein : la dernière modification n'a PAS été enregistrée.\n\nExporte une sauvegarde (Aliments › Sauvegarde), puis supprime des photos de repas ou d'anciennes journées.");
      }
      return false;
    }
  }

  // Recherche tolérante : ignore majuscules, accents et ligatures,
  // pour que "oeuf" trouve "Œuf" et "pates" trouve "Pâtes".
  function normalizeText(str) {
    var s = String(str || "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae");
    if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return s.replace(/\s+/g, " ").trim();
  }

  // Vrai si chaque mot de la recherche apparaît dans le nom, dans
  // n'importe quel ordre : "poulet blanc" trouve "Blanc de poulet".
  function matchesQuery(name, query) {
    var n = normalizeText(name);
    var words = normalizeText(query).split(" ");
    for (var i = 0; i < words.length; i++) {
      if (words[i] && n.indexOf(words[i]) === -1) return false;
    }
    return true;
  }

  // Échappe aussi les guillemets : indispensable quand le texte va dans
  // un attribut (aria-label="…"), sinon un nom de produit contenant "
  // (Open Food Facts est une base communautaire) casserait la page.
  function escapeHtml(str) {
    return String(str === undefined || str === null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Une photo de repas n'est acceptée que si c'est une vraie image
  // encodée (data:image/…;base64). Tout le reste est ignoré.
  var SAFE_PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;
  function safePhoto(src) {
    return (typeof src === "string" && src.length < 400000 && SAFE_PHOTO_RE.test(src)) ? src : null;
  }

  function genId(prefix) {
    return prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  }

  // Lit un nombre saisi au clavier français : "78,4" comme "78.4".
  // Renvoie NaN si le champ est vide ou invalide.
  function parseNum(value) {
    var s = String(value === undefined || value === null ? "" : value).replace(/\s/g, "").replace(",", ".");
    if (s === "" || !/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return NaN;
    return parseFloat(s);
  }

  // Affiche un nombre à la française (virgule décimale).
  function fmtNum(n) { return String(n).replace(".", ","); }

  /* ---------------------------------------------------------
     Interface : dialogue (remplace alert / confirm / prompt,
     qui sont laids et cassent l'effet "appli" une fois installée)
     et toast avec bouton Annuler.
     --------------------------------------------------------- */

  var dialogState = { onOk: null, onCancel: null };

  function openDialog(opts) {
    dialogState.onOk = opts.onOk || null;
    dialogState.onCancel = opts.onCancel || null;
    $("uiDialogMsg").textContent = opts.message;
    var input = $("uiDialogInput");
    input.hidden = !opts.input;
    input.value = opts.input && opts.input.value ? opts.input.value : "";
    input.placeholder = opts.input && opts.input.placeholder ? opts.input.placeholder : "";
    var ok = $("uiDialogOk");
    ok.textContent = opts.okLabel || "OK";
    ok.className = opts.danger ? "btn-primary btn-danger" : "btn-primary";
    $("uiDialogCancel").hidden = opts.cancelLabel === null;
    $("uiDialogCancel").textContent = opts.cancelLabel || "Annuler";
    $("uiDialogBox").classList.toggle("single-action", opts.cancelLabel === null);
    $("uiDialog").hidden = false;
    window.setTimeout(function () { (opts.input ? input : ok).focus(); }, 30);
  }

  function closeDialog() { $("uiDialog").hidden = true; }

  function setupDialog() {
    $("uiDialogBox").addEventListener("submit", function (e) {
      e.preventDefault();
      var cb = dialogState.onOk;
      var value = $("uiDialogInput").value;
      closeDialog();
      if (cb) cb(value);
    });
    $("uiDialogCancel").addEventListener("click", function () {
      var cb = dialogState.onCancel;
      closeDialog();
      if (cb) cb();
    });
    $("uiDialog").addEventListener("click", function (e) {
      if (e.target === $("uiDialog")) $("uiDialogCancel").click();
    });
  }

  function uiAlert(message, onOk) {
    openDialog({ message: message, okLabel: "OK", cancelLabel: null, onOk: onOk });
  }

  function uiConfirm(message, okLabel, onOk, danger) {
    openDialog({ message: message, okLabel: okLabel, onOk: onOk, danger: danger });
  }

  function uiPrompt(message, placeholder, onOk) {
    openDialog({
      message: message,
      okLabel: "Enregistrer",
      input: { placeholder: placeholder },
      onOk: function (value) { if (value && value.trim()) onOk(value.trim()); }
    });
  }

  var toastState = { timer: null, undo: null };

  function hideToast() {
    $("uiToast").hidden = true;
    toastState.undo = null;
    if (toastState.timer) { window.clearTimeout(toastState.timer); toastState.timer = null; }
  }

  function showToast(message, undoFn) {
    hideToast();
    $("uiToastMsg").textContent = message;
    $("uiToastUndo").hidden = !undoFn;
    toastState.undo = undoFn || null;
    $("uiToast").hidden = false;
    toastState.timer = window.setTimeout(hideToast, undoFn ? 6000 : 2500);
  }

  function setupToast() {
    $("uiToastUndo").addEventListener("click", function () {
      var fn = toastState.undo;
      hideToast();
      if (fn) fn();
    });
  }

  // Exécute une action destructrice SANS demander confirmation, mais
  // garde une copie des clés de stockage concernées pour pouvoir tout
  // remettre en un tap ("Annuler" dans le toast). Plus rapide qu'une
  // confirmation, et plus sûr : une erreur se rattrape.
  function withUndo(keys, message, action, refresh) {
    var snapshot = {};
    for (var i = 0; i < keys.length; i++) {
      try { snapshot[keys[i]] = localStorage.getItem(keys[i]); } catch (e) { snapshot[keys[i]] = null; }
    }
    action();
    refresh();
    showToast(message, function () {
      for (var j = 0; j < keys.length; j++) {
        try {
          if (snapshot[keys[j]] === null) localStorage.removeItem(keys[j]);
          else localStorage.setItem(keys[j], snapshot[keys[j]]);
        } catch (e) { /* noop */ }
      }
      refresh();
    });
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

    // Dépense : la formule par défaut, ou la dépense réelle mesurée à
    // partir du journal et des pesées si l'utilisateur l'a adoptée.
    var tdeeFormula = bmr * activity;
    var tdee = profile.tdeeOverride ? profile.tdeeOverride : tdeeFormula;
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
      tdeeFormula: round(tdeeFormula),
      tdeeSource: profile.tdeeOverride ? "real" : "formula",
      kcalAdjustPct: round(config.kcalAdjust[sex] * 100),
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
      foods = DEFAULT_FOODS.map(function (f) {
        var copy = { id: f.id, name: f.name, kcal: f.kcal, protein: f.protein, fat: f.fat, carbs: f.carbs };
        if (DEFAULT_PORTIONS[f.id]) copy.portion = DEFAULT_PORTIONS[f.id];
        return copy;
      });
      writeJSON(STORAGE_FOODS, foods);
      writeJSON(STORAGE_PORTIONS_SEEDED, true);
    }
    return foods;
  }

  // Une seule fois : ajoute les portions par défaut aux aliments de
  // départ d'une base déjà existante (sans toucher à ce que tu as modifié).
  function seedDefaultPortions() {
    if (readJSON(STORAGE_PORTIONS_SEEDED)) return;
    var foods = loadFoods();
    for (var i = 0; i < foods.length; i++) {
      if (DEFAULT_PORTIONS[foods[i].id] && foods[i].portion === undefined) foods[i].portion = DEFAULT_PORTIONS[foods[i].id];
    }
    saveFoods(foods);
    writeJSON(STORAGE_PORTIONS_SEEDED, true);
  }

  function saveFoods(foods) {
    writeJSON(STORAGE_FOODS, foods);
  }

  function findFoodByName(foods, name) {
    var wanted = normalizeText(name);
    if (!wanted) return null;
    for (var i = 0; i < foods.length; i++) {
      if (normalizeText(foods[i].name) === wanted) return foods[i];
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
    var q = normalizeText(query);
    if (!q) return [];
    var usage = loadUsage();
    var foods = loadFoods().slice();
    foods.sort(function (a, b) {
      // les noms qui commencent par la recherche d'abord, puis les plus utilisés
      var pa = normalizeText(a.name).indexOf(q) === 0 ? 1 : 0;
      var pb = normalizeText(b.name).indexOf(q) === 0 ? 1 : 0;
      if (pb !== pa) return pb - pa;
      var ua = usage[a.id] || 0, ub = usage[b.id] || 0;
      if (ub !== ua) return ub - ua;
      return a.name.localeCompare(b.name, "fr");
    });
    var matches = [];
    for (var i = 0; i < foods.length && matches.length < limit; i++) {
      if (matchesQuery(foods[i].name, q)) matches.push(foods[i]);
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
    if (data.portion) food.portion = data.portion;
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
    if (data.portion !== undefined) {
      if (data.portion) food.portion = data.portion;
      else delete food.portion;
    }
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
      var display = value === null ? "—" : (value > 0 ? "+" : "") + fmtNum(value) + " kg";
      var cls = "ws-value";
      if (value !== null) cls += value < -0.05 ? " ws-down" : (value > 0.05 ? " ws-up" : " ws-flat");
      return '<div class="weight-stat-cell"><span class="ws-label">' + label + '</span><span class="' + cls + '">' + display + '</span></div>';
    }
    var html =
      '<div class="weight-stat-cell"><span class="ws-label">Actuel</span><span class="ws-value">' + fmtNum(stats.current) + ' kg</span></div>' +
      cell("7 jours", stats.change7) +
      cell("30 jours", stats.change30);
    $("weightStatsGrid").innerHTML = html;
  }

  function buildWeightChartSvg(entries) {
    if (entries.length < 2) {
      return '<p class="weight-chart-empty">Ajoute au moins deux pesées pour voir apparaître un graphique.</p>';
    }

    var W = 320, H = 165, padL = 34, padR = 12, padT = 10, padB = 24;
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

    // Dates sous le graphique : première, milieu, dernière pesée.
    var xLabels = "";
    var labelIdx = [0, Math.floor((entries.length - 1) / 2), entries.length - 1];
    var usedIdx = {};
    for (var li = 0; li < labelIdx.length; li++) {
      var idx = labelIdx[li];
      if (usedIdx[idx]) continue;
      usedIdx[idx] = true;
      var anchor = li === 0 ? "start" : (li === labelIdx.length - 1 ? "end" : "middle");
      xLabels += '<text x="' + rawPts[idx].x.toFixed(1) + '" y="' + (H - 6) + '" font-size="8" fill="#8a93a3" text-anchor="' + anchor + '" font-family="ui-monospace,monospace">' + formatDateShort(entries[idx].date) + '</text>';
    }

    var dots = "";
    for (var d = 0; d < rawPts.length; d++) {
      dots += '<circle cx="' + rawPts[d].x.toFixed(1) + '" cy="' + rawPts[d].y.toFixed(1) + '" r="2.2" fill="#8a93a3" />';
    }

    return (
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Courbe de poids">' +
        gridLines + xLabels +
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

  // Moyenne des pesées des 7 derniers jours : plus fiable qu'une pesée
  // isolée pour décider de recalculer les cibles.
  function recentAverageWeight(sorted) {
    var cutoff = addDays(new Date(), -7).getTime();
    var recent = sorted.filter(function (e) { return parseDateKey(e.date).getTime() >= cutoff; });
    if (recent.length === 0) return null;
    var sum = recent.reduce(function (acc, e) { return acc + e.weight; }, 0);
    return round1(sum / recent.length);
  }

  var PROFILE_WEIGHT_SYNC_THRESHOLD = 1; // kg d'écart avant de proposer la mise à jour

  function refreshProfileWeightSync(weights, profile) {
    var card = $("profileWeightSync");
    var avg = recentAverageWeight(weights);
    if (!profile || avg === null || Math.abs(avg - profile.weight) < PROFILE_WEIGHT_SYNC_THRESHOLD) {
      card.hidden = true;
      return;
    }
    card.setAttribute("data-weight", avg);
    $("profileWeightSyncText").textContent =
      "Tes cibles sont calculées pour " + String(profile.weight).replace(".", ",") + " kg, " +
      "mais ta moyenne des 7 derniers jours est de " + String(avg).replace(".", ",") + " kg. " +
      "Protéines, lipides et calories dépendent de ton poids : mets-les à jour pour rester juste.";
    card.hidden = false;
  }

  function handleProfileWeightSync() {
    var profile = readJSON(STORAGE_PROFILE);
    var avg = parseFloat($("profileWeightSync").getAttribute("data-weight"));
    if (!profile || !avg) return;
    profile.weight = avg;
    applyProfile(profile);
    refreshWeightPanel();
    showToast("Cibles mises à jour pour " + fmtNum(avg) + " kg");
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
          '<span class="wr-value">' + fmtNum(w.weight) + ' kg</span>' +
          '<button type="button" class="wr-del" data-date="' + escapeHtml(w.date) + '" aria-label="Supprimer">×</button>' +
        '</li>';
    }
    $("weightList").innerHTML = html;

    var delButtons = $("weightList").querySelectorAll(".wr-del");
    for (var j = 0; j < delButtons.length; j++) {
      delButtons[j].addEventListener("click", function (ev) {
        var date = ev.currentTarget.getAttribute("data-date");
        withUndo([STORAGE_WEIGHTS], "Pesée supprimée", function () { deleteWeight(date); }, refreshWeightPanel);
      });
    }
  }

  function refreshWeightPanel() {
    refreshNativeSummary();
    var weights = loadWeights();
    var dateInput = $("weightDate");
    dateInput.max = todayKey();
    if (!dateInput.value || dateInput.value > todayKey()) dateInput.value = todayKey();
    syncWeightFormToDate();
    $("weightError").hidden = true;

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
    refreshProfileWeightSync(weights, profile);
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

  // Pré-remplit le poids si une pesée existe déjà à la date choisie
  // (on peut ainsi corriger ou rattraper un oubli de la veille).
  function syncWeightFormToDate() {
    var date = $("weightDate").value || todayKey();
    var existing = null;
    var weights = loadWeights();
    for (var i = 0; i < weights.length; i++) {
      if (weights[i].date === date) { existing = weights[i]; break; }
    }
    $("weightInput").value = existing ? fmtNum(existing.weight) : "";
    $("weightSubmitBtn").textContent = existing ? "Mettre à jour" : "Enregistrer";
  }

  function handleWeightSubmit(e) {
    e.preventDefault();
    var val = parseNum($("weightInput").value);
    var date = $("weightDate").value || todayKey();
    var err = $("weightError");
    if (isNaN(val) || val < 30 || val > 300) {
      err.textContent = "Poids invalide : entre un nombre entre 30 et 300 kg (ex : 78,4).";
      err.hidden = false;
      return;
    }
    if (date > todayKey()) {
      err.textContent = "Impossible d'enregistrer une pesée dans le futur.";
      err.hidden = false;
      return;
    }
    err.hidden = true;
    upsertWeight(date, round1(val));
    $("weightInput").blur();
    refreshWeightPanel();
    showToast("Pesée enregistrée : " + fmtNum(round1(val)) + " kg");
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
    $("measWaist").value = latestByField.waist !== undefined ? fmtNum(latestByField.waist) : "";
    $("measChest").value = latestByField.chest !== undefined ? fmtNum(latestByField.chest) : "";
    $("measHips").value = latestByField.hips !== undefined ? fmtNum(latestByField.hips) : "";
    $("measArm").value = latestByField.arm !== undefined ? fmtNum(latestByField.arm) : "";
    $("measThigh").value = latestByField.thigh !== undefined ? fmtNum(latestByField.thigh) : "";

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
      trendHtml += '<span class="mt-chip">' + MEASUREMENT_META[mkey] + ' : ' + (delta > 0 ? "+" : "") + fmtNum(delta) + ' cm /30j</span>';
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
        if (e[pkey] !== undefined) parts.push(MEASUREMENT_META[pkey] + " " + fmtNum(e[pkey]));
      }
      if (parts.length === 0) continue;
      var label = e.date === today ? "Aujourd'hui" : formatDateShort(e.date);
      html += '<li class="weight-row measurement-row"><span class="wr-date">' + label + '</span><span class="wr-value">' + parts.join(" · ") + '</span>' +
        '<button type="button" class="wr-del" data-date="' + escapeHtml(e.date) + '" aria-label="Supprimer ces mensurations">×</button></li>';
    }
    $("measurementsList").innerHTML = html;

    var delButtons = $("measurementsList").querySelectorAll(".wr-del");
    for (var d = 0; d < delButtons.length; d++) {
      delButtons[d].addEventListener("click", function (ev) {
        var date = ev.currentTarget.getAttribute("data-date");
        withUndo([STORAGE_MEASUREMENTS], "Mensurations supprimées", function () {
          saveMeasurements(loadMeasurements().filter(function (m) { return m.date !== date; }));
        }, refreshMeasurements);
      });
    }
  }

  function handleMeasurementsSubmit(e) {
    e.preventDefault();
    var data = {
      waist: parseNum($("measWaist").value),
      chest: parseNum($("measChest").value),
      hips: parseNum($("measHips").value),
      arm: parseNum($("measArm").value),
      thigh: parseNum($("measThigh").value)
    };
    var hasAny = false;
    for (var k = 0; k < MEASUREMENT_FIELDS.length; k++) {
      if (!isNaN(data[MEASUREMENT_FIELDS[k]])) hasAny = true;
    }
    if (!hasAny) return;
    upsertMeasurement(todayKey(), data);
    refreshMeasurements();
    showToast("Mensurations enregistrées");
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
      items.push(copyEntryFields(e));
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
        '<li><button type="button" class="favorite-row" data-id="' + escapeHtml(f.id) + '">' +
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

        var record = ensureDayRecord(currentDayKey());
        if (!record) return;
        withUndo([STORAGE_HISTORY], "« " + fav.name + " » ajouté", function () {
          for (var m = 0; m < fav.items.length; m++) {
            var item = fav.items[m];
            addFoodToDay(record.date, copyEntryFields(item));
          }
        }, refreshTracker);
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
            '<button type="button" class="icon-btn icon-danger" data-fav-delete="' + escapeHtml(f.id) + '" aria-label="Supprimer">×</button>' +
          '</div>' +
        '</li>';
    }
    $("favoritesManageList").innerHTML = html;

    var delBtns = $("favoritesManageList").querySelectorAll("[data-fav-delete]");
    for (var j = 0; j < delBtns.length; j++) {
      delBtns[j].addEventListener("click", function (ev) {
        var id = ev.currentTarget.getAttribute("data-fav-delete");
        withUndo([STORAGE_FAVORITES], "Repas favori supprimé", function () { deleteFavorite(id); }, function () {
          refreshFavoritesManage();
          renderFavoritesQuickAdd();
        });
      });
    }
  }

  function handleSaveAsFavorite() {
    var record = getDayRecord(currentDayKey());
    if (!record || record.entries.length === 0) return;
    uiPrompt("Nom de ce repas favori :", "Ex : Petit-déj type", function (name) {
      createFavoriteFromEntries(name, record.entries);
      renderFavoritesQuickAdd();
      showToast("Repas favori « " + name + " » enregistré");
    });
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
      html += '<button type="button" class="frequent-chip" data-id="' + escapeHtml(top[i].id) + '">' + escapeHtml(top[i].name) + '</button>';
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

  /* ---------------------------------------------------------
     Sommeil : heure de coucher = réveil − sommeil voulu − endormissement.
     Dans l'appli Android, le réveil est lu dans l'Horloge du téléphone
     et une vraie notification prévient avant l'heure du coucher.
     Dans le navigateur, on saisit l'heure de réveil à la main.
     --------------------------------------------------------- */

  var STORAGE_SLEEP = "nl_sleep_v1";
  var SLEEP_DEFAULTS = { sleepMin: 450, latencyMin: 15, advanceMin: 30, wake: "07:00" };

  function nativeApp() {
    try {
      return !!(window.NaturaLiftNative && window.NaturaLiftNative.isApp());
    } catch (e) {
      return false;
    }
  }

  function loadSleepSettings() {
    var s = readJSON(STORAGE_SLEEP) || {};
    var out = {
      sleepMin: typeof s.sleepMin === "number" ? s.sleepMin : SLEEP_DEFAULTS.sleepMin,
      latencyMin: typeof s.latencyMin === "number" ? s.latencyMin : SLEEP_DEFAULTS.latencyMin,
      advanceMin: typeof s.advanceMin === "number" ? s.advanceMin : SLEEP_DEFAULTS.advanceMin,
      wake: /^\d\d:\d\d$/.test(s.wake || "") ? s.wake : SLEEP_DEFAULTS.wake,
      enabled: false,
      notificationsAllowed: false
    };
    if (nativeApp()) {
      try {
        var n = JSON.parse(window.NaturaLiftNative.getSleepSettings());
        out.sleepMin = n.sleepMin;
        out.latencyMin = n.latencyMin;
        out.advanceMin = n.advanceMin;
        out.enabled = !!n.enabled;
        out.notificationsAllowed = !!n.notificationsAllowed;
      } catch (e) { /* on garde les valeurs locales */ }
    }
    return out;
  }

  function saveSleepSettings(s) {
    writeJSON(STORAGE_SLEEP, { sleepMin: s.sleepMin, latencyMin: s.latencyMin, advanceMin: s.advanceMin, wake: s.wake });
    if (nativeApp()) {
      window.NaturaLiftNative.setSleepSettings(JSON.stringify({
        enabled: s.enabled, sleepMin: s.sleepMin, latencyMin: s.latencyMin, advanceMin: s.advanceMin
      }));
    }
  }

  function hhmm(d) { return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }

  function durationLabel(min) {
    var h = Math.floor(min / 60);
    var m = min % 60;
    return h + " h" + (m ? " " + pad2(m) : "");
  }

  function dayWord(d) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var that = new Date(d.getTime());
    that.setHours(0, 0, 0, 0);
    var diff = Math.round((that.getTime() - today.getTime()) / 86400000);
    if (diff === 0) return "aujourd'hui";
    if (diff === 1) return "demain";
    return that.toLocaleDateString("fr-FR", { weekday: "long" });
  }

  // Prochain réveil : celui du téléphone (appli) ou l'heure saisie (navigateur),
  // placée au prochain passage de cette heure.
  function nextWakeDate(s) {
    if (nativeApp()) {
      var ms = window.NaturaLiftNative.getNextAlarm();
      return ms > 0 ? new Date(ms) : null;
    }
    var parts = s.wake.split(":");
    var d = new Date();
    d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d;
  }

  function renderSleep() {
    if (!$("sleepCard")) return;
    var app = nativeApp();
    var s = loadSleepSettings();

    $("sleepDuration").value = String(s.sleepMin);
    $("sleepLatency").value = String(s.latencyMin);
    $("sleepAdvance").value = String(s.advanceMin);
    $("sleepWakeInput").value = s.wake;
    $("sleepWakeField").hidden = app;
    $("sleepAdvanceField").hidden = !app;
    $("sleepAppActions").hidden = !app;

    var night = $("sleepNight");
    var todayRec = getDayRecord(todayKey());
    var history = loadHistory();
    var sum = 0, n = 0;
    for (var i = 0; i < 7; i++) {
      var hk = dateKeyFromDate(addDays(new Date(), -i));
      if (history[hk] && history[hk].sleepMin) { sum += history[hk].sleepMin; n++; }
    }
    if (todayRec && todayRec.sleepMin) {
      var short = todayRec.sleepMin < s.sleepMin - 30;
      night.textContent = "Cette nuit : " + durationLabel(todayRec.sleepMin) + " (Samsung Health)" +
        (n >= 3 ? " · moyenne 7 jours : " + durationLabel(round(sum / n)) : "") +
        (short ? ". En dessous de ton objectif : ce soir, vise l'heure de coucher ci-dessus." : ".");
      night.className = short ? "sleep-note sleep-note-warn" : "sleep-note";
      night.hidden = false;
    } else {
      night.hidden = true;
    }

    var note = $("sleepNote");
    note.className = "sleep-note";
    var status = $("sleepStatus");
    var wake = nextWakeDate(s);

    if (!wake) {
      $("sleepWake").textContent = "—";
      $("sleepBedtime").textContent = "—";
      note.textContent = "Aucun réveil programmé dans l'Horloge du téléphone. Règle ton réveil, puis reviens ici.";
    } else {
      var bed = new Date(wake.getTime() - (s.sleepMin + s.latencyMin) * 60000);
      $("sleepWake").textContent = hhmm(wake);
      $("sleepBedtime").textContent = hhmm(bed);
      var text = "Réveil " + dayWord(wake) + " à " + hhmm(wake) +
        (app ? " (lu dans ton Horloge)" : "") + ". Pour dormir " + durationLabel(s.sleepMin) +
        " avec " + s.latencyMin + " min pour t'endormir, sois au lit à " + hhmm(bed) + ".";
      if (bed.getTime() <= Date.now()) {
        text += " C'est déjà l'heure : file au lit !";
        note.className = "sleep-note sleep-note-warn";
      } else if (app && s.enabled && s.notificationsAllowed) {
        var remind = new Date(bed.getTime() - s.advanceMin * 60000);
        text += " Notification vers " + hhmm(remind) + ".";
      }
      note.textContent = text;
    }

    if (!app) {
      status.textContent = "Calcul manuel";
      status.className = "chip chip-muted";
      if (wake) note.textContent += " Dans l'appli Android, ton réveil est lu tout seul et tu reçois une notification.";
      return;
    }

    var toggle = $("sleepToggle");
    if (s.enabled && !s.notificationsAllowed) {
      status.textContent = "Notifications bloquées";
      status.className = "chip";
      toggle.textContent = "Autoriser les notifications";
    } else if (s.enabled) {
      status.textContent = "Rappel activé";
      status.className = "chip";
      toggle.textContent = "Désactiver le rappel";
    } else {
      status.textContent = "Rappel désactivé";
      status.className = "chip chip-muted";
      toggle.textContent = "Activer le rappel";
    }
  }

  function readSleepForm() {
    var s = loadSleepSettings();
    s.sleepMin = parseInt($("sleepDuration").value, 10);
    s.latencyMin = parseInt($("sleepLatency").value, 10);
    s.advanceMin = parseInt($("sleepAdvance").value, 10);
    if (/^\d\d:\d\d$/.test($("sleepWakeInput").value)) s.wake = $("sleepWakeInput").value;
    return s;
  }

  function setupSleep() {
    if (!$("sleepCard")) return;
    var ids = ["sleepDuration", "sleepLatency", "sleepAdvance", "sleepWakeInput"];
    ids.forEach(function (id) {
      $(id).addEventListener("change", function () {
        saveSleepSettings(readSleepForm());
        renderSleep();
      });
    });

    $("sleepToggle").addEventListener("click", function () {
      var s = readSleepForm();
      if (s.enabled && !s.notificationsAllowed) {
        window.NaturaLiftNative.requestNotifications();
        return;
      }
      s.enabled = !s.enabled;
      saveSleepSettings(s);
      if (s.enabled && !s.notificationsAllowed) window.NaturaLiftNative.requestNotifications();
      showToast(s.enabled ? "Rappel de coucher activé" : "Rappel de coucher désactivé");
      renderSleep();
    });

    $("sleepTest").addEventListener("click", function () {
      if (!window.NaturaLiftNative.testNotification()) {
        window.NaturaLiftNative.requestNotifications();
      }
    });

    // L'appli Android prévient quand elle revient au premier plan
    // ou quand une permission change.
    window.addEventListener("naturalift-native", renderSleep);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) renderSleep();
    });
    renderSleep();
  }

  /* ---------------------------------------------------------
     Fonctions de l'appli Android (sans effet dans le navigateur) :
     résumé pour le widget et les rappels, rappels, Samsung Health
     (via Health Connect) et mises à jour.
     --------------------------------------------------------- */

  function nativeCall(fn) {
    if (!nativeApp()) return null;
    try { return fn(window.NaturaLiftNative); } catch (e) { return null; }
  }

  // Le widget et les rappels lisent ce résumé (calories et protéines restantes…).
  function pushNativeSummary(view, totals, targets) {
    if (!nativeApp()) return;
    var weights = loadWeights();
    var weighed = weights.length > 0 && weights[weights.length - 1].date === view.date;
    nativeCall(function (n) {
      n.setDaySummary(JSON.stringify({
        date: view.date,
        kcalTarget: round(targets.kcal),
        protTarget: round(targets.protein),
        kcalEaten: round(totals.kcal),
        protEaten: round(totals.protein),
        creatine: !!view.creatine,
        weighed: weighed
      }));
    });
  }

  // Le résumé dépend aussi des pesées : on le renvoie après chaque changement.
  function refreshNativeSummary() {
    var profile = readJSON(STORAGE_PROFILE);
    if (!profile || !nativeApp()) return;
    var rec = ensureDayRecord(todayKey());
    if (rec) pushNativeSummary(rec, sumEntries(rec.entries), effectiveTargetsFor(rec));
  }

  /* ----- Rappels ----- */

  function renderRemindersBlock() {
    var block = $("remindersBlock");
    if (!nativeApp()) { block.hidden = true; return; }
    var list = nativeCall(function (n) { return JSON.parse(n.getReminders()); }) || [];
    block.hidden = list.length === 0;
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      html +=
        '<div class="reminder-row">' +
          '<label class="checkbox-row reminder-check">' +
            '<input type="checkbox" data-rem-on="' + escapeHtml(r.id) + '"' + (r.enabled ? ' checked' : '') + '>' +
            '<span>' + escapeHtml(r.label) + '</span>' +
          '</label>' +
          '<input type="time" class="reminder-time" data-rem-time="' + escapeHtml(r.id) + '" value="' + pad2(r.hour) + ':' + pad2(r.minute) + '">' +
        '</div>';
    }
    $("remindersList").innerHTML = html;

    function save() {
      var rows = $("remindersList").querySelectorAll("[data-rem-on]");
      var out = [];
      for (var j = 0; j < rows.length; j++) {
        var id = rows[j].getAttribute("data-rem-on");
        var timeEl = $("remindersList").querySelector('[data-rem-time="' + id + '"]');
        var parts = (timeEl.value || "08:00").split(":");
        out.push({ id: id, enabled: rows[j].checked, hour: parseInt(parts[0], 10) || 0, minute: parseInt(parts[1], 10) || 0 });
      }
      nativeCall(function (n) { n.setReminders(JSON.stringify(out)); });
      var anyOn = out.some(function (r) { return r.enabled; });
      var allowed = nativeCall(function (n) { return JSON.parse(n.getSleepSettings()).notificationsAllowed; });
      if (anyOn && !allowed) nativeCall(function (n) { n.requestNotifications(); });
      showToast("Rappels enregistrés");
    }
    var inputs = $("remindersList").querySelectorAll("input");
    for (var k = 0; k < inputs.length; k++) inputs[k].addEventListener("change", save);
  }

  /* ----- Samsung Health (Health Connect) ----- */

  var HEALTH_SYNC_MIN_INTERVAL = 10 * 60 * 1000;
  var healthState = { lastSync: 0, last: null };
  var KCAL_PER_STEP_PER_KG = 0.0004; // ≈ 0,03 kcal par pas pour 80 kg (marche)

  function healthStatus() {
    return nativeCall(function (n) { return n.healthStatus(); }) || "unavailable";
  }

  function renderHealthBlock(profile) {
    var block = $("healthBlock");
    if (!nativeApp()) { block.hidden = true; return; }
    block.hidden = false;
    var status = healthStatus();
    var text = $("healthText");
    var btn = $("healthBtn");
    $("stepsAdjust").checked = profile.stepsAdjust !== false;
    $("stepsAdjustRow").hidden = status !== "ok";
    btn.hidden = status === "ok" || status === "unavailable";

    if (status === "unavailable") {
      text.textContent = "Health Connect n'est pas disponible sur ce téléphone.";
    } else if (status === "update_required") {
      text.textContent = "Health Connect doit être installé ou mis à jour depuis le Play Store.";
      btn.textContent = "Installer Health Connect";
    } else if (status === "no_permission") {
      text.textContent = "Lis ton sommeil, tes pas et tes séances depuis Samsung Health et ton bracelet. Dans Samsung Health, active d'abord : Réglages → Health Connect → autoriser la lecture.";
      btn.textContent = "Connecter Samsung Health";
    } else {
      var d = healthState.last;
      var parts = ["Connecté."];
      if (d && d.sleepMin) parts.push("Cette nuit : " + durationLabel(d.sleepMin) + ".");
      if (d && d.steps && d.steps[todayKey()] !== undefined) parts.push("Aujourd'hui : " + d.steps[todayKey()].toLocaleString("fr-FR") + " pas.");
      if (d && !d.sleepMin && !(d.steps && d.steps[todayKey()])) parts.push("Aucune donnée pour l'instant : vérifie que Samsung Health partage bien avec Health Connect.");
      text.textContent = parts.join(" ");
    }
  }

  function syncHealth(force) {
    if (!nativeApp() || healthStatus() !== "ok") return;
    var now = Date.now();
    if (!force && now - healthState.lastSync < HEALTH_SYNC_MIN_INTERVAL) return;
    healthState.lastSync = now;
    nativeCall(function (n) { n.syncHealth(); });
  }

  function offerHealthSettings(intro) {
    uiConfirm(intro + " Tu peux autoriser NaturaLift à la main : dans Health Connect, ouvre NaturaLift et active Sommeil, Pas et Exercice. Ouvrir Health Connect ?", "Ouvrir", function () {
      var ok = nativeCall(function (n) { return n.openHealthSettings(); });
      if (!ok) uiAlert("Impossible d'ouvrir Health Connect. Va dans Paramètres du téléphone → Health Connect → Autorisations des applis → NaturaLift.");
    });
  }

  window.NaturaLiftHealthError = function (reason) {
    healthState.requested = false;
    offerHealthSettings("La fenêtre d'autorisation n'a pas pu s'ouvrir (" + String(reason).slice(0, 60) + ").");
  };

  // Moyenne des pas des 14 jours précédents (référence « journée habituelle »).
  function stepsBaseline(steps, today) {
    var sum = 0, n = 0;
    for (var i = 1; i <= 14; i++) {
      var k = dateKeyFromDate(addDays(parseDateKey(today), -i));
      if (steps[k] > 500) { sum += steps[k]; n++; }
    }
    return n >= 5 ? sum / n : null;
  }

  // Appelée par l'appli Android quand les données Health Connect arrivent.
  window.NaturaLiftHealth = function (json) {
    var data;
    try { data = typeof json === "string" ? JSON.parse(json) : json; } catch (e) { return; }
    if (!data || !data.ok) return;
    healthState.last = data;
    var profile = readJSON(STORAGE_PROFILE);
    if (!profile) return;
    var today = todayKey();
    if (!ensureDayRecord(today)) return;

    var history = loadHistory();
    var steps = data.steps || {};
    for (var k in steps) {
      if (steps.hasOwnProperty(k) && history[k] && DATE_RE.test(k)) history[k].steps = round(steps[k]);
    }
    var rec = history[today];
    if (data.sleepMin) rec.sleepMin = round(data.sleepMin);

    var base = stepsBaseline(steps, today);
    if (profile.stepsAdjust !== false && base && steps[today] > base) {
      var bonus = (steps[today] - base) * KCAL_PER_STEP_PER_KG * profile.weight;
      rec.stepsBonus = Math.min(600, Math.round(bonus / 10) * 10);
      if (rec.stepsBonus < 50) delete rec.stepsBonus;
    } else {
      delete rec.stepsBonus;
    }

    // Une séance enregistrée aujourd'hui → journée « Entraînement », sauf choix manuel.
    if (data.exerciseToday && !rec.dayTypeManual && rec.dayType !== "training") {
      rec.dayType = "training";
      rec.dayTypeAuto = true;
    }
    saveHistory(history);
    if (activeTab === "track") refreshTracker();
    renderSleep();
    if (!$("settingsOverlay").hidden) renderHealthBlock(profile);
  };

  /* ----- Mises à jour de l'appli Android ----- */

  var UPDATE_CHECK_KEY = "nl_update_check_v1";
  var RELEASES_API = "https://api.github.com/repos/Getsugo/Naturalift/releases/latest";

  function checkForUpdate() {
    if (!nativeApp() || !window.fetch) return;
    var current = nativeCall(function (n) { return n.getVersionCode(); });
    if (!current) return;
    var last = readJSON(UPDATE_CHECK_KEY);
    var now = Date.now();
    if (last && last.at && now - last.at < 6 * 3600 * 1000) {
      showUpdateBanner(last, current);
      return;
    }
    fetch(RELEASES_API, { headers: { "Accept": "application/vnd.github+json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rel) {
        if (!rel || !rel.tag_name) return;
        var version = parseInt(String(rel.tag_name).replace(/\D/g, ""), 10);
        var asset = (rel.assets || []).filter(function (a) { return /\.apk$/i.test(a.name); })[0];
        var info = { at: now, version: version || 0, url: asset ? asset.browser_download_url : null };
        writeJSON(UPDATE_CHECK_KEY, info);
        showUpdateBanner(info, current);
      })
      .catch(function () { /* hors ligne : on réessaiera plus tard */ });
  }

  function showUpdateBanner(info, current) {
    var show = !!(info && info.url && info.version > current &&
      /^https:\/\/github\.com\/Getsugo\/Naturalift\/releases\/download\//.test(info.url));
    $("updateBanner").hidden = !show;
    if (!show) return;
    $("updateText").textContent = "Nouvelle version de NaturaLift disponible (v" + info.version + "). Télécharge-la, puis ouvre le fichier pour l'installer : tes données sont gardées.";
    $("updateBtn").onclick = function () {
      nativeCall(function (n) { n.openUrl(info.url); });
    };
  }

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
    var json = JSON.stringify(payload, null, 2);
    var fileName = "naturalift-sauvegarde-" + todayKey() + ".json";
    // Appli Android : le téléchargement d'un « blob » n'existe pas dans la WebView,
    // on passe par la fonction native qui écrit dans Téléchargements.
    if (nativeApp()) {
      if (window.NaturaLiftNative.saveFile(fileName, "application/json", json)) {
        writeJSON(STORAGE_LAST_BACKUP, todayKey());
        refreshBackupInfo();
        uiAlert("Sauvegarde enregistrée dans Téléchargements : " + fileName);
      } else {
        uiAlert("La sauvegarde n'a pas pu être enregistrée.");
      }
      return;
    }
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    writeJSON(STORAGE_LAST_BACKUP, todayKey());
    refreshBackupInfo();
  }

  // Rappelle depuis quand aucune sauvegarde n'a été faite : le seul
  // vrai risque de perte de données de l'appli.
  function refreshBackupInfo() {
    var el = $("lastBackupInfo");
    var last = readJSON(STORAGE_LAST_BACKUP);
    var hasData = Object.keys(loadHistory()).length > 0;
    if (!last) {
      el.textContent = hasData ? "⚠ Aucune sauvegarde faite pour l'instant." : "";
      el.className = "backup-info" + (hasData ? " backup-warn" : "");
      return;
    }
    var days = Math.round((parseDateKey(todayKey()).getTime() - parseDateKey(last).getTime()) / 86400000);
    var when = days <= 0 ? "aujourd'hui" : (days === 1 ? "hier" : "il y a " + days + " jours");
    el.textContent = (days > 14 ? "⚠ " : "") + "Dernière sauvegarde : " + when + ".";
    el.className = "backup-info" + (days > 14 ? " backup-warn" : "");
  }

  function showBackupStatus(msg, isError) {
    var el = $("backupStatus");
    el.hidden = false;
    el.textContent = msg;
    el.style.borderLeftColor = isError ? "var(--red)" : "var(--lime)";
  }

  /* ---------------------------------------------------------
     Import — chaque donnée est vérifiée et reconstruite champ par
     champ : un fichier abîmé ou trafiqué ne peut ni casser l'appli
     ni injecter du code dans la page. Ce qui est invalide est ignoré.
     --------------------------------------------------------- */

  var ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var BARCODE_RE = /^\d{6,14}$/;

  function cleanNum(v, min, max) {
    var n = typeof v === "number" ? v : parseNum(v);
    if (isNaN(n) || !isFinite(n) || n < min || n > max) return null;
    return n;
  }

  function cleanStr(v, maxLen) {
    if (typeof v !== "string") return null;
    var t = v.replace(/[\u0000-\u001f]/g, " ").trim();
    return t ? t.slice(0, maxLen) : null;
  }

  function cleanMacros(src, max) {
    if (!src || typeof src !== "object") return null;
    var out = {};
    var keys = ["kcal", "protein", "fat", "carbs"];
    for (var i = 0; i < keys.length; i++) {
      var n = cleanNum(src[keys[i]], 0, max);
      out[keys[i]] = n === null ? 0 : n;
    }
    return out;
  }

  function cleanPortion(src) {
    if (!src || typeof src !== "object") return null;
    var label = cleanStr(src.label, 30);
    var grams = cleanNum(src.grams, 0.1, 5000);
    return (label && grams) ? { label: label, grams: grams } : null;
  }

  function cleanEntry(src) {
    if (!src || typeof src !== "object") return null;
    var name = cleanStr(src.name, 120);
    if (!name) return null;
    var m = cleanMacros(src, 100000);
    var e = { id: ID_RE.test(src.id) ? src.id : genId("entry"), name: name, kcal: m.kcal, protein: m.protein, fat: m.fat, carbs: m.carbs };
    var grams = cleanNum(src.grams, 0.1, 100000);
    if (grams) e.grams = grams;
    var per100 = cleanMacros(src.per100, 10000);
    if (per100) e.per100 = per100;
    if (ID_RE.test(src.foodId)) e.foodId = src.foodId;
    if (BARCODE_RE.test(src.barcode)) e.barcode = src.barcode;
    var photo = safePhoto(src.photo);
    if (photo) e.photo = photo;
    var pLabel = cleanStr(src.portionLabel, 30);
    var pQty = cleanNum(src.portionQty, 0.01, 1000);
    var pGrams = cleanNum(src.portionGrams, 0.1, 5000);
    if (pLabel && pQty && pGrams) { e.portionLabel = pLabel; e.portionQty = pQty; e.portionGrams = pGrams; }
    return e;
  }

  function cleanFood(src) {
    if (!src || typeof src !== "object") return null;
    var name = cleanStr(src.name, 120);
    if (!name) return null;
    var m = cleanMacros(src, 10000);
    var f = { id: ID_RE.test(src.id) ? src.id : genId("food"), name: name, kcal: m.kcal, protein: m.protein, fat: m.fat, carbs: m.carbs, barcode: BARCODE_RE.test(src.barcode) ? src.barcode : null };
    var portion = cleanPortion(src.portion);
    if (portion) f.portion = portion;
    return f;
  }

  function cleanList(arr, fn) {
    var out = [];
    if (!(arr instanceof Array)) return out;
    for (var i = 0; i < arr.length; i++) {
      var c = fn(arr[i]);
      if (c) out.push(c);
    }
    return out;
  }

  function sanitizeImport(data) {
    var out = { app: "NaturaLift" };

    var p = data.profile;
    if (p && typeof p === "object" && (p.sex === "H" || p.sex === "F") && OBJECTIVE_CONFIG.hasOwnProperty(p.objective)) {
      var activity = cleanNum(p.activity, ACTIVITY_MIN, ACTIVITY_MAX);
      var profile = {
        sex: p.sex,
        age: cleanNum(p.age, 14, 90),
        weight: cleanNum(p.weight, 30, 250),
        height: cleanNum(p.height, 120, 230),
        activity: activity === null ? 1.55 : activity,
        objective: p.objective
      };
      if (JOB_FACTORS.hasOwnProperty(p.job)) {
        var sess = cleanNum(p.sessions, 0, 7);
        profile.job = p.job;
        profile.sessions = sess === null ? 3 : round(sess);
        profile.activity = activityFromJob(profile.job, profile.sessions);
      }
      var tdee = cleanNum(p.tdeeOverride, 1200, 5500);
      if (tdee) profile.tdeeOverride = round(tdee);
      if (p.ramp && typeof p.ramp === "object" && DATE_RE.test(p.ramp.startDate || "")) {
        var rStart = cleanNum(p.ramp.startKcal, 800, 5000);
        var rStep = cleanNum(p.ramp.stepKcal, 100, 600);
        if (rStart && rStep) profile.ramp = { enabled: !!p.ramp.enabled, startKcal: round(rStart), stepKcal: round(rStep), startDate: p.ramp.startDate };
      }
      if (typeof p.stepsAdjust === "boolean") profile.stepsAdjust = p.stepsAdjust;
      if (profile.age !== null && profile.weight !== null && profile.height !== null) {
        // Les cibles sont recalculées, jamais reprises du fichier.
        profile.targets = computeTargets(profile);
        out.profile = profile;
      }
    }

    if (data.history && typeof data.history === "object") {
      var history = {};
      var fallbackTargets = out.profile ? out.profile.targets : { kcal: 2000, protein: 150, fat: 70, carbs: 200 };
      for (var key in data.history) {
        if (!data.history.hasOwnProperty(key) || !DATE_RE.test(key)) continue;
        var r = data.history[key];
        if (!r || typeof r !== "object") continue;
        var rec = { date: key, entries: cleanList(r.entries, cleanEntry), targets: cleanMacros(r.targets, 100000) || fallbackTargets };
        if (r.dayType === "training" || r.dayType === "rest") rec.dayType = r.dayType;
        var water = cleanNum(r.waterMl, 0, 20000);
        if (water) rec.waterMl = water;
        if (r.creatine === true) rec.creatine = true;
        var steps = cleanNum(r.steps, 0, 200000);
        if (steps !== null) rec.steps = round(steps);
        var sleepMin = cleanNum(r.sleepMin, 0, 1440);
        if (sleepMin !== null) rec.sleepMin = round(sleepMin);
        var bonus = cleanNum(r.stepsBonus, 0, 1000);
        if (bonus) rec.stepsBonus = round(bonus);
        if (r.dayTypeAuto === true) rec.dayTypeAuto = true;
        history[key] = rec;
      }
      out.history = history;
    }

    if (data.foods instanceof Array) out.foods = cleanList(data.foods, cleanFood);

    if (data.weights instanceof Array) {
      out.weights = cleanList(data.weights, function (w) {
        if (!w || !DATE_RE.test(w.date)) return null;
        var kg = cleanNum(w.weight, 20, 400);
        return kg === null ? null : { date: w.date, weight: round1(kg) };
      });
    }

    if (data.measurements instanceof Array) {
      out.measurements = cleanList(data.measurements, function (m) {
        if (!m || !DATE_RE.test(m.date)) return null;
        var row = { date: m.date }, any = false;
        for (var i = 0; i < MEASUREMENT_FIELDS.length; i++) {
          var v = cleanNum(m[MEASUREMENT_FIELDS[i]], 1, 500);
          if (v !== null) { row[MEASUREMENT_FIELDS[i]] = v; any = true; }
        }
        return any ? row : null;
      });
    }

    if (data.favorites instanceof Array) {
      out.favorites = cleanList(data.favorites, function (f) {
        if (!f) return null;
        var name = cleanStr(f.name, 60);
        var items = cleanList(f.items, cleanEntry);
        return (name && items.length) ? { id: ID_RE.test(f.id) ? f.id : genId("fav"), name: name, items: items } : null;
      });
    }

    if (data.usage && typeof data.usage === "object") {
      var usage = {};
      for (var u in data.usage) {
        if (data.usage.hasOwnProperty(u) && ID_RE.test(u)) {
          var c = cleanNum(data.usage[u], 0, 1000000);
          if (c) usage[u] = Math.round(c);
        }
      }
      out.usage = usage;
    }

    return out;
  }

  function importAllData(file) {
    if (file.size > 60 * 1024 * 1024) {
      showBackupStatus("Fichier trop gros pour être une sauvegarde NaturaLift.", true);
      return;
    }
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
      data = sanitizeImport(data);
      if (!data.profile && !data.history) {
        showBackupStatus("Fichier invalide : aucune donnée exploitable dans cette sauvegarde.", true);
        return;
      }
      uiConfirm("Importer cette sauvegarde va remplacer toutes tes données actuelles sur cet appareil (profil, historique, aliments, poids). Continuer ?", "Importer", function () {
        applyImport(data);
      }, true);
    };
    reader.onerror = function () {
      showBackupStatus("Impossible de lire ce fichier.", true);
    };
    reader.readAsText(file);
  }

  function applyImport(data) {
    if (data.profile) writeJSON(STORAGE_PROFILE, data.profile);
    if (data.history) writeJSON(STORAGE_HISTORY, data.history);
    if (data.foods) writeJSON(STORAGE_FOODS, data.foods);
    if (data.weights) writeJSON(STORAGE_WEIGHTS, data.weights);
    if (data.measurements) writeJSON(STORAGE_MEASUREMENTS, data.measurements);
    if (data.favorites) writeJSON(STORAGE_FAVORITES, data.favorites);
    if (data.usage) writeJSON(STORAGE_USAGE, data.usage);

    showBackupStatus("Import réussi. Rechargement de l'application…", false);
    window.setTimeout(function () { window.location.reload(); }, 800);
  }

  /* ---------------------------------------------------------
     Open Food Facts — recherche par code-barres (API v2)
     --------------------------------------------------------- */

  function lookupOpenFoodFacts(barcode, onDone) {
    var url = OFF_API_BASE + encodeURIComponent(barcode) + ".json?fields=" + OFF_FIELDS;

    fetch(url)
      .then(function (response) {
        // 404 = produit inconnu (pas une erreur réseau)
        if (response.status === 404) return { status: 0 };
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

        var name = p.product_name_fr || p.product_name || p.generic_name_fr || p.generic_name || ("Produit " + barcode);
        // La marque aide à distinguer deux produits au nom identique.
        var brand = p.brands ? String(p.brands).split(",")[0].trim() : "";
        if (brand && name.toLowerCase().indexOf(brand.toLowerCase()) === -1) name += " (" + brand + ")";

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
          carbs: round1(nutr["carbohydrates_100g"] || 0),
          // Portion indiquée par le fabricant (ex : 30 g de céréales).
          portion: (function () {
            var q = parseNum(p.serving_quantity);
            return (!isNaN(q) && q > 0 && q < 2000) ? { label: "portion", grams: round1(q) } : null;
          })()
        });
      })
      .catch(function () {
        onDone({ found: false, barcode: barcode, networkError: true });
      });
  }

  /* ---------------------------------------------------------
     Scanner caméra — overlay partagé.
     1) Détecteur natif du navigateur (BarcodeDetector, présent sur
        Chrome Android) : rapide, et fonctionne hors-ligne.
     2) Sinon, bibliothèque html5-qrcode, chargée seulement à ce
        moment-là (inutile de la télécharger à chaque ouverture).
     --------------------------------------------------------- */

  // Hébergée dans le dépôt : aucun site externe, et disponible hors-ligne
  // une fois chargée une première fois.
  var SCANNER_LIB_URL = "./html5-qrcode.min.js";
  var NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

  var scannerState = { active: false, onResult: null, stream: null, timer: null, lib: null };

  function showScannerError(msg) {
    $("scannerHint").hidden = true;
    $("scannerError").hidden = false;
    $("scannerError").textContent = msg;
  }

  function cameraErrorMessage(err) {
    var str = (err && err.name ? err.name + " " : "") + ((err && err.toString) ? err.toString() : String(err));
    if (str.indexOf("NotAllowedError") !== -1 || str.indexOf("Permission") !== -1) {
      return "Accès à la caméra refusé. Autorise la caméra pour ce site dans les paramètres de ton navigateur, puis réessaie.";
    }
    if (str.indexOf("NotFoundError") !== -1) return "Aucune caméra détectée sur cet appareil.";
    if (str.indexOf("NotReadableError") !== -1) return "La caméra est déjà utilisée par une autre application.";
    return "Impossible d'accéder à la caméra.";
  }

  function stopScannerCamera() {
    scannerState.active = false;
    if (scannerState.timer) { window.clearTimeout(scannerState.timer); scannerState.timer = null; }
    if (scannerState.stream) {
      var tracks = scannerState.stream.getTracks();
      for (var i = 0; i < tracks.length; i++) tracks[i].stop();
      scannerState.stream = null;
    }
    if (scannerState.lib) {
      var lib = scannerState.lib;
      scannerState.lib = null;
      lib.stop().then(function () {
        try { lib.clear(); } catch (e) { /* noop */ }
      }).catch(function () { /* déjà arrêté */ });
    }
  }

  function closeScanner() {
    stopScannerCamera();
    $("scannerOverlay").hidden = true;
    $("scannerReader").innerHTML = "";
  }

  function scannerFound(code) {
    if (!scannerState.active) return;
    if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* noop */ } }
    var cb = scannerState.onResult;
    closeScanner();
    if (cb) cb(code);
  }

  function startNativeScanner(formats) {
    var detector;
    try { detector = new window.BarcodeDetector({ formats: formats }); } catch (e) { startLibScanner(); return; }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then(function (stream) {
        if (!scannerState.active) {
          var t = stream.getTracks();
          for (var i = 0; i < t.length; i++) t[i].stop();
          return;
        }
        scannerState.stream = stream;
        var video = document.createElement("video");
        video.setAttribute("playsinline", "");
        video.muted = true;
        video.srcObject = stream;
        var frame = document.createElement("div");
        frame.className = "scanner-frame";
        var reader = $("scannerReader");
        reader.innerHTML = "";
        reader.appendChild(video);
        reader.appendChild(frame);
        var playing = video.play();
        if (playing && playing.catch) playing.catch(function () { /* noop */ });

        function tick() {
          if (!scannerState.active) return;
          if (video.readyState < 2) { scannerState.timer = window.setTimeout(tick, 150); return; }
          detector.detect(video).then(function (codes) {
            if (codes && codes.length > 0 && codes[0].rawValue) scannerFound(codes[0].rawValue);
            else if (scannerState.active) scannerState.timer = window.setTimeout(tick, 150);
          }).catch(function () {
            if (scannerState.active) scannerState.timer = window.setTimeout(tick, 300);
          });
        }
        tick();
      })
      .catch(function (err) { showScannerError(cameraErrorMessage(err)); });
  }

  function loadScannerLib(onReady, onError) {
    if (typeof Html5Qrcode !== "undefined") { onReady(); return; }
    var existing = document.getElementById("scannerLibScript");
    if (existing) existing.parentNode.removeChild(existing);
    var script = document.createElement("script");
    script.id = "scannerLibScript";
    script.src = SCANNER_LIB_URL;
    script.onload = onReady;
    script.onerror = onError;
    document.head.appendChild(script);
  }

  function startLibScanner() {
    $("scannerHint").textContent = "Chargement du scanner…";
    loadScannerLib(function () {
      if (!scannerState.active) return;
      $("scannerHint").textContent = "Cadre le code-barres du produit dans la zone ci-dessus.";
      if (typeof Html5Qrcode === "undefined") {
        showScannerError("Scanner indisponible : la bibliothèque de lecture n'a pas pu être chargée.");
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
      var lib = new Html5Qrcode("scannerReader");
      scannerState.lib = lib;
      lib.start({ facingMode: "environment" }, scanConfig, function (decodedText) {
        scannerFound(decodedText);
      }, function () { /* aucune détection sur cette frame : normal */ })
        .catch(function (err) {
          scannerState.lib = null;
          showScannerError(cameraErrorMessage(err));
        });
    }, function () {
      showScannerError("Scanner indisponible : le module de lecture n'a pas pu être chargé. Vérifie ta connexion internet, ou passe en saisie « Manuel ».");
    });
  }

  function openScanner(onBarcodeFound) {
    scannerState.onResult = onBarcodeFound;
    scannerState.active = true;
    $("scannerOverlay").hidden = false;
    $("scannerHint").hidden = false;
    $("scannerHint").textContent = "Cadre le code-barres du produit dans la zone ci-dessus.";
    $("scannerError").hidden = true;
    $("scannerReader").innerHTML = "";

    if (!window.isSecureContext) {
      showScannerError("Le scanner nécessite une connexion sécurisée (HTTPS). Impossible d'accéder à la caméra ici.");
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showScannerError("Caméra non disponible sur cet appareil ou ce navigateur.");
      return;
    }

    if ("BarcodeDetector" in window && window.BarcodeDetector.getSupportedFormats) {
      window.BarcodeDetector.getSupportedFormats().then(function (supported) {
        var formats = NATIVE_FORMATS.filter(function (f) { return supported.indexOf(f) !== -1; });
        if (formats.length > 0) startNativeScanner(formats);
        else startLibScanner();
      }).catch(startLibScanner);
    } else {
      startLibScanner();
    }
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
    return writeJSON(STORAGE_HISTORY, pruneHistory(history));
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

  /* ---------------------------------------------------------
     Montée progressive : quand on mange beaucoup moins que la cible,
     on y arrive par paliers (ex. +300 kcal par semaine) plutôt que
     d'un coup. Les protéines restent la priorité : elles gardent
     leur cible, les lipides gardent leur minimum, et ce sont les
     glucides qui suivent le palier.
     --------------------------------------------------------- */

  var RAMP_STEPS = [200, 300, 400];

  function daysBetween(fromKey, toKey) {
    return Math.round((parseDateKey(toKey).getTime() - parseDateKey(fromKey).getTime()) / 86400000);
  }

  // Palier du jour, ou null si la montée est finie ou désactivée.
  function rampInfo(profile, dateKey) {
    var r = profile && profile.ramp;
    if (!r || !r.enabled || !profile.targets || !DATE_RE.test(r.startDate || "")) return null;
    var days = Math.max(0, daysBetween(r.startDate, dateKey));
    var week = Math.floor(days / 7);
    var kcal = r.startKcal + r.stepKcal * week;
    var final = profile.targets.kcal;
    if (kcal >= final) return null;
    var weeksLeft = Math.ceil((final - kcal) / r.stepKcal);
    return { kcal: round(kcal), week: week + 1, weeksLeft: weeksLeft, final: final };
  }

  // Cibles d'une journée : celles du profil, ramenées au palier si besoin.
  function targetsForDay(profile, dateKey) {
    var t = profile.targets;
    var info = rampInfo(profile, dateKey);
    if (!info) return t;
    var fatFloor = round(FAT_FLOOR_PER_KG[profile.sex] * profile.weight);
    var fat = Math.min(t.fat, fatFloor);
    var carbs = Math.max(0, round((info.kcal - t.protein * KCAL_PER_G.protein - fat * KCAL_PER_G.fat) / KCAL_PER_G.carbs));
    var kcal = round(t.protein * KCAL_PER_G.protein + fat * KCAL_PER_G.fat + carbs * KCAL_PER_G.carbs);
    return { kcal: kcal, protein: t.protein, fat: fat, carbs: carbs, ramp: info.week };
  }

  // Moyenne des calories des derniers jours notés (pour proposer un palier de départ).
  function recentAverageIntake(nDays) {
    var history = loadHistory();
    var today = todayKey();
    var sum = 0, n = 0;
    for (var i = 1; i <= nDays; i++) {
      var key = dateKeyFromDate(addDays(parseDateKey(today), -i));
      var r = history[key];
      if (r && r.entries.length) { sum += sumEntries(r.entries).kcal; n++; }
    }
    return n >= 3 ? round(sum / n) : null;
  }

  // Crée la journée si besoin, avec les cibles actuelles du profil.
  function ensureDayRecord(dateKey) {
    var profile = readJSON(STORAGE_PROFILE);
    if (!profile) return null;

    var history = loadHistory();
    var record = history[dateKey];
    if (!record) {
      record = { date: dateKey, entries: [], targets: targetsForDay(profile, dateKey) };
      history[dateKey] = record;
      if (!saveHistory(history)) return null;
    }
    return record;
  }

  function addFoodToDay(dateKey, entry) {
    var history = loadHistory();
    var record = history[dateKey];
    if (!record) return null;
    entry.id = genId("entry");
    record.entries.push(entry);
    if (!saveHistory(history)) return null; // stockage plein : rien n'est enregistré
    return record;
  }

  function removeFoodFromDay(dateKey, entryId) {
    var history = loadHistory();
    var record = history[dateKey];
    if (!record) return null;
    record.entries = record.entries.filter(function (e) { return e.id !== entryId; });
    saveHistory(history);
    return record;
  }

  // Valeurs d'une quantité donnée à partir des valeurs pour 100 g.
  function macrosFor(per100, grams) {
    var f = grams / 100;
    return {
      kcal: round(per100.kcal * f),
      protein: round1(per100.protein * f),
      fat: round1(per100.fat * f),
      carbs: round1(per100.carbs * f)
    };
  }

  function macrosLine(m) {
    return round(m.kcal) + " kcal · P " + fmtNum(round1(m.protein)) + " · L " + fmtNum(round1(m.fat)) + " · G " + fmtNum(round1(m.carbs));
  }

  // "2 × œuf (100 g)" ou "150 g"
  function entryQtyText(e) {
    if (e.portionQty && e.portionLabel && e.grams) {
      return fmtNum(round1(e.portionQty)) + " × " + e.portionLabel + " (" + fmtNum(round1(e.grams)) + " g)";
    }
    return e.grams ? fmtNum(round1(e.grams)) + " g" : "";
  }

  // Copie d'une entrée pour la rajouter ailleurs (favori, copie de la
  // veille…). La photo n'est pas reprise : elle pèse lourd.
  function copyEntryFields(src) {
    var out = { name: src.name, kcal: src.kcal, protein: src.protein, fat: src.fat, carbs: src.carbs };
    var extra = ["grams", "per100", "foodId", "barcode", "portionLabel", "portionQty", "portionGrams"];
    for (var i = 0; i < extra.length; i++) {
      if (src[extra[i]] !== undefined && src[extra[i]] !== null) out[extra[i]] = src[extra[i]];
    }
    return out;
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
      try { localStorage.removeItem(STORAGE_LOG_LEGACY); } catch (e) { /* noop */ }
      return;
    }
    var history = loadHistory();
    if (!history[legacy.date]) {
      var profile = readJSON(STORAGE_PROFILE);
      var targets = profile ? profile.targets : { kcal: 0, protein: 0, fat: 0, carbs: 0 };
      history[legacy.date] = { date: legacy.date, entries: legacy.entries, targets: targets };
      saveHistory(history);
    }
    try { localStorage.removeItem(STORAGE_LOG_LEGACY); } catch (e2) { /* noop */ }
  }

  /* ---------------------------------------------------------
     Type de journée (repos / entraînement) — ajuste légèrement
     les glucides (et donc les calories) sans toucher protéines
     ni lipides. record.targets reste toujours la photo brute du
     profil ; l'ajustement est calculé à la volée à l'affichage.
     --------------------------------------------------------- */

  function setDayType(dateKey, type) {
    if (!ensureDayRecord(dateKey)) return null;
    var history = loadHistory();
    var record = history[dateKey];
    record.dayType = (type === "neutral") ? null : type;
    // Choix fait à la main : Samsung Health ne le remplace plus.
    record.dayTypeManual = true;
    delete record.dayTypeAuto;
    saveHistory(history);
    return record;
  }

  function effectiveTargetsFor(record) {
    var base = record && record.targets;
    if (!base) return base;
    var type = record.dayType;
    // Pas en plus que d'habitude (Samsung Health) : énergie ajoutée en glucides.
    var bonusCarbs = record.stepsBonus ? record.stepsBonus / KCAL_PER_G.carbs : 0;
    if (type !== "training" && type !== "rest" && !bonusCarbs) return base;

    var carbFactor = type === "training" ? 1.15 : (type === "rest" ? 0.85 : 1);
    var carbsAdjusted = Math.max(0, base.carbs * carbFactor + bonusCarbs);
    var kcalDelta = (carbsAdjusted - base.carbs) * KCAL_PER_G.carbs;

    return {
      kcal: round(base.kcal + kcalDelta),
      protein: base.protein,
      fat: base.fat,
      carbs: round(carbsAdjusted)
    };
  }

  /* ---------------------------------------------------------
     Statut d'une journée (couleur dans l'historique)
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

  /* ---------------------------------------------------------
     Jauges circulaires
     Chaque macro garde TOUJOURS sa couleur (calories blanc,
     protéines lime, lipides ambre, glucides cyan) ; le statut
     est écrit en clair sous la jauge, et l'anneau passe au rouge
     seulement en cas de dépassement net.
     --------------------------------------------------------- */

  var GAUGE_DEFS = [
    { key: "kcal", label: "Calories", unit: "kcal", color: "var(--text)", okFrom: 90, overAbove: 110 },
    { key: "protein", label: "Protéines", unit: "g", color: "var(--lime)", okFrom: 90, overAbove: null },
    { key: "fat", label: "Lipides", unit: "g", color: "var(--amber)", okFrom: 85, overAbove: 125 },
    { key: "carbs", label: "Glucides", unit: "g", color: "var(--cyan)", okFrom: 85, overAbove: 120 }
  ];

  function gaugesHtml(totals, targets, isAverage) {
    var html = "";
    for (var i = 0; i < GAUGE_DEFS.length; i++) {
      var d = GAUGE_DEFS[i];
      var value = totals[d.key] || 0;
      var target = targets[d.key] || 0;
      var pct = target > 0 ? (value / target) * 100 : 0;
      var isOver = d.overAbove !== null && pct > d.overAbove;
      var color = isOver ? "var(--red)" : d.color;

      var status, statusCls;
      if (isAverage) {
        status = round(pct) + "\u00a0% de la cible";
        statusCls = isOver ? "gs-over" : (pct >= d.okFrom ? "gs-ok" : "gs-left");
      } else if (isOver) {
        status = "+" + round(value - target) + " " + d.unit + " de trop";
        statusCls = "gs-over";
      } else if (pct >= d.okFrom) {
        status = "✓ Atteint";
        statusCls = "gs-ok";
      } else {
        status = "Reste " + round(target - value) + " " + d.unit;
        statusCls = "gs-left";
      }

      html +=
        '<div class="gauge' + (isAverage ? ' gauge-sm' : '') + '">' +
          '<div class="gauge-ring" style="--pct:' + Math.min(pct, 100).toFixed(0) + ';--ring-color:' + color + '">' +
            '<div class="gauge-ring-inner"></div>' +
            '<div class="gauge-text">' +
              '<span class="gauge-value">' + round(value) + '</span>' +
              '<span class="gauge-target">/ ' + round(target) + ' ' + d.unit + '</span>' +
            '</div>' +
          '</div>' +
          '<span class="gauge-label" style="color:' + d.color + '">' + d.label + '</span>' +
          '<span class="gauge-status ' + statusCls + '">' + status + '</span>' +
        '</div>';
    }
    return html;
  }

  /* ---------------------------------------------------------
     Dépense réelle (TDEE adaptatif)
     Si tu manges en moyenne X kcal/jour et que ton poids baisse de
     Y kg/jour, ta dépense réelle ≈ X + Y × 7700. C'est beaucoup plus
     fiable que la formule (qui peut se tromper de 10 à 20 %), à
     condition de noter tout ce que tu manges.
     --------------------------------------------------------- */

  var TDEE_WINDOW_DAYS = 28;
  var TDEE_MIN_LOGGED_DAYS = 10;
  var TDEE_MIN_WEIGH_INS = 5;
  var TDEE_MIN_WEIGHT_SPAN_DAYS = 14;

  function estimateRealTdee() {
    var history = loadHistory();
    var today = new Date();

    // Apports : jours renseignés de la fenêtre (hors aujourd'hui, pas
    // terminé). Un jour à moins de 50 % de sa cible est sans doute un
    // oubli de saisie : on l'écarte pour ne pas fausser la moyenne.
    var kcalSum = 0, logged = 0;
    for (var i = 1; i <= TDEE_WINDOW_DAYS; i++) {
      var r = history[dateKeyFromDate(addDays(today, -i))];
      if (!r || r.entries.length === 0) continue;
      var tot = sumEntries(r.entries).kcal;
      var tg = effectiveTargetsFor(r);
      if (tg && tg.kcal > 0 && tot < tg.kcal * 0.5) continue;
      kcalSum += tot;
      logged++;
    }

    // Poids : pente d'une régression linéaire sur les pesées de la
    // fenêtre (bien moins sensible à l'eau qu'un écart début/fin).
    var startTime = addDays(today, -TDEE_WINDOW_DAYS).getTime();
    var pts = [];
    var weights = loadWeights();
    for (var w = 0; w < weights.length; w++) {
      var t = parseDateKey(weights[w].date).getTime();
      if (t >= startTime) pts.push({ x: t / 86400000, y: weights[w].weight });
    }
    var span = pts.length > 1 ? pts[pts.length - 1].x - pts[0].x : 0;

    var base = { loggedDays: logged, weighIns: pts.length };
    if (logged < TDEE_MIN_LOGGED_DAYS || pts.length < TDEE_MIN_WEIGH_INS || span < TDEE_MIN_WEIGHT_SPAN_DAYS) {
      base.status = "need";
      return base;
    }

    var mx = 0, my = 0;
    for (var a = 0; a < pts.length; a++) { mx += pts[a].x; my += pts[a].y; }
    mx /= pts.length; my /= pts.length;
    var num = 0, den = 0;
    for (var b = 0; b < pts.length; b++) {
      num += (pts[b].x - mx) * (pts[b].y - my);
      den += (pts[b].x - mx) * (pts[b].x - mx);
    }
    var slopePerDay = den > 0 ? num / den : 0;

    var avgIntake = kcalSum / logged;
    var tdee = avgIntake - slopePerDay * KCAL_PER_KG;

    base.avgIntake = round(avgIntake);
    base.weeklyChange = round1(slopePerDay * 7);
    base.tdee = Math.round(tdee / 10) * 10;
    base.status = (tdee < 1200 || tdee > 5500) ? "weird" : "ok";
    return base;
  }

  function renderTdeeCard(profile) {
    var card = $("tdeeCard");
    if (!profile) { card.hidden = true; return; }
    card.hidden = false;

    var est = estimateRealTdee();
    var useBtn = $("tdeeUseBtn");
    var resetBtn = $("tdeeResetBtn");
    var formula = computeTargets(profile).tdeeFormula;
    var using = !!profile.tdeeOverride;
    var text;

    if (est.status === "need") {
      text = "Pour calculer ta vraie dépense, il faut au moins " + TDEE_MIN_LOGGED_DAYS + " jours de journal complet et " +
        TDEE_MIN_WEIGH_INS + " pesées sur 2 semaines (dans les 4 dernières). Pour l'instant : " +
        est.loggedDays + " jour" + (est.loggedDays > 1 ? "s" : "") + " et " + est.weighIns + " pesée" + (est.weighIns > 1 ? "s" : "") + ".";
      useBtn.hidden = true;
    } else if (est.status === "weird") {
      text = "Le calcul donne une valeur incohérente : ton journal est sans doute incomplet sur certains jours. Continue à tout noter, il se corrigera.";
      useBtn.hidden = true;
    } else {
      text = "Sur tes 4 dernières semaines (" + est.loggedDays + " jours renseignés), tu as mangé en moyenne " +
        est.avgIntake.toLocaleString("fr-FR") + " kcal/jour et ton poids a varié de " +
        (est.weeklyChange > 0 ? "+" : "") + fmtNum(est.weeklyChange) + " kg/semaine. " +
        "Ta dépense réelle est donc d'environ " + est.tdee.toLocaleString("fr-FR") + " kcal/jour" +
        (formula ? " (la formule estimait " + formula.toLocaleString("fr-FR") + ")" : "") + ". " +
        "Fiable seulement si tu notes vraiment tout ce que tu manges.";
      useBtn.hidden = using && Math.abs(profile.tdeeOverride - est.tdee) < 50;
      useBtn.textContent = using ? "Mettre à jour avec " + est.tdee.toLocaleString("fr-FR") + " kcal" : "Utiliser ma dépense réelle";
      useBtn.setAttribute("data-tdee", est.tdee);
    }

    if (using) {
      text += " Tes cibles utilisent actuellement ta dépense réelle (" + profile.tdeeOverride.toLocaleString("fr-FR") + " kcal).";
    }
    $("tdeeText").textContent = text;
    resetBtn.hidden = !using;
  }

  function handleTdeeUse() {
    var profile = readJSON(STORAGE_PROFILE);
    var val = parseInt($("tdeeUseBtn").getAttribute("data-tdee"), 10);
    if (!profile || !val) return;
    profile.tdeeOverride = val;
    var targets = applyProfile(profile);
    renderResults(targets, profile);
    showToast("Cibles recalculées avec ta dépense réelle");
  }

  function handleTdeeReset() {
    var profile = readJSON(STORAGE_PROFILE);
    if (!profile) return;
    delete profile.tdeeOverride;
    var targets = applyProfile(profile);
    renderResults(targets, profile);
    showToast("Retour à la formule");
  }

  /* ---------------------------------------------------------
     Profil & objectif (overlay ⚙)
     --------------------------------------------------------- */

  // Calcule et enregistre les cibles d'un profil. La journée en cours
  // prend les nouvelles cibles (elle n'est pas terminée) ; les journées
  // passées gardent les leurs, pour que l'historique reste exact.
  function applyProfile(profile) {
    var targets = computeTargets(profile);
    profile.targets = targets;
    writeJSON(STORAGE_PROFILE, profile);

    var todayRecord = getDayRecord(todayKey());
    if (todayRecord) {
      todayRecord.targets = targetsForDay(profile, todayKey());
      upsertDayRecord(todayRecord);
    }
    return targets;
  }

  function renderResults(targets, profile) {
    $("kcalDaily").textContent = targets.kcal.toLocaleString("fr-FR");
    $("objectiveLabel").textContent = targets.objectiveLabel;

    // Détails recalculés à l'affichage : les profils enregistrés par
    // une ancienne version de l'appli ne les contiennent pas.
    var meta = computeTargets(profile);
    var adj = meta.kcalAdjustPct;
    var adjLabel = adj === 0 ? "sans ajustement" : (adj > 0 ? "+" : "−") + Math.abs(adj) + "\u00a0%";
    $("kcalSource").textContent = (meta.tdeeSource === "real" ? "Ta dépense réelle mesurée (" : "Ta dépense estimée par formule (") +
      meta.tdee.toLocaleString("fr-FR") + " kcal), " + adjLabel + ".";

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
      { label: "Jour", mult: 1 },
      { label: "Semaine", mult: 7 },
      { label: "Mois", mult: 30 }
    ];
    var periodHtml = "";
    for (var p = 0; p < periods.length; p++) {
      periodHtml +=
        '<div class="period-cell">' +
          '<span class="p-label">' + periods[p].label + '</span>' +
          '<span class="p-value">' + (targets.kcal * periods[p].mult).toLocaleString("fr-FR") + '</span>' +
          '<span class="p-unit">kcal</span>' +
        '</div>';
    }
    $("periodTable").innerHTML = periodHtml;

    $("femaleNote").hidden = profile.sex !== "F";
    $("results").hidden = false;
    renderTdeeCard(profile);
    renderRampBlock(profile);
    renderHealthBlock(profile);
    renderRemindersBlock();
  }

  function rampMinStart(profile) {
    return Math.max(1500, Math.round((profile.targets.kcal - 1000) / 50) * 50);
  }

  function renderRampBlock(profile) {
    var r = profile.ramp || {};
    $("rampEnabled").checked = !!r.enabled;
    $("rampFields").hidden = !r.enabled;
    var suggested = recentAverageIntake(7);
    $("rampStart").value = r.startKcal || (suggested ? Math.max(suggested, rampMinStart(profile)) : "");
    $("rampStep").value = String(r.stepKcal || 300);

    var status = $("rampStatus");
    if (!r.enabled) {
      status.textContent = suggested && suggested < profile.targets.kcal - 400
        ? "Tu as mangé en moyenne " + suggested.toLocaleString("fr-FR") + " kcal ces derniers jours : la montée progressive est conseillée."
        : "";
      return;
    }
    var info = rampInfo(profile, todayKey());
    if (!info) {
      status.textContent = "Montée terminée : tu es à ta cible de " + profile.targets.kcal.toLocaleString("fr-FR") + " kcal.";
      return;
    }
    status.textContent = "Semaine " + info.week + " : " + info.kcal.toLocaleString("fr-FR") + " kcal par jour. Cible de " +
      info.final.toLocaleString("fr-FR") + " kcal atteinte dans " + info.weeksLeft + " semaine" + (info.weeksLeft > 1 ? "s" : "") + ".";
  }

  function saveRampFromForm() {
    var profile = readJSON(STORAGE_PROFILE);
    if (!profile) return;
    var enabled = $("rampEnabled").checked;
    var start = parseInt($("rampStart").value, 10);
    var step = parseInt($("rampStep").value, 10);
    if (RAMP_STEPS.indexOf(step) < 0) step = 300;
    if (enabled && (isNaN(start) || start < 800 || start > 5000)) {
      start = recentAverageIntake(7) || rampMinStart(profile);
    }
    // Un écart de plus de 1000 kcal avec ta dépense n'est pas un bon point de
    // départ : on commence au plus à 1000 kcal sous la cible.
    if (enabled && !isNaN(start)) start = Math.max(start, rampMinStart(profile));
    var prev = profile.ramp || {};
    // Changer le point de départ relance la montée à partir d'aujourd'hui.
    var restart = !prev.enabled || prev.startKcal !== start || prev.stepKcal !== step;
    profile.ramp = {
      enabled: enabled,
      startKcal: isNaN(start) ? (prev.startKcal || 1500) : start,
      stepKcal: step,
      startDate: restart || !prev.startDate ? todayKey() : prev.startDate
    };
    applyProfile(profile);
    renderResults(profile.targets, profile);
  }

  function fillProfileForm(profile) {
    var sexInput = document.getElementById(profile.sex === "F" ? "sexF" : "sexH");
    if (sexInput) sexInput.checked = true;
    $("age").value = profile.age;
    $("weight").value = fmtNum(profile.weight);
    $("height").value = profile.height;
    var guess = guessJobFromActivity(profile.activity);
    $("job").value = JOB_FACTORS.hasOwnProperty(profile.job) ? profile.job : guess.job;
    $("sessions").value = String(typeof profile.sessions === "number" ? profile.sessions : guess.sessions);
    $("objective").value = profile.objective;
    updateActivityHint();
  }

  function updateActivityHint() {
    var hint = $("activityHint");
    if (!hint) return;
    var job = $("job").value;
    var sessions = parseInt($("sessions").value, 10) || 0;
    var factor = activityFromJob(job, sessions);
    hint.textContent = JOB_LABELS[job] + " + " + sessions + " séance" + (sessions > 1 ? "s" : "") +
      " → coefficient d'activité " + fmtNum(factor);
  }

  function openSettings() {
    var profile = readJSON(STORAGE_PROFILE);
    $("welcomeNote").hidden = !!profile;
    $("calcError").hidden = true;
    if (profile) {
      fillProfileForm(profile);
      renderResults(profile.targets, profile);
      $("calcSubmit").textContent = "Recalculer mes objectifs";
    } else {
      $("results").hidden = true;
      $("calcSubmit").textContent = "Calculer mes objectifs";
    }
    $("settingsOverlay").hidden = false;
    $("settingsOverlay").scrollTop = 0;
    document.body.classList.add("no-scroll");
  }

  function closeSettings() {
    $("settingsOverlay").hidden = true;
    document.body.classList.remove("no-scroll");
    refreshActiveTab();
  }

  function handleCalcSubmit(e) {
    e.preventDefault();

    var sex = document.querySelector('input[name="sex"]:checked').value;
    var age = parseNum($("age").value);
    var weight = parseNum($("weight").value);
    var height = parseNum($("height").value);
    var err = $("calcError");

    var problem = null;
    if (isNaN(age) || age < 14 || age > 90) problem = "Âge invalide (entre 14 et 90 ans).";
    else if (isNaN(weight) || weight < 30 || weight > 250) problem = "Poids invalide (entre 30 et 250 kg, ex : 78,4).";
    else if (isNaN(height) || height < 120 || height > 230) problem = "Taille invalide (entre 120 et 230 cm).";
    if (problem) {
      err.textContent = problem;
      err.hidden = false;
      return;
    }
    err.hidden = true;

    var previous = readJSON(STORAGE_PROFILE);
    var profile = {
      sex: sex,
      age: age,
      weight: round1(weight),
      height: height,
      job: $("job").value,
      sessions: parseInt($("sessions").value, 10) || 0,
      objective: $("objective").value
    };
    profile.activity = activityFromJob(profile.job, profile.sessions);
    // La dépense réelle mesurée reste valable si on change d'objectif.
    if (previous && previous.tdeeOverride) profile.tdeeOverride = previous.tdeeOverride;
    if (previous && previous.ramp) profile.ramp = previous.ramp;
    if (previous && previous.stepsAdjust !== undefined) profile.stepsAdjust = previous.stepsAdjust;

    var targets = applyProfile(profile);
    $("welcomeNote").hidden = true;
    $("calcSubmit").textContent = "Recalculer mes objectifs";
    renderResults(targets, profile);
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------------------------------------------------------
     Ajout d'aliment — trois sous-modes partagent le même
     sélecteur : base de données (recherche + autocomplétion),
     scanner (caméra + Open Food Facts) et saisie manuelle.
     --------------------------------------------------------- */

  function setupFoodEntryUI(cfg) {
    var activeIndex = -1;
    var currentMatches = [];
    var lastMatchId = null;

    function added(entry) {
      var qty = entryQtyText(entry);
      showToast("Ajouté : " + entry.name + (qty ? " — " + qty : ""));
      cfg.onAdded();
    }

    /* ---------- Unité : grammes ou portion ---------- */

    function usingPortion(match) {
      return !!(match && match.portion && cfg.unitPortion.checked);
    }

    // Quantité saisie convertie en grammes (NaN si invalide).
    function gramsFromInput(match) {
      var qty = parseNum(cfg.gramsInput.value);
      if (isNaN(qty) || qty <= 0) return NaN;
      return usingPortion(match) ? qty * match.portion.grams : qty;
    }

    function updateUnitUI(match) {
      var portionMode = usingPortion(match);
      cfg.gramsLabel.textContent = portionMode ? "Nombre de portions (" + match.portion.label + ")" : "Quantité (g)";
      updateTotal(match);
    }

    function updateTotal(match) {
      if (!match) { cfg.totalPreview.hidden = true; return; }
      var grams = gramsFromInput(match);
      if (isNaN(grams)) { cfg.totalPreview.hidden = true; return; }
      cfg.totalPreview.textContent = "= " + (usingPortion(match) ? fmtNum(round1(grams)) + " g · " : "") + macrosLine(macrosFor(match, grams));
      cfg.totalPreview.hidden = false;
    }

    function onUnitChange() {
      var match = currentExactMatch();
      if (!match) return;
      cfg.gramsInput.value = usingPortion(match) ? "1" : "100";
      updateUnitUI(match);
    }

    cfg.unitPortion.addEventListener("change", onUnitChange);
    cfg.unitGrams.addEventListener("change", onUnitChange);
    cfg.gramsInput.addEventListener("input", function () { updateTotal(currentExactMatch()); });

    /* ---------- Mode "Ma base" (recherche + autocomplétion) ---------- */

    function currentExactMatch() {
      return findFoodByName(loadFoods(), cfg.searchInput.value);
    }

    function updatePreview() {
      var match = currentExactMatch();
      if (!match) {
        cfg.previewEl.hidden = true;
        cfg.noMatchEl.hidden = cfg.searchInput.value.trim() === "" || !cfg.suggestionsEl.hidden;
        cfg.dbSubmitBtn.disabled = true;
        cfg.unitRow.hidden = true;
        cfg.totalPreview.hidden = true;
        cfg.gramsLabel.textContent = "Quantité (g)";
        if (lastMatchId !== null) { cfg.unitGrams.checked = true; cfg.gramsInput.value = "100"; }
        lastMatchId = null;
        return;
      }
      // Nouvel aliment choisi : par défaut en portion s'il en a une.
      if (match.id !== lastMatchId) {
        lastMatchId = match.id;
        if (match.portion) {
          cfg.unitPortionLabel.textContent = match.portion.label + " (" + fmtNum(match.portion.grams) + " g)";
          cfg.unitPortion.checked = true;
          cfg.gramsInput.value = "1";
        } else {
          cfg.unitGrams.checked = true;
          cfg.gramsInput.value = "100";
        }
      }
      cfg.unitRow.hidden = !match.portion;
      updateUnitUI(match);
      cfg.noMatchEl.hidden = true;
      cfg.previewEl.hidden = false;
      cfg.previewEl.innerHTML =
        '<span class="fp-name">' + escapeHtml(match.name) +
          '<span class="fp-macros">P ' + fmtNum(match.protein) + 'g · L ' + fmtNum(match.fat) + 'g · G ' + fmtNum(match.carbs) + 'g /100g</span>' +
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
            '<span class="ai-macros">' + f.kcal + ' kcal · P' + fmtNum(f.protein) + ' L' + fmtNum(f.fat) + ' G' + fmtNum(f.carbs) + ' /100g</span>' +
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
      renderSuggestions();
      updatePreview();
    });
    cfg.searchInput.addEventListener("focus", function () {
      if (cfg.searchInput.value.trim() !== "" && !currentExactMatch()) renderSuggestions();
    });
    cfg.searchInput.addEventListener("blur", function () {
      window.setTimeout(function () { hideSuggestions(); updatePreview(); }, 150);
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
        ev.preventDefault();
        selectMatch(currentMatches[activeIndex >= 0 ? activeIndex : 0]);
      } else if (ev.key === "Escape") {
        hideSuggestions();
      }
    });

    cfg.dbForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var match = currentExactMatch();
      if (!match) return;
      var grams = gramsFromInput(match);
      if (isNaN(grams)) { cfg.gramsInput.focus(); return; }

      var m = macrosFor(match, grams);
      var entry = {
        name: match.name,
        kcal: m.kcal,
        protein: m.protein,
        fat: m.fat,
        carbs: m.carbs,
        grams: round1(grams),
        // Valeurs pour 100 g gardées : permettent de modifier la
        // quantité plus tard sans dépendre de la base d'aliments.
        per100: { kcal: match.kcal, protein: match.protein, fat: match.fat, carbs: match.carbs },
        foodId: match.id
      };
      if (usingPortion(match)) {
        entry.portionLabel = match.portion.label;
        entry.portionQty = round1(parseNum(cfg.gramsInput.value));
        entry.portionGrams = match.portion.grams;
      }

      var dateKey = cfg.getDateKey();
      if (!dateKey) return;
      if (!addFoodToDay(dateKey, entry)) return;
      bumpUsage(match.id);
      renderFrequentChips(cfg);

      cfg.dbForm.reset();
      cfg.gramsInput.value = "100";
      cfg.unitGrams.checked = true;
      cfg.unitRow.hidden = true;
      cfg.totalPreview.hidden = true;
      cfg.gramsLabel.textContent = "Quantité (g)";
      lastMatchId = null;
      cfg.previewEl.hidden = true;
      cfg.noMatchEl.hidden = true;
      cfg.dbSubmitBtn.disabled = true;
      hideSuggestions();
      cfg.gramsInput.blur();
      added(entry);
    });

    /* ---------- Mode "Manuel" ---------- */

    cfg.manualForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var kcal = parseNum(cfg.manualFields.kcal.value);
      var entry = {
        name: cfg.manualFields.name.value.trim(),
        kcal: isNaN(kcal) ? 0 : round(kcal),
        protein: round1(parseNum(cfg.manualFields.protein.value) || 0),
        fat: round1(parseNum(cfg.manualFields.fat.value) || 0),
        carbs: round1(parseNum(cfg.manualFields.carbs.value) || 0)
      };
      if (!entry.name) { cfg.manualFields.name.focus(); return; }
      if (isNaN(kcal)) { cfg.manualFields.kcal.focus(); return; }

      var dateKey = cfg.getDateKey();
      if (!dateKey) return;

      var photo = cfg.photoCtrl.getPhoto();
      if (photo) entry.photo = photo;

      // Échec = stockage plein (souvent la photo) : writeJSON a déjà
      // prévenu, on garde le formulaire rempli pour réessayer sans photo.
      if (!addFoodToDay(dateKey, entry)) return;

      cfg.manualForm.reset();
      cfg.photoCtrl.clear();
      added(entry);
    });

    /* ---------- Mode "Scanner" ---------- */

    var scan = cfg.scan;
    var scanPortion = null;

    scan.portionBtn.addEventListener("click", function () {
      if (scanPortion) scan.gramsInput.value = fmtNum(scanPortion.grams);
    });

    function resetScanPanel() {
      scan.statusEl.hidden = true;
      scan.notFoundEl.hidden = true;
      scan.form.hidden = true;
    }

    function populateScanForm(data, barcode, sourceLabel, allowSaveToggle) {
      scan.nameInput.value = data.name;
      scan.kcalInput.value = fmtNum(data.kcal);
      scan.proteinInput.value = fmtNum(data.protein);
      scan.fatInput.value = fmtNum(data.fat);
      scan.carbsInput.value = fmtNum(data.carbs);
      // Portion du fabricant ou de ta base : proposée en un tap, et
      // utilisée comme quantité par défaut (c'est souvent ce qu'on mange).
      scanPortion = data.portion || null;
      scan.gramsInput.value = scanPortion ? fmtNum(scanPortion.grams) : "100";
      scan.portionBtn.hidden = !scanPortion;
      if (scanPortion) scan.portionBtn.textContent = "1 " + scanPortion.label + " = " + fmtNum(scanPortion.grams) + " g";
      scan.form.setAttribute("data-barcode", barcode);
      scan.barcodeLabelEl.textContent = barcode;
      scan.sourceChipEl.textContent = sourceLabel;

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

      // Produit connu : le seul champ à remplir est la quantité, on y
      // place le curseur (sinon le clavier cache les macros à vérifier).
      // Produit nouveau sans nom : on commence par le nom.
      var focusEl = data.name ? scan.gramsInput : scan.nameInput;
      focusEl.focus();
      focusEl.select();
    }

    function handleBarcode(barcode) {
      resetScanPanel();

      // 1) Ta propre base d'abord — instantané, même hors-ligne.
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
            "Produit introuvable dans Open Food Facts (code : " + result.barcode + "). Ajoute-le une fois à ta base : il sera reconnu instantanément la prochaine fois, même hors-ligne.";
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
      showMode("manual");
    });

    scan.createFromNotFoundBtn.addEventListener("click", function () {
      var barcode = scan.notFoundEl.getAttribute("data-barcode") || "";
      scan.notFoundEl.hidden = true;
      populateScanForm({ name: "", kcal: 0, protein: 0, fat: 0, carbs: 0 }, barcode, "Nouveau produit", true);
      scan.kcalInput.value = "";
      scan.proteinInput.value = "";
      scan.fatInput.value = "";
      scan.carbsInput.value = "";
      scan.incompleteEl.hidden = true;
    });

    scan.form.addEventListener("submit", function (e) {
      e.preventDefault();
      var grams = parseNum(scan.gramsInput.value);
      if (isNaN(grams) || grams <= 0) { scan.gramsInput.focus(); return; }
      var name = scan.nameInput.value.trim();
      if (!name) { scan.nameInput.focus(); return; }
      var per100 = {
        kcal: parseNum(scan.kcalInput.value) || 0,
        protein: parseNum(scan.proteinInput.value) || 0,
        fat: parseNum(scan.fatInput.value) || 0,
        carbs: parseNum(scan.carbsInput.value) || 0
      };
      var barcodeVal = scan.form.getAttribute("data-barcode") || null;

      var m = macrosFor(per100, grams);
      var entry = {
        name: name,
        kcal: m.kcal,
        protein: m.protein,
        fat: m.fat,
        carbs: m.carbs,
        grams: round1(grams),
        per100: per100,
        barcode: barcodeVal
      };

      var dateKey = cfg.getDateKey();
      if (!dateKey) return;
      if (!addFoodToDay(dateKey, entry)) return;

      if (scan.saveToDbCheckbox.checked) {
        var foods = loadFoods();
        var existing = findFoodByName(foods, name);
        if (!existing) {
          createFood({ name: name, kcal: per100.kcal, protein: per100.protein, fat: per100.fat, carbs: per100.carbs, barcode: barcodeVal, portion: scanPortion });
        } else if (barcodeVal && !existing.barcode) {
          // Aliment déjà présent par nom mais pas encore lié à ce code-barres.
          updateFoodRecord(existing.id, { name: existing.name, kcal: existing.kcal, protein: existing.protein, fat: existing.fat, carbs: existing.carbs, barcode: barcodeVal });
        }
      }

      resetScanPanel();
      scan.gramsInput.blur();
      added(entry);
    });

    /* ---------- Bascule entre les 3 modes ---------- */

    function showMode(mode) {
      cfg.dbForm.hidden = mode !== "db";
      cfg.scanPanel.hidden = mode !== "scan";
      cfg.manualForm.hidden = mode !== "manual";
      if (cfg.frequentContainer) cfg.frequentContainer.classList.toggle("is-off", mode !== "db");
      if (mode !== "db") hideSuggestions();
      if (mode !== "scan") resetScanPanel();
    }

    cfg.modeDb.addEventListener("change", function () { showMode("db"); });
    cfg.modeScan.addEventListener("change", function () { showMode("scan"); });
    cfg.modeManual.addEventListener("change", function () { showMode("manual"); });

    renderFrequentChips(cfg);
  }

  /* ---------------------------------------------------------
     Suivi — affiche UNE journée : aujourd'hui par défaut, ou
     n'importe quel jour passé (flèches ‹ › ou depuis
     l'historique). Remplace l'ancien écran "détail d'une journée"
     qui dupliquait tout le formulaire.
     --------------------------------------------------------- */

  // dateKey null = "aujourd'hui" : suit automatiquement le passage
  // à minuit si l'appli reste ouverte.
  var trackState = { dateKey: null };

  function currentDayKey() { return trackState.dateKey || todayKey(); }

  function setTrackDay(key) {
    trackState.dateKey = (!key || key >= todayKey()) ? null : key;
    refreshTracker();
  }

  function dayLabel(key) {
    var today = todayKey();
    if (key === today) return "Aujourd'hui";
    if (key === dateKeyFromDate(addDays(parseDateKey(today), -1))) return "Hier";
    return formatDateLong(key);
  }

  function renderFoodListInto(listEl, emptyEl, entries, onOpen, onDelete) {
    if (entries.length === 0) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    var html = "";
    for (var i = entries.length - 1; i >= 0; i--) {
      var e = entries[i];
      var qty = entryQtyText(e);
      var photo = safePhoto(e.photo);
      var thumb = photo ? '<img class="food-thumb" src="' + photo + '" alt="">' : '';
      var id = escapeHtml(e.id);
      html +=
        '<li class="food-item">' +
          '<button type="button" class="food-open" data-id="' + id + '" aria-label="Modifier ' + escapeHtml(e.name) + '">' + thumb +
            '<span class="food-name">' + escapeHtml(e.name) +
              '<span class="food-macros">' + (qty ? escapeHtml(qty) + ' · ' : '') + 'P ' + fmtNum(round1(e.protein)) + ' · L ' + fmtNum(round1(e.fat)) + ' · G ' + fmtNum(round1(e.carbs)) + '</span>' +
            '</span>' +
            '<span class="food-kcal">' + round(e.kcal) + '<small> kcal</small></span>' +
          '</button>' +
          '<button type="button" class="food-del" data-id="' + id + '" aria-label="Supprimer ' + escapeHtml(e.name) + '">×</button>' +
        '</li>';
    }
    listEl.innerHTML = html;

    var openButtons = listEl.querySelectorAll(".food-open");
    for (var k = 0; k < openButtons.length; k++) {
      openButtons[k].addEventListener("click", function (ev) {
        onOpen(ev.currentTarget.getAttribute("data-id"));
      });
    }
    var delButtons = listEl.querySelectorAll(".food-del");
    for (var j = 0; j < delButtons.length; j++) {
      delButtons[j].addEventListener("click", function (ev) {
        onDelete(ev.currentTarget.getAttribute("data-id"));
      });
    }
  }

  /* ---------------------------------------------------------
     Modifier une entrée du journal (quantité ou valeurs)
     --------------------------------------------------------- */

  var entryEdit = { dateKey: null, id: null, per100: null, portion: null };

  function findEntry(dateKey, id) {
    var r = getDayRecord(dateKey);
    if (!r) return null;
    for (var i = 0; i < r.entries.length; i++) if (r.entries[i].id === id) return r.entries[i];
    return null;
  }

  function entryPortionMode() {
    return !!(entryEdit.portion && $("entryUnitPortion").checked);
  }

  function entryGramsFromInput() {
    var qty = parseNum($("entryQty").value);
    if (isNaN(qty) || qty <= 0) return NaN;
    return entryPortionMode() ? qty * entryEdit.portion.grams : qty;
  }

  function updateEntryPreview() {
    $("entryQtyLabel").textContent = entryPortionMode() ? "Nombre de portions (" + entryEdit.portion.label + ")" : "Quantité (g)";
    var grams = entryGramsFromInput();
    $("entryPreview").textContent = isNaN(grams) ? "" :
      "= " + (entryPortionMode() ? fmtNum(round1(grams)) + " g · " : "") + macrosLine(macrosFor(entryEdit.per100, grams));
  }

  function openEntryEditor(dateKey, id) {
    var e = findEntry(dateKey, id);
    if (!e) return;
    entryEdit.dateKey = dateKey;
    entryEdit.id = id;
    // Valeurs pour 100 g : enregistrées avec l'entrée, ou retrouvées à
    // partir de la quantité pour les entrées d'avant cette version.
    entryEdit.per100 = e.per100 || (e.grams > 0 ? {
      kcal: e.kcal * 100 / e.grams, protein: e.protein * 100 / e.grams,
      fat: e.fat * 100 / e.grams, carbs: e.carbs * 100 / e.grams
    } : null);
    var food = e.foodId ? findFoodById(loadFoods(), e.foodId) : null;
    entryEdit.portion = e.portionGrams ? { label: e.portionLabel, grams: e.portionGrams } : (food && food.portion ? food.portion : null);

    $("entryName").value = e.name;
    $("entryError").hidden = true;
    $("entryQtyBlock").hidden = !entryEdit.per100;
    $("entryMacroBlock").hidden = !!entryEdit.per100;

    if (entryEdit.per100) {
      $("entryUnitRow").hidden = !entryEdit.portion;
      if (entryEdit.portion) $("entryUnitPortionLabel").textContent = entryEdit.portion.label + " (" + fmtNum(entryEdit.portion.grams) + " g)";
      if (entryEdit.portion && e.portionQty) {
        $("entryUnitPortion").checked = true;
        $("entryQty").value = fmtNum(round1(e.portionQty));
      } else {
        $("entryUnitGrams").checked = true;
        $("entryQty").value = fmtNum(round1(e.grams));
      }
      updateEntryPreview();
    } else {
      $("entryKcal").value = fmtNum(round(e.kcal));
      $("entryProtein").value = fmtNum(round1(e.protein));
      $("entryFat").value = fmtNum(round1(e.fat));
      $("entryCarbs").value = fmtNum(round1(e.carbs));
    }

    $("entrySheet").hidden = false;
    document.body.classList.add("no-scroll");
  }

  function closeEntryEditor() {
    $("entrySheet").hidden = true;
    document.body.classList.remove("no-scroll");
  }

  function onEntryUnitChange() {
    // Garde la même quantité réelle en changeant d'unité.
    var wasPortion = !entryPortionMode();
    var qty = parseNum($("entryQty").value);
    if (!isNaN(qty) && entryEdit.portion) {
      $("entryQty").value = fmtNum(round1(wasPortion ? qty * entryEdit.portion.grams : qty / entryEdit.portion.grams));
    }
    updateEntryPreview();
  }

  function handleEntrySave(ev) {
    ev.preventDefault();
    var err = $("entryError");
    var name = $("entryName").value.trim();
    if (!name) { err.textContent = "Le nom ne peut pas être vide."; err.hidden = false; return; }

    var key = entryEdit.dateKey, id = entryEdit.id;
    var updated;
    if (entryEdit.per100) {
      var grams = entryGramsFromInput();
      if (isNaN(grams)) { err.textContent = "Quantité invalide (ex : 150 ou 1,5)."; err.hidden = false; return; }
      var m = macrosFor(entryEdit.per100, grams);
      updated = { name: name, kcal: m.kcal, protein: m.protein, fat: m.fat, carbs: m.carbs, grams: round1(grams), per100: entryEdit.per100 };
      if (entryPortionMode()) {
        updated.portionLabel = entryEdit.portion.label;
        updated.portionQty = round1(parseNum($("entryQty").value));
        updated.portionGrams = entryEdit.portion.grams;
      }
    } else {
      var kcal = parseNum($("entryKcal").value);
      if (isNaN(kcal) || kcal < 0) { err.textContent = "Calories invalides."; err.hidden = false; return; }
      updated = {
        name: name, kcal: round(kcal),
        protein: round1(parseNum($("entryProtein").value) || 0),
        fat: round1(parseNum($("entryFat").value) || 0),
        carbs: round1(parseNum($("entryCarbs").value) || 0)
      };
    }

    closeEntryEditor();
    withUndo([STORAGE_HISTORY], "Aliment modifié", function () {
      var history = loadHistory();
      var r = history[key];
      if (!r) return;
      for (var i = 0; i < r.entries.length; i++) {
        var old = r.entries[i];
        if (old.id !== id) continue;
        // On garde l'identité de l'entrée (photo, lien vers la base…).
        updated.id = old.id;
        if (old.photo) updated.photo = old.photo;
        if (old.foodId) updated.foodId = old.foodId;
        if (old.barcode) updated.barcode = old.barcode;
        r.entries[i] = updated;
      }
      saveHistory(history);
    }, refreshTracker);
  }

  function handleEntryDelete() {
    var key = entryEdit.dateKey, id = entryEdit.id;
    closeEntryEditor();
    withUndo([STORAGE_HISTORY], "Aliment supprimé", function () { removeFoodFromDay(key, id); }, refreshTracker);
  }

  // Jour précédent qui a un journal (pour "Copier la veille").
  function previousDayWithEntries(key) {
    var history = loadHistory();
    var prevKey = dateKeyFromDate(addDays(parseDateKey(key), -1));
    var r = history[prevKey];
    return (r && r.entries.length > 0) ? r : null;
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

    var key = currentDayKey();
    var isToday = key === todayKey();
    // Aujourd'hui : la journée est créée tout de suite. Jour passé :
    // seulement au premier ajout (pas de journées vides parasites).
    var record = isToday ? ensureDayRecord(key) : getDayRecord(key);
    var view = record || { date: key, entries: [], targets: profile.targets };
    var totals = sumEntries(view.entries);

    $("trackDate").textContent = dayLabel(key);
    $("dayToday").hidden = isToday;
    $("dayNext").disabled = isToday;

    var dayTargets = effectiveTargetsFor(view);
    $("gaugesGrid").innerHTML = gaugesHtml(totals, dayTargets, false);
    renderSummary(view, totals, dayTargets, isToday);
    renderCreatine(view);
    if (isToday) pushNativeSummary(view, totals, dayTargets);
    renderFoodListInto($("foodLog"), $("logEmpty"), view.entries, function (id) {
      openEntryEditor(key, id);
    }, function (id) {
      withUndo([STORAGE_HISTORY], "Aliment supprimé", function () { removeFoodFromDay(key, id); }, refreshTracker);
    });

    var hasEntries = view.entries.length > 0;
    $("resetDay").hidden = !hasEntries;
    $("saveAsFavorite").hidden = !hasEntries || !isToday;

    var prev = hasEntries ? null : previousDayWithEntries(key);
    var copyBtn = $("copyPrevDay");
    copyBtn.hidden = !prev;
    if (prev) {
      copyBtn.textContent = "↺ Copier le journal " + (isToday ? "d'hier" : "de la veille") + " (" + prev.entries.length + " aliment" + (prev.entries.length > 1 ? "s" : "") + ")";
    }

    var dtVal = view.dayType || "neutral";
    var dtId = dtVal === "rest" ? "dayTypeRest" : (dtVal === "training" ? "dayTypeTraining" : "dayTypeNeutral");
    $(dtId).checked = true;

    refreshHydrationUI(view, profile);
    renderFavoritesQuickAdd();
  }

  /* ---------------------------------------------------------
     Résumé du jour + « Il te manque… »
     Une phrase claire en haut, puis des aliments de TA base (les plus
     utilisés d'abord) avec la quantité qui comble le manque.
     --------------------------------------------------------- */

  var suggestState = { items: [] };

  function niceGrams(g, food) {
    if (food.portion && food.portion.grams > 0) {
      var qty = Math.max(1, Math.round(g / food.portion.grams));
      return { grams: round1(qty * food.portion.grams), portionQty: qty };
    }
    var step = g >= 100 ? 25 : 10;
    return { grams: Math.max(step, Math.round(g / step) * step), portionQty: null };
  }

  function qtyLabel(food, q) {
    if (q.portionQty) return q.portionQty + " × " + food.portion.label;
    return fmtNum(q.grams) + " g";
  }

  // Aliments pour combler les protéines (puis les calories) qui manquent.
  function buildSuggestions(left) {
    var foods = loadFoods();
    var usage = loadUsage();
    var recent = {};
    averageDailyFoods().items.forEach(function (it) { recent[it.id] = true; });
    foods = foods.filter(function (f) { return !isSupplement(f.name) || usage[f.id] || recent[f.id]; });
    var out = [];

    function rank(list, scoreFn) {
      return list.slice().sort(function (a, b) { return scoreFn(b) - scoreFn(a); });
    }

    if (left.protein >= 15) {
      // Aliments « protéinés » : au moins 30 % des calories viennent des protéines.
      var lean = foods.filter(function (f) {
        return f.kcal > 0 && f.protein >= 8 && (f.protein * KCAL_PER_G.protein) / f.kcal >= 0.3;
      });
      lean = rank(lean, function (f) { return (recent[f.id] ? 20 : 0) + (usage[f.id] || 0) * 3 + f.protein / 10; });
      var goal = Math.min(left.protein, 45);
      for (var i = 0; i < lean.length && out.length < 3; i++) {
        var f = lean[i];
        var g = Math.min(goal / f.protein * 100, 400);
        if (left.kcal > 0) g = Math.min(g, left.kcal / f.kcal * 100);
        if (g < 30) continue;
        var q = niceGrams(g, f);
        out.push({ food: f, q: q, m: macrosFor(f, q.grams), why: "protéines" });
      }
    } else if (left.kcal >= 250) {
      // Protéines atteintes : on complète avec ce que tu manges d'habitude.
      var energy = foods.filter(function (f) { return f.kcal >= 80 && (usage[f.id] || 0) > 0; });
      if (energy.length < 2) energy = foods.filter(function (f) { return f.kcal >= 80; });
      energy = rank(energy, function (f) { return (recent[f.id] ? 20 : 0) + (usage[f.id] || 0) * 3 + (f.carbs > f.fat ? 1 : 0); });
      for (var j = 0; j < energy.length && out.length < 3; j++) {
        var e = energy[j];
        var ge = Math.min(left.kcal / e.kcal * 100, 300);
        if (ge < 20) continue;
        var qe = niceGrams(ge, e);
        out.push({ food: e, q: qe, m: macrosFor(e, qe.grams), why: "calories" });
      }
    }
    return out;
  }

  function renderSummary(view, totals, targets, isToday) {
    var left = {
      kcal: round(targets.kcal - totals.kcal),
      protein: round(targets.protein - totals.protein)
    };
    var head = $("summaryHeadline");
    var detail = $("summaryDetail");
    var list = $("suggestList");
    suggestState.items = [];
    list.innerHTML = "";

    var profile = readJSON(STORAGE_PROFILE);
    var info = profile ? rampInfo(profile, view.date) : null;
    var notes = [];
    if (info) notes.push("Palier semaine " + info.week + " de ta montée progressive (cible finale " + info.final.toLocaleString("fr-FR") + " kcal).");
    if (view.stepsBonus) notes.push("+" + view.stepsBonus + " kcal : tu as marché plus que d'habitude (" + (view.steps || 0).toLocaleString("fr-FR") + " pas).");

    if (!isToday) {
      var pct = targets.kcal > 0 ? round(totals.kcal / targets.kcal * 100) : 0;
      head.textContent = round(totals.kcal).toLocaleString("fr-FR") + " kcal et " + round(totals.protein) + " g de protéines ce jour-là.";
      notes.unshift(pct + " % de la cible de calories.");
      detail.textContent = notes.join(" ");
      return;
    }

    if (left.protein <= 5 && Math.abs(left.kcal) <= targets.kcal * 0.1) {
      head.textContent = "Objectifs du jour atteints, bravo !";
    } else if (left.kcal < 0) {
      head.textContent = "Calories dépassées de " + (-left.kcal) + " kcal" +
        (left.protein > 5 ? ", mais il manque encore " + left.protein + " g de protéines." : ".");
    } else {
      head.textContent = "Il te reste " + left.kcal.toLocaleString("fr-FR") + " kcal" +
        (left.protein > 5 ? " et " + left.protein + " g de protéines." : ". Protéines : c'est bon ✓");
    }

    var sugg = buildSuggestions(left);
    if (sugg.length) {
      notes.push(sugg[0].why === "protéines" ? "Pour tes protéines, de ta base :" : "Pour compléter tes calories :");
    }
    detail.textContent = notes.join(" ");
    suggestState.items = sugg;

    var html = "";
    for (var i = 0; i < sugg.length; i++) {
      var s = sugg[i];
      html +=
        '<li class="suggest-item">' +
          '<span class="suggest-name">' + escapeHtml(s.food.name) +
            '<span class="suggest-macros">' + escapeHtml(qtyLabel(s.food, s.q)) + ' · ' + round(s.m.protein) + ' g prot. · ' + round(s.m.kcal) + ' kcal</span>' +
          '</span>' +
          '<button type="button" class="chip-btn" data-sugg="' + i + '" aria-label="Ajouter ' + escapeHtml(s.food.name) + '">+ Ajouter</button>' +
        '</li>';
    }
    list.innerHTML = html;
    var btns = list.querySelectorAll("[data-sugg]");
    for (var k = 0; k < btns.length; k++) {
      btns[k].addEventListener("click", function (ev) {
        addSuggestion(suggestState.items[parseInt(ev.currentTarget.getAttribute("data-sugg"), 10)]);
      });
    }
  }

  function addSuggestion(s) {
    if (!s) return;
    var key = currentDayKey();
    if (!ensureDayRecord(key)) return;
    var f = s.food;
    var entry = {
      name: f.name, kcal: s.m.kcal, protein: s.m.protein, fat: s.m.fat, carbs: s.m.carbs,
      grams: s.q.grams,
      per100: { kcal: f.kcal, protein: f.protein, fat: f.fat, carbs: f.carbs },
      foodId: f.id
    };
    if (s.q.portionQty) {
      entry.portionLabel = f.portion.label;
      entry.portionQty = s.q.portionQty;
      entry.portionGrams = f.portion.grams;
    }
    var before = readJSON(STORAGE_HISTORY);
    if (!addFoodToDay(key, entry)) return;
    bumpUsage(f.id);
    refreshTracker();
    showToast("Ajouté : " + f.name + " — " + qtyLabel(f, s.q), function () {
      writeJSON(STORAGE_HISTORY, before);
      refreshTracker();
    });
  }

  /* ---------------------------------------------------------
     Créatine : une case par jour (3 à 5 g, n'importe quand).
     --------------------------------------------------------- */

  function renderCreatine(view) {
    var history = loadHistory();
    var count = 0;
    for (var i = 0; i < 7; i++) {
      var k = dateKeyFromDate(addDays(parseDateKey(view.date), -i));
      var r = k === view.date ? view : history[k];
      if (r && r.creatine) count++;
    }
    var btn = $("creatineBtn");
    btn.textContent = view.creatine ? "Prise ✓" : "Je l'ai prise";
    btn.className = view.creatine ? "btn-ghost creatine-btn creatine-done" : "btn-primary creatine-btn";
    $("creatineWeek").textContent = count + " / 7 jours cette semaine · 3 à 5 g par jour";
  }

  function toggleCreatine() {
    var key = currentDayKey();
    if (!ensureDayRecord(key)) return;
    var history = loadHistory();
    var rec = history[key];
    rec.creatine = !rec.creatine;
    if (!rec.creatine) delete rec.creatine;
    saveHistory(history);
    refreshTracker();
  }

  function handleResetDay() {
    var key = currentDayKey();
    withUndo([STORAGE_HISTORY], "Journal vidé", function () {
      var history = loadHistory();
      if (history[key]) {
        history[key].entries = [];
        saveHistory(history);
      }
    }, refreshTracker);
  }

  function handleCopyPrevDay() {
    var key = currentDayKey();
    var prev = previousDayWithEntries(key);
    if (!prev) return;
    withUndo([STORAGE_HISTORY], prev.entries.length + " aliment" + (prev.entries.length > 1 ? "s copiés" : " copié"), function () {
      if (!ensureDayRecord(key)) return;
      for (var i = 0; i < prev.entries.length; i++) {
        var src = prev.entries[i];
        // Photos non copiées : elles pèsent lourd dans le stockage.
        addFoodToDay(key, copyEntryFields(src));
      }
    }, refreshTracker);
  }

  /* ---------------------------------------------------------
     Historique + Bilans
     --------------------------------------------------------- */

  var historyState = {
    mode: "list",
    calendarCursor: new Date()
  };

  function daysWithEntries(history) {
    return Object.keys(history).filter(function (k) { return history[k].entries.length > 0; });
  }

  function refreshHistory() {
    var history = loadHistory();
    var hasData = daysWithEntries(history).length > 0;
    var mode = historyState.mode;

    $("historyEmpty").hidden = hasData;
    $("historyListView").hidden = !hasData || mode !== "list";
    $("historyCalendarView").hidden = mode !== "calendar";
    $("statsContent").hidden = !hasData || mode !== "stats";

    if (mode === "list" && hasData) renderHistoryList(history);
    if (mode === "calendar") renderHistoryCalendar(history);
    if (mode === "stats" && hasData) refreshStats();
  }

  function openDayInTracker(key) {
    setTrackDay(key);
    switchTab("track");
  }

  function renderHistoryList(history) {
    var keys = daysWithEntries(history);
    keys.sort();
    keys.reverse();

    var html = "";
    for (var i = 0; i < keys.length; i++) {
      var record = history[keys[i]];
      var totals = sumEntries(record.entries);
      var status = dayStatus(record);
      var target = effectiveTargetsFor(record);

      html +=
        '<li>' +
          '<button type="button" class="history-row" data-date="' + escapeHtml(record.date) + '">' +
            '<span class="status-dot st-' + status + '"></span>' +
            '<span class="h-date">' + dayLabel(record.date) +
              '<span class="h-sub">' + record.entries.length + ' aliment' + (record.entries.length > 1 ? 's' : '') +
                ' · P ' + round(totals.protein) + ' g' +
              '</span>' +
            '</span>' +
            '<span class="h-kcal">' + round(totals.kcal) + ' / ' + round(target.kcal) + ' kcal</span>' +
          '</button>' +
        '</li>';
    }
    $("historyList").innerHTML = html;

    var rows = $("historyList").querySelectorAll(".history-row");
    for (var j = 0; j < rows.length; j++) {
      rows[j].addEventListener("click", function (ev) {
        openDayInTracker(ev.currentTarget.getAttribute("data-date"));
      });
    }
  }

  function renderHistoryCalendar(history) {
    var cursor = historyState.calendarCursor;
    var year = cursor.getFullYear();
    var month = cursor.getMonth();

    var monthLabel = cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    $("calLabel").textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

    var firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var today = todayKey();

    var html = "";
    for (var i = 0; i < firstWeekday; i++) {
      html += '<div class="cal-cell cal-empty"></div>';
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var key = dateKeyFromDate(new Date(year, month, day));
      var record = history[key];
      var hasData = !!(record && record.entries.length > 0);
      var status = hasData ? dayStatus(record) : "none";
      var isFuture = key > today;
      var classes = "cal-cell st-" + status + (hasData ? " has-data" : "") + (key === today ? " is-today" : "");
      // Un jour passé sans données reste cliquable : on peut le remplir après coup.
      html += '<button type="button" class="' + classes + '" data-date="' + key + '"' + (isFuture ? " disabled" : "") + '>' + day + '</button>';
    }
    $("calendarGrid").innerHTML = html;

    $("calNext").disabled = year > new Date().getFullYear() || (year === new Date().getFullYear() && month >= new Date().getMonth());

    var cells = $("calendarGrid").querySelectorAll("button.cal-cell:not([disabled])");
    for (var c = 0; c < cells.length; c++) {
      cells[c].addEventListener("click", function (ev) {
        openDayInTracker(ev.currentTarget.getAttribute("data-date"));
      });
    }
  }

  function computePeriodStats(nDays) {
    var history = loadHistory();
    var today = new Date();
    var recordsWithData = [];
    var successCount = 0;

    for (var i = 0; i < nDays; i++) {
      var record = history[dateKeyFromDate(addDays(today, -i))];
      if (record && record.entries.length > 0) {
        recordsWithData.push(record);
        if (dayStatus(record) === "green") successCount++;
      }
    }

    var daysLogged = recordsWithData.length;
    var stats = {
      daysLogged: daysLogged,
      totalDays: nDays,
      successCount: successCount,
      regularityPct: nDays > 0 ? round((successCount / nDays) * 100) : 0
    };
    if (daysLogged === 0) return stats;

    var sumConsumed = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    var sumTarget = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    var macroKeys = ["kcal", "protein", "fat", "carbs"];

    for (var j = 0; j < recordsWithData.length; j++) {
      var t = sumEntries(recordsWithData[j].entries);
      var tg = effectiveTargetsFor(recordsWithData[j]);
      for (var m = 0; m < macroKeys.length; m++) {
        sumConsumed[macroKeys[m]] += t[macroKeys[m]];
        sumTarget[macroKeys[m]] += tg[macroKeys[m]];
      }
    }

    stats.avgConsumed = {};
    stats.avgTarget = {};
    for (var k = 0; k < macroKeys.length; k++) {
      stats.avgConsumed[macroKeys[k]] = sumConsumed[macroKeys[k]] / daysLogged;
      stats.avgTarget[macroKeys[k]] = sumTarget[macroKeys[k]] / daysLogged;
    }
    stats.totalConsumed = sumConsumed;
    stats.totalTarget = sumTarget;
    return stats;
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
    chip.textContent = stats.successCount + " j. dans la cible";

    if (stats.daysLogged === 0) {
      $(prefix + "Gauges").innerHTML = "";
      $(prefix + "Totals").innerHTML = '<p class="note">Aucune donnée sur cette période pour le moment.</p>';
      return;
    }

    $(prefix + "Gauges").innerHTML = gaugesHtml(stats.avgConsumed, stats.avgTarget, true);

    // La cible totale ne compte que les jours renseignés : comparer ce
    // qui a été mangé sur 4 jours à une cible de 7 jours fausserait tout.
    var balance = round(stats.totalConsumed.kcal - stats.totalTarget.kcal);
    var cells = [
      { label: "Moy. kcal / jour", value: round(stats.avgConsumed.kcal).toLocaleString("fr-FR") + " kcal" },
      { label: "Moy. protéines / jour", value: round(stats.avgConsumed.protein) + " g" },
      { label: "Écart cumulé à la cible", value: (balance > 0 ? "+" : "") + balance.toLocaleString("fr-FR") + " kcal" },
      { label: "Régularité", value: stats.regularityPct + "\u00a0% des jours" }
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
    renderStatsBlock("week", computePeriodStats(7));
    renderStatsBlock("month", computePeriodStats(30));
  }

  /* ---------------------------------------------------------
     Aliments — gestion de la base (onglet "Aliments")
     --------------------------------------------------------- */

  var foodsEditState = { editingId: null };

  function refreshFoodsPanel() {
    var filterText = $("foodsFilter").value.trim();
    var usage = loadUsage();
    var foods = loadFoods().slice();
    foods.sort(function (a, b) {
      var ua = usage[a.id] || 0, ub = usage[b.id] || 0;
      if (ub !== ua) return ub - ua;
      return a.name.localeCompare(b.name, "fr");
    });

    if (filterText) {
      foods = foods.filter(function (f) { return matchesQuery(f.name, filterText); });
    }

    $("foodsDbEmpty").hidden = foods.length > 0;

    var html = "";
    for (var i = 0; i < foods.length; i++) {
      var f = foods[i];
      var barcodeTag = (f.portion ? ' · 1 ' + escapeHtml(f.portion.label) + ' = ' + fmtNum(f.portion.grams) + ' g' : '') + (f.barcode ? ' · 📷' : '');
      html +=
        '<li class="food-db-row">' +
          '<div class="fdb-info">' +
            '<span class="fdb-name">' + escapeHtml(f.name) + '</span>' +
            '<span class="fdb-macros">' + f.kcal + ' kcal · P' + fmtNum(f.protein) + ' L' + fmtNum(f.fat) + ' G' + fmtNum(f.carbs) + ' /100g' + barcodeTag + '</span>' +
          '</div>' +
          '<div class="fdb-actions">' +
            '<button type="button" class="icon-btn" data-edit="' + escapeHtml(f.id) + '" aria-label="Modifier ' + escapeHtml(f.name) + '">✎</button>' +
            '<button type="button" class="icon-btn icon-danger" data-delete="' + escapeHtml(f.id) + '" aria-label="Supprimer ' + escapeHtml(f.name) + '">×</button>' +
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
        // Les entrées déjà enregistrées dans le journal ne sont pas touchées.
        withUndo([STORAGE_FOODS, STORAGE_USAGE], "Aliment retiré de ta base", function () { deleteFoodRecord(id); }, refreshFoodsPanel);
      });
    }
  }

  function openFoodEditForm(id) {
    var form = $("foodEditForm");
    if (id) {
      var food = findFoodById(loadFoods(), id);
      if (!food) return;
      foodsEditState.editingId = id;
      $("foodEditTitle").textContent = "Modifier l'aliment";
      $("editFoodName").value = food.name;
      $("editFoodKcal").value = fmtNum(food.kcal);
      $("editFoodProtein").value = fmtNum(food.protein);
      $("editFoodFat").value = fmtNum(food.fat);
      $("editFoodCarbs").value = fmtNum(food.carbs);
      $("editFoodPortionLabel").value = food.portion ? food.portion.label : "";
      $("editFoodPortionGrams").value = food.portion ? fmtNum(food.portion.grams) : "";
    } else {
      foodsEditState.editingId = null;
      $("foodEditTitle").textContent = "Nouvel aliment";
      form.reset();
    }
    $("foodEditError").hidden = true;
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
      kcal: round(parseNum($("editFoodKcal").value) || 0),
      protein: round1(parseNum($("editFoodProtein").value) || 0),
      fat: round1(parseNum($("editFoodFat").value) || 0),
      carbs: round1(parseNum($("editFoodCarbs").value) || 0)
    };
    if (!data.name) return;

    // Portion facultative : les deux champs, ou aucun.
    var pLabel = $("editFoodPortionLabel").value.trim();
    var pGramsRaw = $("editFoodPortionGrams").value.trim();
    var pGrams = parseNum(pGramsRaw);
    var err = $("foodEditError");
    if ((pLabel && !pGramsRaw) || (!pLabel && pGramsRaw)) {
      err.textContent = "Pour une portion, remplis son nom ET son poids (ou laisse les deux vides).";
      err.hidden = false;
      return;
    }
    if (pLabel && (isNaN(pGrams) || pGrams <= 0 || pGrams > 5000)) {
      err.textContent = "Poids de portion invalide (ex : 50).";
      err.hidden = false;
      return;
    }
    err.hidden = true;
    data.portion = pLabel ? { label: pLabel.slice(0, 30), grams: round1(pGrams) } : null;

    var wasEditing = !!foodsEditState.editingId;
    if (wasEditing) updateFoodRecord(foodsEditState.editingId, data);
    else createFood(data);

    closeFoodEditForm();
    refreshFoodsPanel();
    showToast(wasEditing ? "Aliment modifié" : "« " + data.name + " » ajouté à ta base");
  }

  /* ---------------------------------------------------------
     Liste de courses de la semaine
     Partie de ce que tu manges vraiment (journal des 14 derniers
     jours) : quantité moyenne par jour de chaque aliment, puis mise
     à l'échelle de tes cibles des prochains jours (montée progressive
     comprise). Les aliments protéinés sont ajustés pour atteindre tes
     protéines, les autres pour compléter les calories. Pas de recettes,
     pas de repas imposés : seulement tes aliments.
     --------------------------------------------------------- */

  var STORAGE_SHOP_CHECKED = "nl_shop_checked_v1";
  var STORAGE_SHOP_CUSTOM = "nl_shop_custom_v1";
  var SHOP_WINDOW_DAYS = 14;
  var SHOP_MIN_DAYS = 3;
  var shopState = { days: 7, list: null };

  // Liste de départ quand le journal est encore trop court (grammes par jour).
  var SHOP_STARTER = [
    { id: "d-boeufhache", g: 200 }, { id: "d-poulet", g: 150 }, { id: "d-fromageblanc", g: 400 },
    { id: "d-oeuf", g: 100 }, { id: "d-riz", g: 200 }, { id: "d-avoine", g: 60 },
    { id: "d-banane", g: 120 }, { id: "d-huileolive", g: 20 }, { id: "d-brocoli", g: 250 }
  ];

  // Poudres et compléments : proposés seulement si tu en utilises déjà.
  function isSupplement(name) {
    return /whey|prot[ée]ine en poudre|poudre|isolat|cas[ée]ine/i.test(name);
  }

  // Quantité maximale raisonnable par jour pour un seul aliment.
  function dailyCap(p, name) {
    if (isSupplement(name)) return 60;
    if (p.fat >= 50) return 40;
    if (isProteinFood(p)) return p.kcal < 80 ? 500 : 300;
    return 450;
  }

  function isProteinFood(p) {
    return p.kcal > 0 && p.protein >= 8 && (p.protein * KCAL_PER_G.protein) / p.kcal >= 0.3;
  }

  function shopCategory(p, name) {
    if (isProteinFood(p)) return "Protéines";
    if (p.fat >= 50) return "Matières grasses";
    if (p.carbs >= 40) return "Féculents & céréales";
    if (p.kcal < 120 || /l[ée]gume|fruit|pomme|banane|salade|tomate|carotte|courgette|brocoli|haricot vert|épinard/i.test(name)) return "Fruits & légumes";
    return "Autres";
  }

  var SHOP_ORDER = ["Protéines", "Féculents & céréales", "Fruits & légumes", "Matières grasses", "Autres"];

  function weekStartKey() {
    var d = new Date();
    var day = (d.getDay() + 6) % 7; // lundi = 0
    return dateKeyFromDate(addDays(d, -day));
  }

  // Quantités moyennes par jour, depuis le journal.
  function averageDailyFoods() {
    var history = loadHistory();
    var foods = loadFoods();
    var today = todayKey();
    var agg = {};
    var nDays = 0;
    for (var i = 0; i < SHOP_WINDOW_DAYS; i++) {
      var key = dateKeyFromDate(addDays(parseDateKey(today), -i));
      var r = history[key];
      if (!r || !r.entries.length) continue;
      nDays++;
      for (var j = 0; j < r.entries.length; j++) {
        var e = r.entries[j];
        if (!e.grams || e.grams <= 0) continue;
        var per100 = e.per100 || { kcal: e.kcal / e.grams * 100, protein: e.protein / e.grams * 100, fat: e.fat / e.grams * 100, carbs: e.carbs / e.grams * 100 };
        var id = e.foodId || ("n:" + normalizeText(e.name));
        if (!agg[id]) {
          var food = e.foodId ? findFoodById(foods, e.foodId) : null;
          agg[id] = { id: id, name: food ? food.name : e.name, per100: per100, grams: 0, portion: food && food.portion ? food.portion : null };
        }
        agg[id].grams += e.grams;
      }
    }
    var items = [];
    for (var k in agg) {
      if (!agg.hasOwnProperty(k)) continue;
      agg[k].daily = agg[k].grams / Math.max(1, nDays);
      if (agg[k].daily >= 5) items.push(agg[k]);
    }
    return { items: items, days: nDays };
  }

  function starterItems() {
    var foods = loadFoods();
    var out = [];
    for (var i = 0; i < SHOP_STARTER.length; i++) {
      var f = findFoodById(foods, SHOP_STARTER[i].id);
      if (!f) continue;
      out.push({ id: f.id, name: f.name, per100: { kcal: f.kcal, protein: f.protein, fat: f.fat, carbs: f.carbs }, daily: SHOP_STARTER[i].g, portion: f.portion || null });
    }
    return out;
  }

  function plannedTargets(profile, days) {
    var kcal = 0, prot = 0;
    for (var i = 0; i < days; i++) {
      var t = targetsForDay(profile, dateKeyFromDate(addDays(new Date(), i)));
      kcal += t.kcal; prot += t.protein;
    }
    return { kcal: kcal / days, protein: prot / days };
  }

  function buildShoppingList(days) {
    var profile = readJSON(STORAGE_PROFILE);
    if (!profile) return null;
    var avg = averageDailyFoods();
    var fromJournal = avg.days >= SHOP_MIN_DAYS && avg.items.length > 0;
    var items = fromJournal ? avg.items : starterItems();
    var target = plannedTargets(profile, days);

    function sumOf(list, key, scale) {
      var s = 0;
      for (var i = 0; i < list.length; i++) s += list[i].per100[key] * list[i].daily / 100 * (scale || 1);
      return s;
    }

    var protItems = items.filter(function (it) { return isProteinFood(it.per100); });
    var otherItems = items.filter(function (it) { return !isProteinFood(it.per100); });
    var protFromOthers = sumOf(otherItems, "protein");
    var protFromP = sumOf(protItems, "protein");
    var sP = protFromP > 0 ? Math.max(0.8, Math.min(3, (target.protein - protFromOthers) / protFromP)) : 1;

    // Chaque aliment protéiné garde une quantité raisonnable (pas 600 g de viande par jour).
    protItems.forEach(function (it) {
      it.scaled = Math.min(it.daily * sP, Math.max(it.daily, dailyCap(it.per100, it.name)));
    });
    function protOf(list) {
      var s = 0;
      list.forEach(function (it) { s += it.per100.protein * (it.scaled !== undefined ? it.scaled : it.daily) / 100; });
      return s;
    }

    // Il manque encore des protéines : on ajoute d'autres aliments protéinés
    // de ta base, différents de ceux que tu prends déjà, pour varier.
    var extras = [];
    var protGap = target.protein - protFromOthers - protOf(protItems);
    if (protGap > 15) {
      var have = {};
      items.forEach(function (it) { have[it.id] = true; });
      var usage = loadUsage();
      var lean = loadFoods().filter(function (f) {
        return !have[f.id] && isProteinFood(f) && (!isSupplement(f.name) || usage[f.id]);
      });
      lean.sort(function (a, b) { return ((usage[b.id] || 0) * 3 + b.protein / 10) - ((usage[a.id] || 0) * 3 + a.protein / 10); });
      for (var x = 0; x < lean.length && protGap > 15 && extras.length < 3; x++) {
        var f = lean[x];
        var per = { kcal: f.kcal, protein: f.protein, fat: f.fat, carbs: f.carbs };
        var g = Math.min(dailyCap(per, f.name), protGap / f.protein * 100);
        if (g < 30) continue;
        extras.push({ id: f.id, name: f.name, per100: per, daily: g, portion: f.portion || null, added: true });
        protGap -= f.protein * g / 100;
      }
    }

    var kcalFixed = 0;
    protItems.forEach(function (it) { kcalFixed += it.per100.kcal * it.scaled / 100; });
    kcalFixed += sumOf(extras, "kcal");
    var kcalOthers = sumOf(otherItems, "kcal");
    var sK = kcalOthers > 0 ? Math.max(0.7, Math.min(3, (target.kcal - kcalFixed) / kcalOthers)) : 1;

    var all = [];
    protItems.forEach(function (it) { all.push({ it: it, daily: it.scaled }); });
    otherItems.forEach(function (it) { all.push({ it: it, daily: Math.min(it.daily * sK, Math.max(it.daily, dailyCap(it.per100, it.name))) }); });
    extras.forEach(function (it) { all.push({ it: it, daily: it.daily }); });

    var planned = { kcal: 0, protein: 0 };
    var groups = {};
    all.forEach(function (row) {
      var it = row.it;
      planned.kcal += it.per100.kcal * row.daily / 100;
      planned.protein += it.per100.protein * row.daily / 100;
      var total = row.daily * days;
      var qty;
      var nPortions = it.portion && it.portion.grams > 0 ? Math.max(1, Math.ceil(total / it.portion.grams)) : 0;
      if (nPortions && nPortions <= 24) {
        qty = nPortions + " × " + it.portion.label;
      } else if (total >= 1000) {
        qty = fmtNum(Math.round(total / 100) / 10) + " kg";
      } else {
        qty = Math.max(50, Math.round(total / 50) * 50) + " g";
      }
      var cat = shopCategory(it.per100, it.name);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push({ key: it.id, name: it.name, qty: qty, perDay: round(row.daily), added: !!it.added });
    });

    var hasVeg = all.some(function (row) { return row.it.per100.kcal < 60 && !isProteinFood(row.it.per100); });
    if (!hasVeg) {
      if (!groups["Fruits & légumes"]) groups["Fruits & légumes"] = [];
      groups["Fruits & légumes"].push({ key: "veg", name: "Légumes au choix (frais ou surgelés)", qty: "≈ " + fmtNum(Math.round(0.3 * days * 10) / 10) + " kg", perDay: 300, added: true });
    }
    for (var c in groups) {
      if (groups.hasOwnProperty(c)) groups[c].sort(function (a, b) { return a.name.localeCompare(b.name, "fr"); });
    }

    return {
      fromJournal: fromJournal,
      journalDays: avg.days,
      target: { kcal: round(target.kcal), protein: round(target.protein) },
      planned: { kcal: round(planned.kcal), protein: round(planned.protein) },
      groups: groups
    };
  }

  function loadShopChecked() {
    var all = readJSON(STORAGE_SHOP_CHECKED) || {};
    return all[weekStartKey()] || {};
  }

  function saveShopChecked(map) {
    var all = {};
    all[weekStartKey()] = map; // seule la semaine en cours est gardée
    writeJSON(STORAGE_SHOP_CHECKED, all);
  }

  function refreshShopping() {
    var profile = readJSON(STORAGE_PROFILE);
    $("shopNoProfile").hidden = !!profile;
    $("shopContent").hidden = !profile;
    if (!profile) return;

    var list = buildShoppingList(shopState.days);
    shopState.list = list;
    var checked = loadShopChecked();
    $("shopDays").value = String(shopState.days);

    $("shopNote").textContent = (list.fromJournal
      ? "D'après tes " + list.journalDays + " derniers jours de journal, "
      : "Ton journal est encore trop court (moins de " + SHOP_MIN_DAYS + " jours) : liste de départ, ") +
      "ajustée à " + list.target.kcal.toLocaleString("fr-FR") + " kcal et " + list.target.protein + " g de protéines par jour. " +
      "Cette liste couvre environ " + list.planned.kcal.toLocaleString("fr-FR") + " kcal et " + list.planned.protein + " g de protéines par jour.";

    var html = "";
    SHOP_ORDER.forEach(function (cat) {
      var rows = list.groups[cat];
      if (!rows || !rows.length) return;
      html += '<h3 class="shop-cat">' + escapeHtml(cat) + '</h3><ul class="shop-list">';
      rows.forEach(function (row) {
        var id = "shop_" + escapeHtml(row.key.replace(/[^A-Za-z0-9_-]/g, "_"));
        var on = !!checked[row.key];
        html +=
          '<li class="shop-item' + (on ? ' shop-done' : '') + '">' +
            '<label class="shop-label" for="' + id + '">' +
              '<input type="checkbox" id="' + id + '" data-shop="' + escapeHtml(row.key) + '"' + (on ? ' checked' : '') + '>' +
              '<span class="shop-name">' + escapeHtml(row.name) +
                (row.added ? ' <span class="shop-badge">pour tes cibles</span>' : '') +
                '<span class="shop-perday">≈ ' + row.perDay + ' g par jour</span>' +
              '</span>' +
              '<span class="shop-qty">' + escapeHtml(row.qty) + '</span>' +
            '</label>' +
          '</li>';
      });
      html += '</ul>';
    });

    var custom = readJSON(STORAGE_SHOP_CUSTOM) || [];
    if (custom.length) {
      html += '<h3 class="shop-cat">Ajouts perso</h3><ul class="shop-list">';
      custom.forEach(function (c) {
        var on = !!checked["c:" + c.id];
        html +=
          '<li class="shop-item' + (on ? ' shop-done' : '') + '">' +
            '<label class="shop-label">' +
              '<input type="checkbox" data-shop="c:' + escapeHtml(c.id) + '"' + (on ? ' checked' : '') + '>' +
              '<span class="shop-name">' + escapeHtml(c.text) + '</span>' +
            '</label>' +
            '<button type="button" class="food-del" data-shop-del="' + escapeHtml(c.id) + '" aria-label="Retirer ' + escapeHtml(c.text) + '">×</button>' +
          '</li>';
      });
      html += '</ul>';
    }
    $("shopLists").innerHTML = html;

    var boxes = $("shopLists").querySelectorAll("[data-shop]");
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].addEventListener("change", function (ev) {
        var map = loadShopChecked();
        var key = ev.currentTarget.getAttribute("data-shop");
        if (ev.currentTarget.checked) map[key] = true; else delete map[key];
        saveShopChecked(map);
        ev.currentTarget.closest(".shop-item").classList.toggle("shop-done", ev.currentTarget.checked);
      });
    }
    var dels = $("shopLists").querySelectorAll("[data-shop-del]");
    for (var d = 0; d < dels.length; d++) {
      dels[d].addEventListener("click", function (ev) {
        var id = ev.currentTarget.getAttribute("data-shop-del");
        withUndo([STORAGE_SHOP_CUSTOM], "Article retiré", function () {
          writeJSON(STORAGE_SHOP_CUSTOM, (readJSON(STORAGE_SHOP_CUSTOM) || []).filter(function (c) { return c.id !== id; }));
        }, refreshShopping);
      });
    }
  }

  function shoppingText() {
    var list = shopState.list;
    if (!list) return "";
    var lines = ["Courses NaturaLift — " + shopState.days + " jours", ""];
    SHOP_ORDER.forEach(function (cat) {
      var rows = list.groups[cat];
      if (!rows || !rows.length) return;
      lines.push(cat.toUpperCase());
      rows.forEach(function (r) { lines.push("☐ " + r.name + " — " + r.qty); });
      lines.push("");
    });
    var custom = readJSON(STORAGE_SHOP_CUSTOM) || [];
    if (custom.length) {
      lines.push("AJOUTS PERSO");
      custom.forEach(function (c) { lines.push("☐ " + c.text); });
    }
    return lines.join("\n").trim();
  }

  function shareShopping() {
    var text = shoppingText();
    if (nativeApp() && nativeCall(function (n) { return n.share(text); })) return;
    if (navigator.share) {
      navigator.share({ title: "Liste de courses", text: text }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast("Liste copiée"); }, function () { uiAlert(text); });
      return;
    }
    uiAlert(text);
  }

  function setupShopping() {
    $("shopDays").addEventListener("change", function () {
      shopState.days = parseInt($("shopDays").value, 10) || 7;
      refreshShopping();
    });
    $("shopShare").addEventListener("click", shareShopping);
    $("shopReset").addEventListener("click", function () {
      withUndo([STORAGE_SHOP_CHECKED], "Cases décochées", function () { saveShopChecked({}); }, refreshShopping);
    });
    $("shopAddForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var text = $("shopAddInput").value.trim().slice(0, 80);
      if (!text) return;
      var custom = readJSON(STORAGE_SHOP_CUSTOM) || [];
      custom.push({ id: genId("shop"), text: text });
      writeJSON(STORAGE_SHOP_CUSTOM, custom);
      $("shopAddInput").value = "";
      refreshShopping();
    });
    $("goToCalcFromShop").addEventListener("click", openSettings);
  }

  /* ---------------------------------------------------------
     Navigation (barre du bas)
     --------------------------------------------------------- */

  var TAB_PANELS = { track: "panel-track", history: "panel-history", weight: "panel-weight", shop: "panel-shop", foods: "panel-foods" };
  var activeTab = "track";

  function refreshActiveTab() {
    if (activeTab === "track") refreshTracker();
    if (activeTab === "history") refreshHistory();
    if (activeTab === "weight") refreshWeightPanel();
    if (activeTab === "shop") refreshShopping();
    if (activeTab === "foods") {
      refreshFoodsPanel();
      refreshFavoritesManage();
      refreshBackupInfo();
    }
  }

  function switchTab(tabName) {
    // Re-toucher "Aujourd'hui" quand on y est déjà ramène à aujourd'hui.
    if (tabName === "track" && activeTab === "track" && trackState.dateKey) trackState.dateKey = null;

    var items = document.querySelectorAll(".nav-item");
    for (var i = 0; i < items.length; i++) {
      var isActive = items[i].getAttribute("data-tab") === tabName;
      items[i].classList.toggle("active", isActive);
      if (isActive) items[i].setAttribute("aria-current", "page");
      else items[i].removeAttribute("aria-current");
    }

    for (var key in TAB_PANELS) {
      if (!TAB_PANELS.hasOwnProperty(key)) continue;
      var panelEl = $(TAB_PANELS[key]);
      var isTarget = key === tabName;
      panelEl.hidden = !isTarget;
      panelEl.classList.toggle("active", isTarget);
    }

    if (tabName === "foods" && activeTab !== "foods") closeFoodEditForm();
    activeTab = tabName;
    hideToast();
    refreshActiveTab();
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------
     Initialisation
     --------------------------------------------------------- */

  function init() {
    migrateLegacyLog();
    loadFoods();
    seedDefaultPortions();
    setupDialog();
    setupToast();

    $("calcForm").addEventListener("submit", handleCalcSubmit);
    $("job").addEventListener("change", updateActivityHint);
    $("sessions").addEventListener("change", updateActivityHint);
    updateActivityHint();
    setupSleep();
    setupShopping();
    $("resetDay").addEventListener("click", handleResetDay);
    $("creatineBtn").addEventListener("click", toggleCreatine);
    $("rampEnabled").addEventListener("change", function () {
      $("rampFields").hidden = !$("rampEnabled").checked;
      saveRampFromForm();
    });
    $("rampStart").addEventListener("change", saveRampFromForm);
    $("rampStep").addEventListener("change", saveRampFromForm);
    $("healthBtn").addEventListener("click", function () {
      healthState.requested = true;
      nativeCall(function (n) { n.requestHealth(); });
    });
    $("stepsAdjust").addEventListener("change", function () {
      var profile = readJSON(STORAGE_PROFILE);
      if (!profile) return;
      profile.stepsAdjust = $("stepsAdjust").checked;
      writeJSON(STORAGE_PROFILE, profile);
      syncHealth(true);
      if (!profile.stepsAdjust) {
        var history = loadHistory();
        if (history[todayKey()]) { delete history[todayKey()].stepsBonus; saveHistory(history); }
      }
    });
    // L'appli Android prévient quand elle revient au premier plan ou
    // qu'une permission change : on resynchronise.
    window.addEventListener("naturalift-native", function () {
      // Retour de la fenêtre d'autorisation Samsung Health : si rien n'a été
      // accordé (fenêtre refermée tout de suite), on propose la voie manuelle.
      if (healthState.requested) {
        healthState.requested = false;
        var st = healthStatus();
        if (st === "ok") {
          syncHealth(true);
          showToast("Samsung Health connecté");
        } else if (st === "no_permission") {
          offerHealthSettings("L'autorisation n'a pas été accordée.");
        }
      }
      syncHealth(false);
      checkForUpdate();
      refreshNativeSummary();
      var profile = readJSON(STORAGE_PROFILE);
      if (profile && !$("settingsOverlay").hidden) {
        renderHealthBlock(profile);
        renderRemindersBlock();
      }
    });
    $("copyPrevDay").addEventListener("click", handleCopyPrevDay);
    $("scannerClose").addEventListener("click", closeScanner);

    var photoCtrl = setupPhotoCapture({
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
      gramsLabel: $("foodGramsLabel"),
      unitRow: $("unitRow"),
      unitPortion: $("unitPortion"),
      unitGrams: $("unitGrams"),
      unitPortionLabel: $("unitPortionLabel"),
      totalPreview: $("foodTotalPreview"),
      dbSubmitBtn: $("dbAddSubmit"),
      manualFields: { name: $("foodName"), kcal: $("foodKcal"), protein: $("foodProtein"), fat: $("foodFat"), carbs: $("foodCarbs") },
      photoCtrl: photoCtrl,
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
        portionBtn: $("scanPortionBtn"),
        saveToDbCheckbox: $("scanSaveToDb"),
        incompleteEl: $("scanIncomplete"),
        barcodeLabelEl: $("scanBarcodeLabel"),
        sourceChipEl: $("scanSourceChip")
      },
      getDateKey: function () { var r = ensureDayRecord(currentDayKey()); return r ? r.date : null; },
      onAdded: refreshTracker
    });

    // Navigation entre les jours
    $("dayPrev").addEventListener("click", function () {
      setTrackDay(dateKeyFromDate(addDays(parseDateKey(currentDayKey()), -1)));
    });
    $("dayNext").addEventListener("click", function () {
      setTrackDay(dateKeyFromDate(addDays(parseDateKey(currentDayKey()), 1)));
    });
    $("dayToday").addEventListener("click", function () { setTrackDay(null); });

    var dayTypes = { dayTypeRest: "rest", dayTypeNeutral: "neutral", dayTypeTraining: "training" };
    Object.keys(dayTypes).forEach(function (id) {
      $(id).addEventListener("change", function () {
        setDayType(currentDayKey(), dayTypes[id]);
        refreshTracker();
      });
    });

    $("hydrationPlus").addEventListener("click", function () {
      var r = ensureDayRecord(currentDayKey()); if (r) { addWater(r.date, 250); refreshTracker(); }
    });
    $("hydrationMinus").addEventListener("click", function () {
      var r = ensureDayRecord(currentDayKey()); if (r) { addWater(r.date, -250); refreshTracker(); }
    });

    $("saveAsFavorite").addEventListener("click", handleSaveAsFavorite);

    $("entrySheetForm").addEventListener("submit", handleEntrySave);
    $("entryCancel").addEventListener("click", closeEntryEditor);
    $("entryDelete").addEventListener("click", handleEntryDelete);
    $("entryUnitPortion").addEventListener("change", onEntryUnitChange);
    $("entryUnitGrams").addEventListener("change", onEntryUnitChange);
    $("entryQty").addEventListener("input", updateEntryPreview);
    $("entrySheet").addEventListener("click", function (e) {
      if (e.target === $("entrySheet")) closeEntryEditor();
    });
    $("measurementsForm").addEventListener("submit", handleMeasurementsSubmit);

    // Historique : Liste / Calendrier / Bilans
    var historyViews = { viewList: "list", viewCalendar: "calendar", viewStats: "stats" };
    Object.keys(historyViews).forEach(function (id) {
      $(id).addEventListener("change", function () {
        historyState.mode = historyViews[id];
        refreshHistory();
      });
    });

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
    $("weightDate").addEventListener("change", syncWeightFormToDate);
    $("weightGoToCalc").addEventListener("click", openSettings);
    $("profileWeightSyncBtn").addEventListener("click", handleProfileWeightSync);

    $("exportDataBtn").addEventListener("click", exportAllData);
    $("importDataBtn").addEventListener("click", function () { $("importDataFile").click(); });
    $("importDataFile").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) importAllData(file);
      e.target.value = "";
    });

    var navItems = document.querySelectorAll(".nav-item");
    for (var i = 0; i < navItems.length; i++) {
      navItems[i].addEventListener("click", function (ev) {
        switchTab(ev.currentTarget.getAttribute("data-tab"));
      });
    }

    $("openSettingsBtn").addEventListener("click", openSettings);
    $("goToCalcFromTrack").addEventListener("click", openSettings);
    $("settingsClose").addEventListener("click", closeSettings);
    $("goToTracker").addEventListener("click", function () {
      closeSettings();
      setTrackDay(null);
      switchTab("track");
    });
    $("tdeeUseBtn").addEventListener("click", handleTdeeUse);
    $("tdeeResetBtn").addEventListener("click", handleTdeeReset);

    switchTab("track");

    // Premier lancement : on ouvre directement le profil.
    if (!readJSON(STORAGE_PROFILE)) openSettings();

    // Demande au navigateur de ne pas effacer les données de l'appli
    // quand l'espace manque (accordé d'office aux PWA installées).
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () { /* non bloquant */ });
    }

    // Pas de service worker dans l'appli Android : les fichiers sont déjà dans l'APK.
    if ("serviceWorker" in navigator && !nativeApp()) {
      window.addEventListener("load", function () {
        var swUrl = new URL("sw.js", document.baseURI).href;
        navigator.serviceWorker.register(swUrl).catch(function () {
          // Échec silencieux : l'appli reste utilisable en ligne.
        });
      });
    }

    // Appli Android : Samsung Health et mises à jour au démarrage.
    syncHealth(true);
    checkForUpdate();

    // Retour sur l'appli (ex : le lendemain matin) : on rafraîchit.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && $("settingsOverlay").hidden) refreshActiveTab();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
