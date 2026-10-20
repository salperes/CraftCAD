---------------------------------------------------------
Rev. ID    : 14
Version    : 0.5.1
Rev. Date  : 20.10.2026
Rev. Time  : 09:12:10
Rev. Prompt: Web tarafını da güncelle

Rev. Report: (
- Client: Sürüm package.json'dan modül olarak okunuyor (vite define yerine); çalışan dev sunucusu sürüm artışını yeniden başlatmadan gösteriyor
- Server: /api/health sürümü her istekte package.json'dan okuyor
- Build: dist/ 0.5.1 ile yeniden derlendi
)
---------------------------------------------------------
Rev. ID    : 13
Version    : 0.5.0
Rev. Date  : 20.10.2026
Rev. Time  : 07:40:26
Rev. Prompt: Layout özelliği de ekle

Rev. Report: (
- Client: Model / Layout sekmeleri — geçiş, çift tıkla yeniden adlandırma, sağ tık menüsü (New, Delete, Rename, Move, Copy, Page Setup, Plot), + ile yeni layout
- Client: Layout görünümü — gri zemin üzerinde beyaz kağıt, yazdırma sınırı; paper space'te bütün çizim ve düzenleme komutları
- Client: Viewport nesnesi — model space'i ölçekli ve kırpılmış gösterir (WebGL scissor ile), grip ile boyutlandırma, STRETCH, özellikler paleti (ölçek, kilit, açık/kapalı)
- Client: MSPACE/PSPACE — viewport içine/dışına çift tıklama, durum çubuğunda MODEL/PAPER düğmesi, aktif viewport mavi çerçeve, kilitli viewport'ta zoom kağıda uygulanır
- Client: Komutlar LAYOUT (LO), MVIEW (MV: köşe, Fit, 2, 4, ON/OFF, Lock), MSPACE (MS), PSPACE (PS), PAGESETUP; ZOOM nXP; TILEMODE ve CTAB sistem değişkenleri
- Client: Durum çubuğunda viewport ölçeği seçici (1:1 … 1:5000, 2:1 …); "Layout" bağlamsal şerit sekmesi; Page Setup penceresi (kağıt boyutu, yön, kenar boşlukları)
- Client: PLOT layout'ta sayfayı 1:1 basıyor; ilk açılan boş layout'a model çizimini gösteren viewport otomatik ekleniyor
- Client: DXF/DWG — LAYOUT nesneleri, paper space nesneleri (*Paper_Space bloklar) ve VIEWPORT okuma/yazma; $TILEMODE ile son açık layout'ta açılma
- Test: Layout gidiş-dönüş birim testleri; AutoCAD Core Console ve ODA DWG 2018 doğrulaması; test/layout.mjs (Playwright)
)
---------------------------------------------------------
Rev. ID    : 12
Version    : 0.4.2
Rev. Date  : 20.10.2026
Rev. Time  : 07:21:45
Rev. Prompt: DWG açılışında antet yazıları bozulmuş (ters/dönük görünüyor)

Rev. Report: (
- Client: Yeni AutoCAD sürümlerinin MTEXT sonuna eklediği "Embedded Object" bölümü (kod 101) artık okunmuyor; bu bölümdeki 11/21 değerleri yazı yönü sanıldığı için yazılar ~170° dönük çıkıyordu
- Test: MTEXT embedded object birim testi
)
---------------------------------------------------------
Rev. ID    : 11
Version    : 0.4.1
Rev. Date  : 20.10.2026
Rev. Time  : 07:14:09
Rev. Prompt: Snap to grid özelliği çalışmıyor

Rev. Report: (
- Client: SNAP (F9) açıkken artı imleç ızgara noktalarına atlıyor; önceden yalnızca tıklanan nokta yuvarlanıyordu
- Client: Grid snap komut yokken ve nesne seçerken de uygulanıyor (seçim kutusu ve pencere köşeleri ızgarada)
- Client: ORTHO ile birlikte grid snap çalışıyor (önceden ORTHO açıkken devre dışıydı)
- Test: test/gridsnap.mjs
)
---------------------------------------------------------
