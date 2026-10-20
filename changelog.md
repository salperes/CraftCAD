---------------------------------------------------------
Rev. ID    : 9
Version    : 0.3.1
Rev. Date  : 20.10.2026
Rev. Time  : 06:48:18
Rev. Prompt: Uygulamanın kendisine changelog ve versiyonlama ekleyelim (MSS/mds/versioning.md yönergesi)

Rev. Report: (
- Client: Sürüm başlık çubuğunda gösteriliyor; uygulama menüsüne "About CraftCAD" ve "What's New" eklendi
- Client: ABOUT komutu; changelog.md uygulama içinde okunabiliyor
- Server: /api/health uç noktası {status, version, converter} döndürüyor
- Docs: changelog.md, CLAUDE.md (Mevcut Versiyon), versiyonlama kuralları
)
---------------------------------------------------------
Rev. ID    : 8
Version    : 0.3.0
Rev. Date  : 20.10.2026
Rev. Time  : — (geriye dönük kayıt)
Rev. Prompt: DWG save (AutoCAD 2018) desteği ekleyelim; ODA File Converter ile de olur

Rev. Report: (
- Server: server/convert.mjs — ODA File Converter (tercih) veya AutoCAD Core Console ile DXF↔DWG dönüştürme
- Server: /api/convert ve /api/convert/status; Vite dev/preview eklentisi; npm run serve (dist + API)
- Client: "Save Drawing As" penceresi — DWG 2018/2013/2010/2007/2004/2000, DXF 2018, DXF R2000
- Client: QSAVE açılan DWG'yi aynı sürümde kaydediyor; DWG açma dönüştürücü varsa onunla (LibreDWG yedek)
- Test: ODA ve Core Console ile kaydedilen DWG'ler AutoCAD'de doğrulandı
)
---------------------------------------------------------
Rev. ID    : 7
Version    : 0.2.5
Rev. Date  : 20.10.2026
Rev. Time  : — (geriye dönük kayıt)
Rev. Prompt: Obj. snap yatay-dikey iz düşümü de dashed ile locklasın

Rev. Report: (
- Client: Object Snap Tracking (OTRACK, F11) — nokta yakalama, yatay/dikey hizalar, kesişimler
- Client: Polar/ortho izleme ile kesişim; iz çizgisi üzerinde mesafe girişi; durum çubuğu düğmesi ve DSETTINGS seçeneği
)
---------------------------------------------------------
Rev. ID    : 6
Version    : 0.2.4
Rev. Date  : 20.10.2026
Rev. Time  : — (geriye dönük kayıt)
Rev. Prompt: Yaptığım ayarlar kalıcı olsun (örn. cursorsize gibi)

Rev. Report: (
- Client: Kullanıcı ayarları localStorage'da (CURSORSIZE, APERTURE, OSMODE, ORTHO/POLAR, GRID/SNAP, DYN, palet, son komutlar)
)
---------------------------------------------------------
Rev. ID    : 5
Version    : 0.2.3
Rev. Date  : 20.10.2026
Rev. Time  : — (geriye dönük kayıt)
Rev. Prompt: Sağ tuş ile CraftCAD menüsü ve browser sağ tuş menüsü açılıyor; canvas içinde browser menüsü açılmamalı

Rev. Report: (
- Client: Tarayıcı sağ tık menüsü metin alanları dışında engelleniyor
)
---------------------------------------------------------
Rev. ID    : 4
Version    : 0.2.2
Rev. Date  : 19.10.2026
Rev. Time  : — (geriye dönük kayıt)
Rev. Prompt: DWG açılırken "both async and sync fetching of the wasm failed" hatası

Rev. Report: (
- Client: LibreDWG wasm yolu Vite tarafından çözülen açık URL ile veriliyor (src/io/dwg.ts)
- Client: Sunucuya ulaşılamazsa anlaşılır hata mesajı
)
---------------------------------------------------------
Rev. ID    : 3
Version    : 0.2.1
Rev. Date  : 19.10.2026
Rev. Time  : — (geriye dönük kayıt)
Rev. Prompt: Performans problemi var, pan-zoom çok yavaş; WebGL işi hızlandırır mı

Rev. Report: (
- Client: WebGL katmanı — düz çizgi tipli eğriler GPU tamponunda; pan kare başına 96 ms → 8 ms
- Client: Canvas 2D toplu çizim, stil ve spline önbelleği; seçim vurgusu ayrı katmanda
)
---------------------------------------------------------
Rev. ID    : 2
Version    : 0.2.0
Rev. Date  : 19.10.2026
Rev. Time  : — (geriye dönük kayıt)
Rev. Prompt: PLOT, CURSORSIZE, SNAP, GRID komutları; hatch ve block editor; sağ tuş fonksiyonları; annotation editor

Rev. Report: (
- Client: PLOT (PDF/PNG), GRID, SNAP, SETVAR ve sistem değişkenleri, DSETTINGS
- Client: Zengin MTEXT editörü ve "Text Editor" sekmesi, Dimension Style Manager
- Client: Hatch Creation/Editor sekmeleri, HATCHEDIT; Block Editor (BEDIT/BSAVE/BCLOSE/BASE)
- Client: Bağlama göre sağ tık menüleri, Snap Overrides, QSELECT, SELECTSIMILAR, DRAWORDER, PASTEBLOCK/PASTEORIG
)
---------------------------------------------------------
Rev. ID    : 1
Version    : 0.1.0
Rev. Date  : 19.10.2026
Rev. Time  : 23:16:09
Rev. Prompt: 2D çizim için hafif, web tabanlı, AutoCAD komutları, benzer ikonlar ve hissiyatla; DWG/DXF okuma yazma

Rev. Report: (
- Client: Şerit menü, komut satırı, ~70 AutoCAD komutu ve kısayolu, OSNAP/ORTHO/POLAR, grip'ler, katmanlar
- Client: DXF okuma/yazma (R2000), LibreDWG ile DWG okuma
- Test: Birim ve DXF gidiş-dönüş testleri, AutoCAD Core Console doğrulaması
)
---------------------------------------------------------
