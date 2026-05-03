const CACHE_NAME = 'vtrombone-cache-v1';
const urlsToCache = [
	'./',
	'./index.html',
	'./styles.css',
	'./app.js',
	'./manifest.json',
	'./favicon.png',
];

// インストール時にファイルをキャッシュ
self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => {
			return cache.addAll(urlsToCache);
		}),
	);
});

// ネットワークリクエストをインターセプト（オフライン対応）
self.addEventListener('fetch', (event) => {
	event.respondWith(
		caches.match(event.request).then((response) => {
			// キャッシュにあればそれを返す、なければネットワークから取得
			return response || fetch(event.request);
		}),
	);
});

// 新しいバージョンになった際に古いキャッシュを削除
self.addEventListener('activate', (event) => {
	const cacheWhitelist = [CACHE_NAME];
	event.waitUntil(
		caches.keys().then((cacheNames) => {
			return Promise.all(
				cacheNames.map((cacheName) => {
					if (cacheWhitelist.indexOf(cacheName) === -1) {
						return caches.delete(cacheName);
					}
				}),
			);
		}),
	);
});
