# CraftCAD

AutoCAD komutları, kısayolları ve çalışma hissiyle web tabanlı, hafif bir 2B CAD uygulaması.
DXF okur ve yazar (AutoCAD R2000 / AC1015), DWG okur (LibreDWG veya yerel dönüştürücü) ve yerel
ODA File Converter / AutoCAD ile DWG 2000–2018 kaydeder.

## Çalıştırma

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/ klasörüne derle
npm run serve      # dist/ + DWG dönüştürme API'si, http://localhost:8080
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

**Editörler:** MTEXT ve TEXTEDIT için zengin metin editörü ("Text Editor" bağlamsal sekmesi: kalın,
italik, altı çizili, renk, yükseklik, hizalama, sembol), Hatch Creation / Hatch Editor sekmeleri ve
HATCHEDIT (HE), Block Editor (BEDIT/BE, BSAVE, BCLOSE, BASE), Dimension Style Manager (DIMSTYLE/D).
Çift tıklama metne, taramaya veya bloğa göre ilgili editörü açar.

**Çıktı ve ayarlar:** PLOT (kağıt boyutu, alan, ölçek, monochrome.ctb, DPI; PDF için tarayıcının
yazdırma penceresi veya PNG), GRID, SNAP, DSETTINGS (DS), SETVAR ve sistem değişkenlerinin adlarıyla
doğrudan kullanımı (CURSORSIZE, GRIDUNIT, SNAPUNIT, OSMODE, POLARANG, APERTURE, PDMODE, LTSCALE,
DIMSCALE…).

**Kalıcı ayarlar:** CURSORSIZE, APERTURE, OSMODE, ORTHO/POLAR, GRID/SNAP aralıkları, dinamik
giriş, özellikler paleti ve son komutlar tarayıcıda saklanır, bir sonraki açılışta geri gelir.
Çizime ait değişkenler (LTSCALE, DIMSCALE, ölçü stili…) DXF dosyasına yazılır.

**Sağ tık menüleri:** Komut yokken (Repeat, Recent Input, Clipboard, Undo/Redo, Pan, Zoom…), seçim
varken (Erase, Move, Draw Order, Select Similar, Quick Select, Properties…), komut sırasında (Enter,
Cancel, seçenekler, Snap Overrides) ve grip düzenlerken. Shift+sağ tık snap menüsünü açar; nokta
sorulurken `END`, `MID`, `CEN`, `INT`, `PER`, `TAN`, `NEA`, `NON` yazılarak tek seferlik snap seçilir.

**Diğer:** UNDO/REDO, ZOOM (Z), PAN (P), LAYER (LA), BLOCK (B), INSERT (I), DIST (DI), AREA, LIST,
ID, PURGE, OSNAP, LTSCALE, QSELECT, SELECTSIMILAR, DRAWORDER (DR), kopyala/yapıştır (Ctrl+C /
Ctrl+V, PASTEBLOCK, PASTEORIG), HELP (F1).

**Girdi:** `x,y`, `@dx,dy`, `uzunluk<açı`, `@uzunluk<açı`, doğrudan mesafe girişi; F3 OSNAP,
F7 GRID, F8 ORTHO, F9 SNAP, F10 POLAR, F11 OTRACK, F12 DYN; Enter/Space son komutu tekrarlar, Esc
iptal eder.

**Object Snap Tracking (OTRACK):** Nokta sorulurken bir snap noktasının üzerinde kısa süre beklemek
onu yakalar (`+`). İmleç yakalanan noktanın yatay/dikey hizasına gelince kesik izleme çizgisine
kilitlenir; iki hizanın ya da hizanın polar izleme çizgisiyle kesişimine snap yapılır. İz çizgisi
üzerindeyken sayı yazmak o mesafeyi yakalanan noktadan uygular. Aynı noktada tekrar beklemek onu bırakır.

## Layout'lar (paper space)

Alt kısımdaki **Model | Layout1 | Layout2 | +** sekmeleri AutoCAD'deki gibi çalışır. Layout'ta gri zemin
üzerinde beyaz kağıt ve kesik çizgili yazdırma sınırı görünür; paper space'in orijini yazdırılabilir
alanın sol alt köşesidir ve birimi mm'dir. Antet, not ve ölçüler kağıda bütün komutlarla çizilir.

- **Sekmeler:** tıklayarak geçiş, çift tıkla yeniden adlandırma, sağ tık menüsü (New Layout, Delete,
  Rename, Move Left/Right, Create a Copy, Page Setup Manager, Plot, Activate Model Tab), `+` ile yeni layout.
  İlk kez açılan boş layout'a model çiziminin tamamını gösteren bir viewport otomatik eklenir.
- **Viewport'lar:** `MVIEW` (MV): iki köşe, `Fit` (yazdırma alanı), `2` / `4` bölmeli, `ON`/`OFF`, `Lock`.
  Viewport'lar grip'lerle boyutlandırılır, MOVE/COPY/STRETCH/ERASE ile düzenlenir; özellikler paletinde
  merkez, boyut, açık/kapalı, Display locked, Standard scale ve Custom scale vardır.
- **MSPACE / PSPACE:** viewport'un içine çift tıklayınca (ya da `MS`, durum çubuğunda PAPER düğmesi) model
  space viewport içinden düzenlenir; aktif viewport mavi çerçeveyle gösterilir, pan/zoom yalnızca onun
  görünümünü değiştirir. Dışarıya çift tıklamak ya da `PS` kağıda döner. Kilitli viewport'ta zoom kağıda uygulanır.
- **Ölçek:** durum çubuğundaki ölçek düğmesi (1:1 … 1:5000, 2:1 …) aktif ya da seçili viewport'un
  ölçeğini ayarlar; MSPACE'te `ZOOM` → `Scale` → `1/50XP` de 1:50 yapar.
- **PAGESETUP:** kağıt boyutu (ISO A4–A0, ANSI A/B, özel), yön ve kenar boşlukları. **PLOT** layout'ta
  sayfayı 1:1 basar.
- **LAYOUT** (LO): New, Copy, Delete, Rename, Set, `?`; `TILEMODE` ve `CTAB` sistem değişkenleri.
- **Dosya:** layout'lar, sekme sırası, sayfa boyutu, paper space nesneleri ve viewport'lar (ölçek,
  kilit, açık/kapalı) DXF/DWG'den okunur ve yazılır. Layout sekmesi açıkken kaydedilen çizim o sekmede açılır.

## Masaüstü uygulaması (Electron)

```bash
npm run electron   # derleyip masaüstü uygulamasını çalıştırır
npm run dist:win   # Windows kurulum paketi: release/CraftCAD Setup <sürüm>.exe
```

Masaüstü sürümünde yerel Aç/Kaydet pencereleri vardır; açılan DWG/DXF Ctrl+S ile aynı dosyaya
kaydedilir. Dosya yolu komut satırından verilebilir (`CraftCAD.exe çizim.dwg`) ve uygulama tek
örnek çalışır. Kaydedilmemiş değişiklik varsa kapatırken sorar.

ODA File Converter kurulum paketleri `vendor/oda/` klasörüne konur (Windows `.msi`, macOS `.dmg`)
ve kurulum paketine eklenir. ODA kurulu değilse Save As penceresinde "Install bundled ODA File
Converter…" düğmesi çıkar. `vendor/` klasörü ODA lisansı nedeniyle git'e eklenmez; paketi
başkalarına dağıtmadan önce ODA lisans koşullarını kontrol edin. Kurulum dosyası imzasız olduğu
için Windows SmartScreen ilk açılışta uyarı gösterebilir.

## DWG kaydetme

DWG, bilgisayardaki bir dönüştürücüyle yazılır. CraftCAD kendi R2000 DXF'ini üretir; yerel sunucu
bunu dönüştürücüye verip seçilen sürümde DWG (2018, 2013, 2010, 2007, 2004, 2000) ya da 2018 DXF
olarak geri alır. Save As penceresinde dosya türü seçilir; QSAVE aynı biçimde kaydeder.

- **ODA File Converter** (ücretsiz, tercih edilen): https://www.opendesign.com/guestfiles/oda_file_converter
  adresinden kurun. `C:\Program Files\ODA\ODAFileConverter*` altında otomatik bulunur; başka bir
  yerdeyse `ODA_FILE_CONVERTER` ortam değişkenine exe yolunu verin.
- **AutoCAD Core Console** (yedek): AutoCAD kuruluysa `accoreconsole.exe` otomatik kullanılır.
  `ACCORECONSOLE` ortam değişkeniyle de belirtilebilir.

Dönüştürücü yalnızca CraftCAD yerel sunucuyla çalışırken kullanılabilir: geliştirmede `npm run dev`,
derlenmiş sürümde `npm run build` ve ardından `npm run serve` (http://localhost:8080). Statik bir
sunucudan açılırsa DWG seçenekleri pasif görünür. Dönüştürücü varsa DWG açma da onunla yapılır;
yoksa tarayıcıdaki LibreDWG kullanılır.

## Bilinen sınırlar

- Viewport'lar dikdörtgen gösterilir (twist ve dikdörtgen olmayan kırpma uygulanmaz); viewport'a özel
  katman dondurma (VPLAYER) ve annotative ölçekleme yok.
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
