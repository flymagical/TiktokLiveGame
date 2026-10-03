# Kuis TikTok LIVE

Game trivia real-time untuk TikTok LIVE kamu. Aplikasi ini membaca komentar
penonton, menjalankan satu pertanyaan setiap beberapa detik, memberikan poin
dasar ke **semua** penonton yang menjawab benar plus poin bonus untuk yang
**tercepat**, menampilkan papan peringkat setiap 10 pertanyaan, dan merespons
`!myrank`. Poin hanya bisa didapat kalau penonton sudah follow. Pertanyaan
diambil dari API gratis [Open Trivia DB](https://opentdb.com).

> **Catatan bahasa:** pertanyaan kuis dari Open Trivia DB hanya tersedia
> dalam Bahasa Inggris — API publiknya tidak mendukung bahasa lain. UI
> overlay, pesan di konsol, dan dokumentasi ini sudah dalam Bahasa
> Indonesia, tapi soal-soalnya sendiri tetap berbahasa Inggris kecuali kamu
> ganti sumber pertanyaannya (lihat bagian "Kustomisasi").

## Cara kerjanya

- **`server.js`** terhubung ke chat live TikTok kamu, menjalankan server
  web kecil, dan mengirim update secara real-time ke halaman overlay lewat
  WebSocket.
- **`public/overlay.html`** adalah yang kamu tambahkan ke OBS sebagai
  Browser Source — menampilkan pertanyaan, timer, jawaban, papan
  peringkat, dan notifikasi.
- Ada 5 format kuis (lihat bagian masing-masing di bawah): **pilihan ganda**
  (`overlay.html`, default), **tebak kata** (`tebak.html`), **asosiasi kata**
  (`asosiasi.html`), **klu** (`klu.html`), dan **Arena Tabrak**
  (`arena.html`, mobil tabrak-tabrakan). Ganti kapan saja dengan
  `!mode pilihan` / `!mode tebak` / `!mode asosiasi` / `!mode klu` /
  `!mode arena` di chat host, atau lewat `http://localhost:3000/mode/<nama>`.
  **Satu Browser Source saja sudah cukup**: kelima halaman saling berpindah
  otomatis saat mode berganti, jadi kamu tidak perlu menambahkan banyak
  Browser Source di OBS.
- Saat LIVE baru terhubung, overlay menampilkan **kartu selamat datang** dan
  kuis belum berjalan sampai host mengetik `!start`. Lihat bagian "Mulai
  kuis" di bawah.
- Tidak ada yang resmi dari TikTok: aplikasi ini memakai
  `tiktok-live-connector`, library yang dikelola komunitas dan mengakses
  feed live internal TikTok. Tidak perlu login hanya untuk *membaca* chat.

## Setup

1. Install [Node.js 18+](https://nodejs.org).
2. Di folder ini, jalankan:
   ```
   npm install
   ```
3. Edit **`config.json`**:
   - `tiktokUsername`: username TikTok kamu, tanpa `@` (misalnya `"mystreamname"`).
   - `roundDurationSec`: berapa lama penonton punya waktu menjawab tiap pertanyaan.
   - `revealDurationSec`: berapa lama jawaban benar ditampilkan di layar.
   - `leaderboardEveryNQuestions`: `10` berarti papan peringkat muncul setiap pertanyaan ke-10.
   - `pointsForCorrect`: poin dasar untuk setiap penonton yang jawabannya benar dan sudah follow.
   - `fastestBonus`: poin bonus tambahan untuk penonton **tercepat** yang benar (di atas poin dasar).
   - `requireFollowToScore`: `true` = harus follow dulu untuk dapat poin.
   - `trivia`: langsung diteruskan ke Open Trivia DB (`category`/`difficulty` boleh dikosongkan untuk "semua").
   - `eventDelaySec`: video LIVE TikTok yang dilihat penonton punya buffer beberapa detik, sedangkan komentar/like/gift diterima server ini secara real-time. Isi dengan jeda (detik) yang kamu amati di stream-mu supaya reaksi overlay (jawaban, klu, dsb) baru muncul setelah delay itu — jadi sinkron dengan video yang penonton lihat. `0` = tidak ada jeda tambahan.
4. **Live dulu di TikTok**, baru jalankan game-nya:
   ```
   npm start
   ```
5. Di OBS: **Sources → + → Browser Source** → URL `http://localhost:3000/overlay.html`
   → ukuran **1080×1920** (portrait, sesuai kanvas TikTok LIVE) → matikan
   opsi "Shutdown source when not visible" supaya tetap mendengarkan.
6. Atur posisi/ukuran browser source di kanvas sesuka kamu — background-nya
   transparan, jadi bisa menumpuk di atas kamera.

## Cara penonton bermain

- Menjawab dengan **huruf** (`A`, `B`, `C`, `D`), **angka** (`1`-`4`),
  atau teks jawabannya langsung — semuanya bisa dikenali.
- Setiap penonton yang benar dan sudah follow dapat poin dasar; yang **tercepat** dapat poin bonus tambahan.
- `!myrank` kapan saja akan menampilkan peringkat dan skor penonton itu
  sebagai notifikasi di layar.
- Kalau ada yang jawabannya benar tapi belum follow, overlay menampilkan
  "follow dulu untuk klaim poinmu!" — kalau dia follow sebelum ronde
  berakhir, dia tetap dapat poin (selama belum ada yang menang duluan).

## Mulai kuis: kartu selamat datang

- Begitu LIVE terhubung, overlay menampilkan kartu "selamat datang" dan kuis
  **belum berjalan**. Ketik `!start` di chat live dari akun host (atau buka
  `http://localhost:3000/start`) untuk menurunkan kartu dan menanyakan
  pertanyaan pertama.
- `!start` lagi tidak akan mengulang kalau kuis sudah berjalan. Kalau kuis
  ke-start tidak sengaja, ketik `!welcome` (atau buka
  `http://localhost:3000/welcome`) untuk menghentikan ronde yang sedang
  berjalan tanpa menghitung skor dan menampilkan lagi kartu selamat datang —
  `!start` untuk memulai ulang dari pertanyaan baru.
- Kartu ini juga menampilkan **MVP live sebelumnya** (top skor kuis dan top
  gifter), disimpan per room id TikTok di `data/session.json`. Begitu server
  mendeteksi LIVE baru, live sebelumnya otomatis "ditutup" dan MVP-nya jadi
  target yang harus dikalahkan penonton di live ini. Live yang terlalu sepi
  (di bawah 10 poin kuis, atau di bawah 5 diamond/3 gift untuk top gifter)
  tidak menggantikan MVP sebelumnya — supaya restart cepat untuk `!testing`
  tidak mengubur juara beneran dengan "juara" satu gift receh.
- Kalau Browser Source di OBS reconnect/reload di tengah ronde (atau baru
  dibuka setelah ganti mode), pertanyaan yang sedang aktif langsung
  ditampilkan ulang dengan sisa waktunya, bukan ikut kartu selamat datang.
- Contoh tampilan tanpa live: `overlay.html?demo` sekarang dimulai dari
  kartu selamat datang lalu lanjut otomatis; `overlay.html?demo=welcome`
  menampilkan kartu itu saja.

## Mode Tebak Kata (`tebak.html`)

Format kedua dengan bank soal yang sama: penonton **mengetik jawabannya**
langsung di komentar, dan yang terlihat hanya kotak-kotak huruf kosong,
jadi mereka tahu berapa jumlah hurufnya.

- **Setiap 50 tap** (like) selama soal berjalan, 1 huruf acak terbuka sebagai
  clue. Huruf terakhir tidak pernah dibuka, jawaban lengkap baru muncul saat
  waktu habis.
- Penonton boleh menebak berkali-kali. Aturan lain sama: yang **pertama**
  benar (dan sudah follow) dapat poin, papan peringkat, gift goal, power-up,
  `!peringkat`, `!mvp`, `!pause`, `!end`, `!testing`.
- Besar-kecil huruf, spasi, dan tanda baca tidak berpengaruh
  (`bj habibie` = `B.J. Habibie`).
- Gift **Finger Heart** (50/50 di mode pilihan ganda) di mode ini **membuka
  1 huruf**, sekali per soal.
- Setiap **1 Rose = 1 huruf terbuka** (kirim 3 Rose, 3 huruf terbuka), tanpa
  batas per soal selain huruf terakhir. Rose tetap dihitung untuk gift goal
  (5 Rose → soal berikutnya 2× poin). Ganti gift-nya lewat `"clueGift"`.
- Hanya soal yang jawabannya bisa diketik yang dipakai (586 dari 650 soal);
  soal "Manakah penulisan…" dan jawaban dengan simbol seperti `°` atau `%`
  dilewati.

Cara memainkan:

1. Tidak perlu Browser Source terpisah — Browser Source `overlay.html` yang
   sudah ada di OBS akan pindah sendiri ke `tebak.html` begitu mode diganti
   (lihat bagian "Satu Browser Source saja sudah cukup" di atas).
2. Pilih mode: ketik `!mode tebak` di chat dari akun host (atau buka
   `http://localhost:3000/mode/tebak`). Kalau kuis sedang berjalan, mode
   baru berlaku mulai soal berikutnya. Mode awal saat server dijalankan
   diatur lewat `"mode"` di `config.json`.
3. Atur di `config.json`: `"tebak": { "roundDurationSec": 30, "tapsPerClue": 50, "clueGift": "Rose" }`.

Contoh tampilan tanpa live: `tebak.html?demo`, `tebak.html?demo=pause`,
`tebak.html?demo=end`.

## Mode Asosiasi Kata (`asosiasi.html`)

Format ketiga: satu **tema** ("Berhubungan dengan Kopi") dan **6 kata** yang
berhubungan ditampilkan sekaligus, masing-masing sebagai kotak-kotak huruf
(huruf pertama tiap kata selalu terlihat). Penonton boleh menebak sebanyak
mungkin dari 6 kata itu, bebas urutan.

- **Harus follow untuk ikut main** — beda dari mode lain yang cuma
  menggerbang poin, di sini komentar dari penonton yang belum pernah
  terpantau follow **tidak diproses sama sekali** (tidak dicocokkan, tidak
  bisa menang). Mereka dapat pesan "follow dulu untuk ikut main ya!" sekali
  per penonton per live.
- Tiap kata punya bonus poinnya sendiri, dikurasi manual sesuai kesulitan
  (lihat `lib/asosiasi-id.js`). **Semua** penonton yang follow dan
  menjawab benar dapat poin dasar (`asosiasi.basePoints`); yang
  **tercepat** untuk kata itu dapat tambahan bonus kata tersebut.
- Setiap `tapsPerClue` tap atau 1 `clueGift` (default Rose) membuka 1 huruf
  acak dari gabungan huruf tersembunyi ke-6 kata sekaligus. Huruf terakhir
  tiap kata tidak pernah dibuka otomatis.
- Setiap percobaan jawaban (benar atau salah) memunculkan kartu kecil
  (foto profil + nama) yang berjalan melintasi layar — murni umpan balik
  visual, tidak membocorkan jawaban ke penonton lain.
- `!mvpasosiasi` di chat host (atau `http://localhost:3000/mvp-asosiasi`)
  menampilkan **Top 6** MVP kuis, bukan Top 3 seperti `!mvpkuis`.
- Atur di `config.json`: `"asosiasi": { "roundDurationSec": 45, "tapsPerClue": 10, "clueGift": "Rose", "basePoints": 10, "mvpTopCount": 6 }`.

Cara memainkan: cukup ketik `!mode asosiasi` di chat host — Browser Source
yang sudah ada pindah sendiri ke `asosiasi.html`.

Contoh tampilan tanpa live: `asosiasi.html?demo`, `asosiasi.html?demo=pause`,
`asosiasi.html?demo=end`, `asosiasi.html?card=mvp-asosiasi`.

## Mode Klu (`klu.html`)

Kebalikan dari mode asosiasi, dan memakai **bank soal yang sama persis**
(`lib/asosiasi-id.js`), cuma dibaca terbalik: temanya ("Kopi") jadi **kata
jawaban tersembunyi**, dan 6 kata yang di mode asosiasi harus ditebak
(Kafe, Latte, Espresso, ...) di sini jadi **6 klu pendek** yang dibuka
satu per satu. Penonton mengetik tebakan kata jawabannya langsung di
komentar, bukan menebak tiap klu satu-satu.

- Jawabannya ditampilkan sebagai kotak-kotak huruf kosong, sama seperti
  mode tebak, jadi penonton tahu jumlah hurufnya — tapi hurufnya sendiri
  **tidak pernah** dibuka, cuma klu-nya yang bertambah.
- Klu pertama selalu terlihat sejak ronde mulai. Setiap `tapsPerClue` tap
  atau 1 `clueGift` (default Rose) membuka klu berikutnya secara berurutan,
  sampai keenam klu terbuka (tidak ada yang disembunyikan selamanya, beda
  dari huruf terakhir di mode tebak/asosiasi).
- Poin: **semua** penonton yang benar (dan sudah follow, sesuai
  `requireFollowToScore` — bukan gerbang partisipasi seperti mode
  asosiasi) dapat poin dasar (`klu.basePoints`); yang **tercepat** dapat
  tambahan bonus ronde itu, dihitung otomatis dari rata-rata bonus 6 kata
  terkait di bank asosiasi (tema yang kata-katanya lebih susah ditebak
  dapat bonus lebih besar).
- Tiker nama + foto profil penonton yang mencoba menjawab (benar/salah)
  berjalan melintasi layar, sama seperti mode asosiasi.
- Tidak ada kartu MVP terpisah untuk mode ini — pakai `!mvpkuis` seperti
  mode tebak/pilihan ganda (Top 3).
- Atur di `config.json`: `"klu": { "roundDurationSec": 30, "tapsPerClue": 10, "clueGift": "Rose", "basePoints": 10 }`.

Cara memainkan: cukup ketik `!mode klu` di chat host — Browser Source yang
sudah ada pindah sendiri ke `klu.html`.

Contoh tampilan tanpa live: `klu.html?demo`, `klu.html?demo=pause`,
`klu.html?demo=end`.

## Mode Arena Tabrak (`arena.html`)

Format kelima, beda total dari empat mode kuis di atas: terinspirasi dari
game battle royale mobil tabrak-tabrakan ("Bumper Brawl"), tapi
**satu-satunya alat main penonton adalah komentar** — tidak perlu follow
atau gift untuk ikut, dan gift di mode ini **cuma nambah poin pengirim**,
tidak memengaruhi arena sama sekali (beda dari power-up gift di mode lain —
lihat alasannya di `design-arena.md`).

- **Ikut gratis, lewat komentar**: ketik `kiri`, `kanan`, `gas`, atau
  `tabrak` (atau `1`-`4`) kapan saja selama lobi/ronde berjalan — komentar
  valid pertamamu otomatis memasukkan mobilmu ke arena sekaligus jadi
  gerakan pertamamu. Boleh ikut lagi kalau tersingkir, selama ronde belum
  masuk sudden death.
- **Kendali**: `kiri`/`kanan` menggeser mobil di cincinnya, `gas` maju ke
  tier lebih aman (Luar → Tengah → Dalam), `tabrak` mendorong siapa pun yang
  berbagi posisi denganmu keluar 1 tier (atau langsung ke laut kalau sudah
  di tepi) — kalau tidak ada yang bisa ditabrak, `tabrak` berefek sama
  seperti `gas`. Hanya komentar **terakhir** sebelum setiap "tick"
  (`arena.tickSec`, default 4 detik) yang dipakai.
- **Arena mengecil**: tier Luar runtuh duluan, lalu Tengah (mulai *sudden
  death* — tidak ada lagi tempat mundur), dipercepat kalau sisa pemain
  sudah sedikit (`arena.earlyShrinkBelow`). Mobil terakhir yang masih ada
  menang.
- **Poin**: setiap tersingkir dapat `arena.basePoints` + `arena.tierBonus`
  dikali jumlah tier yang berhasil dilewati; pemenang dapat itu plus
  `arena.winBonus` (dibagi rata kalau ronde berakhir seri karena batas
  waktu `arena.maxRoundSec` dengan beberapa mobil tersisa). Tunduk ke
  `requireFollowToScore` seperti mode pilihan ganda — follow cuma syarat
  klaim poin, bukan syarat ikut main.
- **Gift = poin dukungan saja**: gift apa pun yang masuk selama mode ini
  aktif langsung dikonversi `diamond × arena.pointsPerDiamond` jadi poin
  buat pengirim (toast "terima kasih" muncul di overlay), terlepas dari
  status follow atau sedang ikut arena atau tidak — tidak ada power-up gift
  di mode ini. Tap (like) juga tidak dipakai sama sekali.
- Tidak ada perintah MVP terpisah — poinnya masuk papan peringkat yang
  sama, jadi `!mvpkuis`/`!peringkat` yang sudah ada otomatis ikut
  menghitungnya.
- Atur di `config.json`: `"arena": { "lobbyDurationSec": 20, "tickSec": 4, "slotsPerTier": 8, "maxPlayers": 24, "shrinkEverySec": 30, "earlyShrinkBelow": 10, "maxRoundSec": 180, "basePoints": 5, "tierBonus": 10, "winBonus": 50, "pointsPerDiamond": 2 }`.

Cara memainkan: cukup ketik `!mode arena` di chat host — Browser Source
yang sudah ada pindah sendiri ke `arena.html`.

Contoh tampilan tanpa live: `arena.html?demo`, `arena.html?demo=pause`,
`arena.html?demo=end`.

## Power-up dari gift

Berlaku di mode pilihan ganda/tebak/asosiasi/klu — **tidak berlaku di mode
Arena Tabrak**, yang punya aturan gift sendiri (lihat bagian mode itu).
Diatur di `config.json` → `powerUps`. Nama gift dicocokkan tanpa peduli
huruf besar/kecil; kosongkan `"gift": ""` untuk mematikan satu power-up.
Nama gift yang dikirim TikTok bisa kamu lihat di konsol (`[gift] X mengirim
<nama gift> xN`) — samakan persis dengan itu.

| Power-up | Default | Efek |
|---|---|---|
| `fiftyFifty` | Finger Heart | Menghapus 2 jawaban salah untuk semua penonton. Sekali per soal, hanya saat soal berjalan. |
| `freezeTimer` | Ice Cream Cone | +`addSec` detik (default 5) ke soal yang sedang berjalan, maksimal `maxPerRound` (default 3) per soal. |
| `stealPoint` | Hand Hearts | Pengirim mencuri `points` poin (default 1, dikali jumlah combo) dari juara #1 saat itu. Bisa kapan saja. |
| `giftGoal` | Rose ×5 | Kalau terkumpul `target` gift selama satu soal, soal **berikutnya** bernilai `multiplier`× poin (default 3×). Ada progress bar di overlay. |

- **Soal berbeda setiap live**: bank soal dibagi otomatis menjadi 3 blok.
  Setiap live memakai satu blok secara bergiliran (1 → 2 → 3 → 1 ...), jadi
  soal yang sama baru muncul lagi setelah 3 live. Kalau server di-restart di
  tengah live yang sama, kuis tetap memakai blok itu dan tidak mengulang soal
  yang sudah keluar. Posisi giliran disimpan di `data/question-rotation.json`
  (hapus file ini untuk mulai lagi dari blok 1). Soal baru yang ditambahkan ke
  `lib/questions-id.js` otomatis masuk ke salah satu blok.
- **Papan peringkat ganda**: setiap `leaderboardEveryNQuestions` soal,
  tampil "Top Skor Kuis" dan "Top Gifter" berdampingan. Top Gifter
  dihitung per stream (diurutkan berdasarkan koin) dan disimpan di
  `data/gifters.json`, jadi aman saat server di-restart. Otomatis mulai
  dari nol setelah 6 jam tanpa gift, atau reset manual lewat
  `http://localhost:3000/reset-gifters`.
- **Kartu MVP gifter di akhir stream**: ketik `!mvp` di chat live dari
  akun host, atau buka `http://localhost:3000/mvp` di browser. Kartu
  "terima kasih untuk malam ini" untuk top gifter tampil selama
  `mvpCardDurationSec` detik (kuis dijeda selama itu), siap di-screenshot.
- **Papan peringkat kapan saja**: ketik `!peringkat` di chat live dari akun
  host. Kalau sedang ada soal, papan muncul setelah jawabannya diumumkan
  (soal tidak hilang), lalu kuis berlanjut.
- **Jeda kuis**: ketik `!pause` (atau `!jeda`) di chat live dari akun host
  untuk menghentikan kuis sementara, lalu `!lanjut` (atau `!resume`) untuk
  melanjutkan. Bisa juga lewat `http://localhost:3000/pause` dan
  `http://localhost:3000/lanjut`. Waktu soal berhenti di tempat dan lanjut
  dengan sisa waktunya (minimal 5 detik); jawaban selama jeda tidak dihitung.
- **Tanda live testing**: ketik `!testing` di chat live dari akun host (atau
  buka `http://localhost:3000/testing`) untuk menampilkan tanda
  "*Live bentar aja.. testing perubahan server. Tapi boleh banget join" di
  atas overlay selama live. Ketik `!testing` lagi (atau `!testing off`) untuk
  menyembunyikannya. Tanda ini hilang sendiri kalau server di-restart.
- **Kartu penutup live**: ketik `!end` di chat live dari akun host (atau buka
  `http://localhost:3000/end`) saat akan mengakhiri live. Kartu terima kasih
  untuk tap-tap, share, komentar, dan gift, plus ajakan mendukung creator
  untuk game-game baru, tampil **tanpa batas waktu** dan kuis berhenti di
  belakangnya. Salah kirim? Ketik `!lanjut` untuk menutup kartu dan
  melanjutkan kuis. Contoh tampilannya: `overlay.html?demo=end`.
- **Kartu MVP kuis**: ketik `!mvpkuis` di chat live dari akun host, atau buka
  `http://localhost:3000/mvp-kuis`, untuk menampilkan juara skor kuis
  (beserta #2 dan #3) dengan cara yang sama.
  Tampilkan kedua kartu **sebelum** mengakhiri live — setelah live berakhir, penonton
  sudah tidak bisa melihatnya.
- Buka `overlay.html?demo` untuk melihat semua fitur ini tanpa live (diakhiri
  kartu penutup `!end`).
  `overlay.html?demo=pause` hanya menampilkan contoh kuis yang dijeda lalu
  dilanjutkan.
- **Kartu untuk diposting** (diam, tanpa suara, tidak memengaruhi overlay
  live) — buka selagi server jalan lalu screenshot:
  - `http://localhost:3000/overlay.html?card=mvp` — MVP gifter
  - `http://localhost:3000/overlay.html?card=mvp-kuis` — MVP skor kuis
  - `http://localhost:3000/overlay.html?card=peringkat` — Top Skor Kuis &
    Top Gifter atas-bawah (bingkai 9:16)

## Batasan penting, baca sebelum mengandalkan ini

- **Deteksi follow berbasis sesi, bukan riwayat.** Feed live TikTok cuma
  memberi tahu aplikasi ini saat seseorang follow *selagi terhubung* —
  tidak ada API untuk mengecek "apakah user X sudah follow saya
  sebelumnya". Praktiknya: begitu seseorang *terpantau* follow (di sesi
  ini atau sesi sebelumnya, karena disimpan ke `data/scores.json`), dia
  dianggap follower seterusnya. Follower lama yang belum pernah terpantau
  follow saat bot berjalan mungkin akan salah dapat notifikasi "follow
  dulu" sekali. Tidak ada cara lain untuk mengatasi ini dengan feed
  publik.
- **Ini koneksi tidak resmi hasil reverse-engineering.** TikTok bisa
  mengubah protokol internalnya kapan saja, yang bisa membuat connector
  ini berhenti berfungsi sampai diperbarui oleh pengelolanya. Banyak
  dipakai untuk proyek game/overlay live seperti ini, tapi anggap sebagai
  "usaha terbaik", bukan jaminan uptime.
- **Risiko Terms of Service.** Tools otomatis yang membaca/berinteraksi
  dengan TikTok LIVE bukan sesuatu yang secara resmi disetujui TikTok.
  Kebanyakan streamer yang menjalankan game seperti ini menerima risiko
  itu; kamu yang menentukan apakah nyaman dengan hal ini.
- **Mengirim pesan balik ke chat** (misalnya "@user, kamu menang!")
  butuh session ID yang sudah login, yang secara default belum
  dihubungkan di sini karena butuh cookies TikTok kamu dan risikonya lebih
  besar ke akun. `lib/tiktokClient.js` sudah punya stub `sendChat()` kalau
  kamu mau menambahkannya — cari `sessionId` / `signApiKey` di README
  `tiktok-live-connector`.

## Struktur proyek

```
tiktok-live-quiz/
├─ server.js              # entrypoint: menghubungkan TikTok + game + overlay
├─ config.json             # pengaturan kamu
├─ lib/
│  ├─ tiktokClient.js      # menormalkan event TikTok LIVE
│  ├─ trivia.js             # mengambil/membentuk pertanyaan dari Open Trivia DB
│  ├─ game.js                # alur pertanyaan, skor, gate follow, !myrank, + logic Arena Tabrak (tick/tier/tabrak)
│  ├─ questions-id.js        # bank soal Bahasa Indonesia
│  ├─ questionRotation.js    # membagi bank soal jadi 3 blok, satu blok per live
│  ├─ wordGame.js            # aturan mode tebak kata (huruf, clue, cocokkan jawaban)
│  ├─ asosiasi-id.js         # bank tema + 6 kata terkait (dipakai juga oleh mode klu, dibaca terbalik)
│  ├─ asosiasiGame.js        # aturan mode asosiasi kata (6 kata sekaligus, gerbang follow, tiker)
│  ├─ kluGame.js             # aturan mode klu (kebalikan asosiasi: 1 kata jawaban, 6 klu berurutan)
│  └─ scores.js              # papan peringkat tersimpan (data/scores.json)
└─ public/
   ├─ overlay.html          # overlay pilihan ganda (browser source OBS)
   ├─ tebak.html            # overlay tebak kata (browser source OBS)
   ├─ asosiasi.html         # overlay asosiasi kata (browser source OBS)
   ├─ klu.html              # overlay klu (browser source OBS)
   └─ arena.html            # overlay Arena Tabrak (browser source OBS)
```

## Kustomisasi

- **Ganti gaya visual**: semuanya ada di variabel CSS `:root { ... }` di
  bagian atas `overlay.html`.
- **Sumber pertanyaan lain (misalnya berbahasa Indonesia)**: ganti
  `lib/trivia.js` dengan sumbermu sendiri (file JSON, API lain) selama
  hasilnya berbentuk `{ question, options: [4 string], correctIndex }`.
- **Poin untuk juara 2/3 juga**: kembangkan `_awardWin` di `lib/game.js`.
