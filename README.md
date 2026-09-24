# Kuis TikTok LIVE

Game trivia real-time untuk TikTok LIVE kamu. Aplikasi ini membaca komentar
penonton, menjalankan satu pertanyaan setiap beberapa detik, memberikan poin
ke penonton yang **pertama** menjawab benar, menampilkan papan peringkat
setiap 10 pertanyaan, dan merespons `!myrank`. Poin hanya bisa didapat kalau
penonton sudah follow. Pertanyaan diambil dari API gratis
[Open Trivia DB](https://opentdb.com).

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
   - `pointsForFirstCorrect`: poin untuk penonton pertama yang benar dan sudah follow.
   - `requireFollowToScore`: `true` = harus follow dulu untuk dapat poin.
   - `trivia`: langsung diteruskan ke Open Trivia DB (`category`/`difficulty` boleh dikosongkan untuk "semua").
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
- Penonton pertama yang benar dan sudah follow dapat poin tiap ronde.
- `!myrank` kapan saja akan menampilkan peringkat dan skor penonton itu
  sebagai notifikasi di layar.
- Kalau ada yang jawabannya benar tapi belum follow, overlay menampilkan
  "follow dulu untuk klaim poinmu!" — kalau dia follow sebelum ronde
  berakhir, dia tetap dapat poin (selama belum ada yang menang duluan).

## Power-up dari gift

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
│  ├─ game.js                # alur pertanyaan, skor, gate follow, !myrank
│  ├─ questions-id.js        # bank soal Bahasa Indonesia
│  ├─ questionRotation.js    # membagi bank soal jadi 3 blok, satu blok per live
│  └─ scores.js              # papan peringkat tersimpan (data/scores.json)
└─ public/
   └─ overlay.html          # overlay browser source untuk OBS
```

## Kustomisasi

- **Ganti gaya visual**: semuanya ada di variabel CSS `:root { ... }` di
  bagian atas `overlay.html`.
- **Sumber pertanyaan lain (misalnya berbahasa Indonesia)**: ganti
  `lib/trivia.js` dengan sumbermu sendiri (file JSON, API lain) selama
  hasilnya berbentuk `{ question, options: [4 string], correctIndex }`.
- **Poin untuk juara 2/3 juga**: kembangkan `_awardWin` di `lib/game.js`.
