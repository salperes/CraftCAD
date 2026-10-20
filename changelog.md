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
