/* =========================================================
   NaturaLift — Service Worker

   Mise à jour : plus besoin de changer ?v=N dans index.html.
   Le HTML, le CSS et le JS sont toujours redemandés au réseau
   (en contournant le cache du navigateur) ; le cache ne sert
   que hors-ligne. Change CACHE_NAME seulement si tu veux faire
   le ménage dans les anciens caches (ex : après avoir renommé
   ou supprimé un fichier).
   ========================================================= */

var CACHE_NAME = "naturalift-v13";

// Chemins relatifs uniquement : indispensable pour un déploiement
// GitHub Pages sous <username>.github.io/<repo>/.
var APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json"
];

var STATIC_ASSETS = [
  "./icon-192.png",
  "./icon-512.png",
  "./icon-192-maskable.png",
  "./icon-512-maskable.png"
];

self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL.concat(STATIC_ASSETS));
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function isStaticAsset(url) {
  for (var i = 0; i < STATIC_ASSETS.length; i++) {
    if (url.indexOf(STATIC_ASSETS[i].replace("./", "")) !== -1) return true;
  }
  return false;
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var url = request.url;

  // Requêtes externes (bibliothèque du scanner, API Open Food Facts) :
  // on laisse le navigateur les gérer normalement — sinon un appel
  // JSON échoué hors-ligne renverrait la page HTML par erreur.
  if (url.indexOf(self.location.origin) !== 0) {
    return;
  }

  // Icônes : cache d'abord, elles ne changent jamais.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(function (cached) {
        return cached || fetch(request).then(function (response) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
          return response;
        });
      })
    );
    return;
  }

  // HTML / CSS / JS : réseau d'abord ("no-cache" = le navigateur
  // revérifie auprès de GitHub Pages au lieu de servir une vieille
  // copie), avec repli sur le cache hors-ligne. Les paramètres
  // d'URL sont ignorés pour retrouver la bonne copie en cache.
  event.respondWith(
    fetch(url, { cache: "no-cache", credentials: "same-origin" })
      .then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      })
      .catch(function () {
        return caches.match(request, { ignoreSearch: true }).then(function (cached) {
          return cached || caches.match("./index.html");
        });
      })
  );
});
