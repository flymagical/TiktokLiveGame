# Desain: Mode "Asosiasi Kata"

Mode kuis ketiga untuk **Kuis TikTok LIVE**, menyusul mode pilihan ganda
(`overlay.html` / `pilihan`) dan tebak kata (`tebak.html` / `tebak`) yang
sudah ada. Dokumen ini adalah desain, bukan implementasi — tujuannya
menyepakati aturan main, data, event, dan tampilan sebelum ditulis kodenya.

Referensi tata letak: gambar yang dilampirkan (kuis asosiasi kata dari
aplikasi lain, tema "Berhubungan dengan Kopi..." dengan kotak-kotak huruf,
timer, dan ajakan follow). Dipakai sebagai **inspirasi gaya visual**, bukan
spesifikasi persis — jumlah kata, aturan skor, dan detail lain mengikuti
kebutuhan yang dijelaskan di bawah, yang di beberapa hal berbeda dari
gambar tersebut (lihat catatan di tiap bagian).

> **Status:** mode ini sudah selesai dibangun (`lib/asosiasiGame.js`,
> `lib/asosiasi-id.js`, `public/asosiasi.html`) dan didokumentasikan di
> README. Dokumen ini disimpan sebagai riwayat desain, bukan rujukan aktif
> — kalau ada perbedaan dengan kode/README saat ini, kode dan README yang
> benar.

## 1. Konsep

Satu ronde menampilkan satu **tema** ("Berhubungan dengan Kopi...") dan
**6 kata** yang berasosiasi dengan tema itu (mis. Kafe, Live Music, Latte,
Grinder, Mesin, Gayo). Tiap kata tampil sebagai kotak-kotak huruf
tersembunyi (seperti mode tebak), dan penonton mengetik tebakannya di
komentar. Penonton dapat menebak sebanyak mungkin kata dalam satu ronde —
tidak harus urut, dan boleh benar di lebih dari satu dari 6 kata itu.

Perbedaan utama dari mode tebak yang sudah ada:

| | Tebak kata (lama) | Asosiasi kata (baru) |
|---|---|---|
| Jumlah target per ronde | 1 kata | 6 kata sekaligus |
| Siapa dapat poin | Hanya penjawab **tercepat** | **Semua** penjawab benar dapat base point, tercepat per kata dapat bonus |
| Nilai poin | Sama tiap soal (`pointsForFirstCorrect`) | Beda tiap kata (lihat §4) |
| Syarat main | Follow untuk **klaim poin** (boleh follow belakangan sebelum reveal) | Follow untuk **ikut main** — komentar dari yang belum follow tidak diproses sama sekali |
| Huruf awal kata | Selalu tersembunyi | Huruf pertama tiap kata **selalu terlihat** sebagai petunjuk (sesuai gambar referensi) |

## 2. Alur ronde (state machine)

Menumpang state machine `GameEngine` yang sudah ada (`waiting`, `asking`,
`reveal`, `leaderboard`, `paused`, `mvp`, kartu `!end`) — `asosiasi` jadi
mode ketiga di array `MODES`, sejajar dengan `pilihan` dan `tebak`. Semua
mekanisme lintas-mode yang sudah ada (jeda/lanjut, papan peringkat berkala,
gift goal, testing mark, kartu penutup) tetap berlaku tanpa perubahan.

1. **asking** — tema + 6 kata (kotak huruf) tampil, timer
   `asosiasi.roundDurationSec` (usul: 45 detik — lebih lama dari mode lain
   karena ada 6 target, bukan 1) mulai berjalan.
2. Penonton (follower) berkomentar tebakannya. Setiap tebakan yang cocok
   panjang hurufnya dengan salah satu dari 6 kata dianggap "percobaan" dan
   muncul di **tiker jawaban** (lihat §6) — benar atau salah.
3. Setiap `tapsPerClue` tap (default 10, sama seperti mode tebak) atau tiap
   1 gift `clueGift` (default Rose) yang masuk, satu huruf tersembunyi —
   diambil acak dari **gabungan** huruf tersembunyi di keenam kata — jadi
   terbuka. Huruf terakhir tiap kata tidak pernah dibuka otomatis.
4. Saat waktu habis → **reveal**: keenam kata ditampilkan lengkap, poin
   dihitung dan dibagikan (lihat §4), lalu daftar pemenang per kata
   ditampilkan sebentar (`revealDurationSec`, dipakai bersama dari
   config utama).
5. Lanjut ke ronde berikutnya, atau ke papan peringkat kalau ronde ini
   kelipatan `leaderboardEveryNQuestions` (aturan yang sama seperti mode
   lain, dihitung dari `questionNumber` global).
6. Di akhir live, `!mvpasosiasi` menampilkan **Top 6 MVP** (lihat §8).

## 3. Gerbang follow ("harus follow untuk ikut main")

Berbeda dari `requireFollowToScore` yang sudah ada (yang cuma menahan
*poin*-nya, jawabannya tetap tercatat dan bisa diklaim kalau follow sebelum
reveal), mode ini **menahan partisipasinya**:

- Komentar dari penonton yang belum pernah terpantau follow (dicek lewat
  `scoreboard.hasFollowed`, sama sumber datanya dengan mode lain) **tidak
  diproses sama sekali** — tidak dicocokkan ke 6 kata, tidak muncul di
  tiker jawaban, tidak bisa menang.
- Supaya mereka tahu kenapa, tampilkan pesan **sekali per penonton per
  live** (bukan tiap komentar, biar tidak spam): "follow dulu untuk ikut
  main ya!" saat percobaan pertama mereka terdeteksi tapi ditolak.
- Ini konsisten dengan ajakan "Follow to play" di gambar referensi, dan
  sengaja dibuat lebih ketat dari mode lain karena game ini fokus ke
  penonton yang sudah jadi audiens tetap.
- Tap (like) dan gift tetap dihitung untuk buka huruf dari siapa saja
  (sama seperti mode tebak) — gerbang follow hanya untuk *menjawab*.

## 4. Aturan skor

Dua komponen poin per kata, dikonfirmasi lewat diskusi desain:

- **Base point** — nilai tetap, sama untuk keenam kata di satu ronde
  (`asosiasi.basePoints`, usul default `10`). Diberikan ke **setiap**
  follower yang menjawab benar kata itu, seberapa pun urutannya, sekali
  per kata per penonton.
- **Bonus point** — nilai unik per kata (disimpan di bank soal, lihat
  §5), diberikan **hanya** ke penjawab **tercepat** kata itu (follower
  pertama yang benar, urut waktu komentar masuk — sama prinsip "tercepat"
  seperti mode lain). Kata yang lebih susah ditebak (mis. "Gayo") wajar
  diberi bonus lebih besar daripada kata yang jelas (mis. "Kafe") — nilai
  ini yang dimaksud "tiap kata beda skor".
- Total poin penjawab tercepat suatu kata = base + bonus kata itu.
  Penjawab benar berikutnya untuk kata yang sama = base saja.
- Multiplier gift goal (`powerUps.giftGoal`, kalau dipakai) berlaku ke
  **base dan bonus sekaligus** untuk ronde berikutnya — sama seperti
  bagaimana multiplier sudah berlaku ke `pointsForFirstCorrect` di mode
  lain.
- Skor masuk ke leaderboard yang sama (`data/scores.json`) dengan dua mode
  lain — tidak ada papan terpisah untuk mode ini, supaya juara lintas
  format tetap satu.

Contoh: ronde "Berhubungan dengan Kopi" dengan base 10, dan 3 penonton
menjawab benar "Latte" (bonus kata = 15): penjawab pertama dapat
10 + 15 = 25, dua penjawab berikutnya masing-masing dapat 10.

## 5. Bank soal — format data

File baru `lib/asosiasi-id.js`, gaya penulisan konsisten dengan
`lib/questions-id.js` yang sudah ada:

```js
// { tema: teks tema ("Berhubungan dengan ...", tanpa titik akhir),
//   kata: 6 objek { t: kata jawaban, p: bonus point (int) },
//   c: kategori (opsional, buat variasi/rotasi) }
module.exports = [
  {
    tema: "Berhubungan dengan Kopi",
    kata: [
      { t: "Kafe", p: 5 },
      { t: "Latte", p: 10 },
      { t: "Espresso", p: 10 },
      { t: "Grinder", p: 15 },
      { t: "Barista", p: 10 },
      { t: "Gayo", p: 20 }
    ],
    c: "Kuliner"
  },
  // ...
];
```

- `t` disaring lewat aturan yang sama seperti `isGuessable`/`wordKey` di
  `lib/wordGame.js` (huruf/angka/spasi/tanda hubung, ≤ 18 karakter,
  dibandingkan tanpa besar-kecil huruf/aksen/tanda baca) — file
  `asosiasiGame.js` baru memakai ulang fungsi-fungsi itu dari
  `wordGame.js`, tidak menduplikasi.
- `p` (bonus point) dikurasi manual per kata sesuai tingkat kesulitan —
  tidak dihitung otomatis.
- Karena bank ini murni kurasi manual (bukan hasil generate/API), tidak
  perlu `questionRotation.js`/pembagian 3 blok seperti mode lain — cukup
  diacak urutannya tiap kali dipakai ulang, dengan riwayat tema yang baru
  saja tampil disimpan sebentar supaya tidak langsung berulang di live
  yang sama (mis. tidak mengulang tema yang sama dalam 10 ronde
  terakhir). Detail persis boleh menyusul saat implementasi; ini bukan
  kebutuhan keras seperti rotasi 3-blok mode lain karena temanya jauh
  lebih sedikit diulang secara alami (6 kata sekaligus per tema).

## 6. Tiker jawaban (nama + foto profil berjalan)

Elemen baru, belum ada di dua mode lain. Setiap percobaan follower yang
valid (panjang tebakan cocok salah satu dari 6 kata) memicu satu "kartu"
kecil berisi foto profil + nama penonton yang muncul dari salah satu sisi
layar dan berjalan melintas ke sisi lain, lalu hilang:

- **Benar** → aksen hijau + centang.
- **Salah** (panjang cocok tapi isinya bukan kata yang benar) → aksen
  merah + silang. Ini murni umpan balik visual, tidak menyebut jawaban
  yang benar (supaya tidak membocorkan ke penonton lain).
- Arah jalannya kanan-ke-kiri secara default (sesuai instruksi), dengan
  opsi kebalikannya — jadikan variabel CSS/konfigurasi
  (`asosiasi.tickerDirection: "rtl" | "ltr"`) di sisi tampilan, bukan
  logic server; server hanya mengirim event, arah animasi murni di
  `asosiasi.html`.
- Antrean dibatasi (mis. maks 4 kartu berjalan bersamaan, sisanya
  di-drop bukan diantre) supaya saat komentar ramai, animasi tidak
  menumpuk dan lag.
- Percobaan dari penonton yang sama beruntun dalam beberapa detik boleh
  di-debounce (mis. 1 kartu per penonton per 2 detik) supaya orang yang
  spam menebak tidak memenuhi tiker sendirian.

## 7. Event realtime (`socket.io`, event `game:state`)

Menambah beberapa `type` baru ke payload yang sudah dipakai overlay lain,
mengikuti pola *tell, don't reveal* yang sudah ada (mode `tebak` juga
tidak pernah mengirim isi jawaban sebelum reveal):

```jsonc
// Ronde dimulai
{
  "type": "associationQuestion",
  "questionNumber": 42,
  "theme": "Berhubungan dengan Kopi",
  "words": [
    { "letters": [{ "kind": "letter", "ch": "K" }, { "kind": "letter", "ch": null }, ...], "letterCount": 4, "points": 5 },
    // ...6 entri, huruf pertama tiap kata sudah "ch" terisi, sisanya null
  ],
  "durationSec": 45,
  "basePoints": 10,
  "multiplier": 1,
  "goal": null
}

// Huruf baru terbuka (tap atau gift)
{ "type": "associationClue", "source": "taps" | "gift", "nickname": null | "namaPengirim", "wordIndex": 3, "letterIndex": 5, "ch": "R" }

// Percobaan follower (untuk tiker) — dikirim untuk SETIAP percobaan, benar atau salah
{ "type": "associationAttempt", "nickname": "...", "avatar": "...", "correct": true, "wordIndex": 1 }

// Penonton yang belum follow mencoba ikut (sekali per penonton)
{ "type": "followGateBlocked", "nickname": "..." }

// Ronde berakhir
{
  "type": "associationReveal",
  "questionNumber": 42,
  "words": [
    {
      "text": "Kafe",
      "points": 5,
      "winner": { "nickname": "...", "pointsAwarded": 15, "score": 230 } | null,
      "correctCount": 4 // total follower yang benar (termasuk pemenang)
    },
    // ...6 entri
  ],
  "durationSec": 10
}
```

Event yang sudah ada dan dipakai ulang tanpa perubahan bentuk: `taps`
(progress buka huruf — `perClue` tetap dipakai walau sumbernya gabungan
6 kata), `powerUp`, `goal`, `paused`/`resumed`, `leaderboard`, `mvp`
(diperluas, lihat §8), `welcome`, `mode`, `endCard`, `rank` (`!myrank`).

## 8. MVP Top 6

`showMvp("quiz", { count })` di `lib/game.js` diperluas menerima jumlah
kartu (default tetap 3 untuk mode lain lewat `!mvpkuis`/`!mvp`, supaya
tidak mengubah perilaku yang sudah ada). Mode asosiasi memanggilnya
dengan `count: 6` lewat perintah baru:

- Chat host: `!mvpasosiasi`
- HTTP: `GET /mvp-asosiasi`
- Kartu statis untuk screenshot: `asosiasi.html?card=mvp-asosiasi`

Payload `mvp` menambah field `runnersUp` sampai 5 entri (bukan 2) saat
`count` 6; overlay pilihan/tebak yang menerima `runnersUp` lebih dari 2
cukup mengabaikan entri lebih — jadi aman dipakai bersama.

## 9. Tampilan (`public/asosiasi.html`)

Overlay baru, Browser Source terpisah di OBS (1080×1920, sama seperti dua
mode lain), background transparan. Tata letak mengadaptasi gambar
referensi ke 6 kata:

- **Atas**: nomor ronde + timer melingkar (seperti "Round 105" / "60" di
  gambar), tema di dalam gelembung bicara ("Berhubungan dengan Kopi...").
- **Tengah**: grid **2 kolom × 3 baris** (6 kotak kata — bukan 10 seperti
  di gambar referensi, karena kuis ini memakai 6 kata sesuai kebutuhan).
  Tiap kotak: huruf pertama + garis bawah untuk sisa huruf, badge kecil
  di pojok menampilkan bonus poin kata itu (mis. "+15"), dan
  checkmark halus begitu kata itu sudah dijawab benar oleh siapa pun
  (tanpa membuka hurufnya — supaya penonton yang belum jawab tidak
  tinggal menyalin dari yang sudah menang).
- **Pita "Ketik jawabanmu di komentar!"** persis di bawah grid, sama
  seperti gambar referensi.
- **Bawah grid**: legenda gift pembuka huruf (tap ×`tapsPerClue`, gift
  `clueGift`) — pakai pola `getPowerUpLegend()` yang sudah ada, ditambah
  entri "Follow to play" kalau penonton belum follow (terdeteksi dari
  event `followGateBlocked` mereka sendiri; overlay tidak tahu siapa yang
  menonton, jadi ini pesan umum, bukan personal).
- **Tiker jawaban** (§6): strip horizontal di area bawah layar, di atas
  larik hasil/leaderboard mini kalau ada, tidak menutupi grid kata.
- **Reveal**: 6 kotak terbuka penuh bersamaan, tiap kotak yang punya
  pemenang menampilkan nama pemenang + poin di bawahnya sebentar.
- Query param demo mengikuti pola yang sudah ada: `asosiasi.html?demo`,
  `?demo=pause`, `?demo=end`, `?card=mvp-asosiasi`.

## 10. Perintah host & endpoint (konsisten dengan mode lain)

| Perintah chat (dari akun host) | Endpoint HTTP | Efek |
|---|---|---|
| `!mode asosiasi` | `GET /mode/asosiasi` | Pindah ke mode ini mulai ronde berikutnya |
| `!mvpasosiasi` | `GET /mvp-asosiasi` | Kartu Top 6 MVP kuis |

Perintah lintas-mode yang sudah ada (`!start`, `!welcome`, `!pause`,
`!lanjut`, `!peringkat`, `!testing`, `!end`, `!myrank`) tetap berfungsi
sama persis karena berjalan di level `GameEngine`, bukan per-mode.

## 11. Perubahan `config.json`

```jsonc
{
  // ...konfigurasi yang sudah ada tetap sama...
  "asosiasi": {
    "roundDurationSec": 45,
    "tapsPerClue": 10,
    "clueGift": "Rose",
    "basePoints": 10,
    "mvpTopCount": 6,
    "tickerMaxConcurrent": 4,
    "tickerDirection": "rtl"
  }
}
```

`powerUps` yang sudah ada (`fiftyFifty`, `freezeTimer`, `stealPoint`,
`giftGoal`) dipakai bersama lintas mode seperti sekarang — di mode
asosiasi, `fiftyFifty` (default Finger Heart) berperan sama seperti di
mode tebak: membuka 1 huruf acak (dari gabungan 6 kata), bukan
menghapus opsi (karena tidak ada opsi pilihan ganda di mode ini).

## 12. Struktur file baru

```
lib/
├─ asosiasiGame.js     # aturan mode asosiasi: susun 6 kata jadi kotak huruf,
│                        cocokkan tebakan ke salah satu dari 6, kelola pool
│                        huruf tersembunyi gabungan untuk taps/gift
├─ asosiasi-id.js       # bank tema + 6 kata + bonus poin per kata
└─ game.js              # tambah "asosiasi" ke MODES, _askAssociationQuestion,
                          _handleAssociationGuess, showMvp(kind, {count})
public/
└─ asosiasi.html         # overlay baru (Browser Source OBS)
```

`lib/wordGame.js` (khususnya `wordKey`, `isGuessable`) dipakai ulang oleh
`asosiasiGame.js`, tidak diduplikasi.

## 13. Hal yang masih perlu diputuskan saat implementasi

Bagian desain yang sudah cukup jelas untuk mulai membangun, tapi beberapa
detail kecil sebaiknya diputuskan/dicoba langsung saat coding karena lebih
mudah dirasakan lewat uji coba daripada didebat di atas kertas:

- Berapa persis `roundDurationSec` yang pas untuk 6 kata sekaligus (usul
  45 detik, bisa disesuaikan setelah dicoba live).
  - Apakah tema yang sama boleh muncul lagi di live yang sama kalau bank
  soal habis (sekarang mode lain merefill dari awal; wajar dipakai sama
  di sini juga selama tidak balik ke tema yang barusan keluar).
- Apakah kata yang sudah dijawab benar oleh seseorang tetap dapat huruf
  clue dari taps/gift (desain ini bilang "ya", karena huruf tetap
  disembunyikan sampai reveal supaya penonton lain tetap punya alasan
  menjawab) — layak dikonfirmasi lewat playtest, bukan cuma teori.
- Nilai `basePoints` dan rentang wajar bonus per kata (5–20 di contoh)
  sebaiknya dikalibrasi terhadap `pointsForFirstCorrect` mode lain
  (sekarang 20) supaya papan peringkat gabungan tetap terasa adil.
