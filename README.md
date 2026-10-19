# CraftCAD

AutoCAD komutları, kısayolları ve çalışma hissiyle web tabanlı, hafif bir 2B CAD uygulaması.
DXF okur ve yazar (AutoCAD R2000 / AC1015), DWG okur (LibreDWG, WebAssembly).

## Çalıştırma

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/ klasörüne statik site
npm test           # geometri, düzenleme algoritmaları ve DXF gidiş-dönüş testleri
```

Node.js 22.19+ veya 24.11+ gerekir.

## Neler var

**Arayüz:** Şerit menü (Home, Insert, Annotate, View, Manage), yüzen komut satırı (geçmiş,
tıklanabilir seçenekler, otomatik tamamlama), dinamik giriş balonu, durum çubuğu, katman
yöneticisi, özellikler paleti (Ctrl+1), sağ tık menüsü, sürükle-bırak ile dosya açma.

**Çizim:** LINE (L), PLINE (PL, yay modu dahil), CIRCLE (C: merkez/yarıçap, çap, 2P, 3P, TTR),
ARC (A), RECTANG (REC), POLYGON (POL), ELLIPSE (EL), SPLINE (SPL), POINT (PO), HATCH (H, iç nokta
seçerek veya nesne seçerek; adalar desteklenir).

**Düzenleme:** ERASE (E), MOVE (M), COPY (CO), ROTATE (RO), SCALE (SC), MIRROR (MI), OFFSET (O),
TRIM (TR), EXTEND (EX), FILLET (F), CHAMFER (CHA), ARRAY (AR, dikdörtgen ve polar), EXPLODE (X),
STRETCH (S), BREAK (BR), JOIN (J), MATCHPROP (MA), grip düzenleme (Space ile
STRETCH, MOVE, ROTATE, SCALE ve MIRROR arasında geçiş).

**Açıklama:** TEXT (DT), MTEXT (T), TEXTEDIT (ED), DIMLINEAR (DLI), DIMALIGNED (DAL), DIMRADIUS
(DRA), DIMDIAMETER (DDI), DIMANGULAR (DAN), MLEADER (MLD). Ölçü stili ISO-25 (virgüllü ondalık).

**Diğer:** UNDO/REDO, ZOOM (Z), PAN (P), LAYER (LA), BLOCK (B), INSERT (I), DIST (DI), AREA, LIST,
ID, PURGE, OSNAP, LTSCALE, kopyala/yapıştır (Ctrl+C / Ctrl+V), HELP (F1).

**Girdi:** `x,y`, `@dx,dy`, `uzunluk<açı`, `@uzunluk<açı`, doğrudan mesafe girişi; F3 OSNAP,
F7 GRID, F8 ORTHO, F9 SNAP, F10 POLAR, F12 DYN; Enter/Space son komutu tekrarlar, Esc iptal eder.

## Bilinen sınırlar

- **DWG yazma yok.** Yayınlanan `@mlightcad/libredwg-web` paketi DWG yazıcısı kapalı derlenmiş.
  DWG açılabiliyor, ama DXF olarak kaydediliyor. DWG yazmak için LibreDWG'nin `--disable-write`
  olmadan Emscripten ile yeniden derlenmesi gerekir (LibreDWG'nin DWG yazıcısı yalnızca R2000
  üretir ve deneysel durumdadır).
- Yalnızca model space destekleniyor; layout ve paper space içeriği okunmuyor.
- MULTILEADER yalnızca metin olarak, ACAD_TABLE blok olarak okunuyor; SHX fontları yerine sistem
  fontu kullanılıyor.

## Lisans

GPL-3.0-or-later. DWG desteği GPLv3 lisanslı LibreDWG'yi kullandığı için uygulamanın tamamı GPL
kapsamında dağıtılmalıdır.

## Testler

- `npm test`: Node üzerinde birim ve DXF gidiş-dönüş testleri. `test/fixtures/` klasörüne DXF
  koyarak ya da dosya yolunu argüman olarak vererek çalıştırılır.
- `test/acad-check.ps1`: Üretilen DXF'leri AutoCAD Core Console ile açıp entity sayılarını
  raporlar (AutoCAD kuruluysa).
- `test/ui-shot.mjs`: Çalışan geliştirme sunucusunu ekransız Chromium'da (Playwright) senaryolarla
  sürer ve `test/out/` klasörüne ekran görüntüsü kaydeder.
