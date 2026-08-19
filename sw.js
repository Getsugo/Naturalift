/* =========================================================
   NaturaLift — Service Worker
   IMPORTANT : incrémenter CACHE_NAME (naturalift-vN) et le paramètre
   ?v=N sur style.css / app.js dans index.html à CHAQUE déploiement,
   sinon les anciens fichiers restent servis depuis le cache.
   ========================================================= */

var CACHE_NAME = "naturalift-v11";

// Chemins relatifs uniquement : indispensable pour un déploiement
// GitHub Pages sous <username>.github.io/<repo>/.
var APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=11",
  "./app.js?v=11",
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

  // Requêtes externes (bibliothèque du scanner sur unpkg.com, API Open
  // Food Facts) : elles ne font pas partie de l'app shell et nécessitent
  // une connexion réseau de toute façon. On laisse le navigateur les
  // gérer normalement, sans interception ni repli sur index.html — sinon
  // un fetch JSON échoué en offline renverrait la page HTML par erreur.
  if (url.indexOf(self.location.origin) !== 0) {
    return;
  }

  // Icônes / assets statiques : cache-first, ils ne changent jamais entre
  // deux versions (nom de fichier stable).
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(function (cached) {
        return cached || fetch(request).then(function (response) {
          return caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, response.clone());
            return response;
          });
        });
      })
    );
    return;
  }

  // App shell (HTML / CSS / JS) : network-first pour toujours servir la
  // dernière version publiée, avec repli sur le cache hors-ligne.
  event.respondWith(
    fetch(request)
      .then(function (response) {
        var responseClone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, responseClone);
        });
        return response;
      })
      .catch(function () {
        return caches.match(request).then(function (cached) {
          return cached || caches.match("./index.html");
        });
      })
  );
});
