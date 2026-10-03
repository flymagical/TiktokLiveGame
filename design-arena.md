# Desain: Mode "Arena Tabrak"

> Desain untuk mode baru, terpisah dari `design-asosiasi.md` (riwayat
> desain mode "Asosiasi Kata" yang sudah selesai dibangun). Dokumen ini
> **desain, bukan implementasi** — tujuannya menyepakati aturan main,
> data, event, dan tampilan dulu sebelum ditulis kodenya.

> **Status:** sudah dibangun (`lib/arenaGame.js`'s logic lives inline in
> `lib/game.js`, plus `public/arena.html`). Beberapa detail di §13 dipakai
> apa adanya saat implementasi, dengan penyederhanaan berikut (kode yang
> benar kalau beda dari sini):
> - **Cooldown terpisah dihapus** — fase lobi ronde berikutnya sudah
>   berfungsi sebagai jeda napas, jadi tidak ada state tambahan setelah
>   reveal.
> - **`suddenDeathAt` dihapus dari config** — cukup `earlyShrinkBelow` yang
>   mempercepat jadwal runtuh tier (satu tier sekaligus, bukan paksa
>   langsung ke Dalam), lebih sederhana dan hasilnya serupa.
> - **Poin dihitung saat reveal, bukan saat tersingkir** — event
>   `arenaEliminated` tidak membawa `pointsAwarded`; status follow dicek
>   sekali untuk semua orang di `arenaReveal`, konsisten dengan mode lain.
> - Seri (0 pemenang) dan time-cap (>1 pemenang, winBonus dibagi rata)
>   sudah diimplementasikan sesuai usulan di §13.

## 1. Konsep & inspirasi

Terinspirasi dari **Bumper Brawl** (ScrollPlay —
`scrollplay.live/playpass/bumper-brawl`): battle royale mobil tabrak-tabrakan
di arena yang lantainya runtuh sedikit demi sedikit, mobil yang masih di
atas lantai di akhir ronde menang. Berikut gameplay aslinya, sebagai
referensi:

- Penonton ikut main lewat **follow** (1 slot gratis) atau **gift** (gift
  apa pun langsung menjatuhkan mobil mereka ke ronde yang sedang berjalan).
- Gift tertentu memicu **power-up** (nitro, bumper berat, mode raksasa,
  shockwave, meteor, dst).
- Mobil yang tersingkir bisa gabung lagi dengan kirim gift lagi, sampai fase
  **sudden death**.
- Arena mengecil terus; mobil terakhir yang masih di atas lantai menang.
- Streamer tidak perlu main — ronde jalan otomatis terus-menerus.

**Tiga adaptasi yang diminta untuk versi kita**, karena penonton live ini
jarang ngirim gift dan kita mau partisipasi setinggi mungkin lewat yang
gratis:

| | Bumper Brawl asli | Arena Tabrak (versi kita) |
|---|---|---|
| Cara ikut main | Follow (gratis, 1 kali) atau gift | **Komentar apa saja yang valid** — gratis, tanpa batas, tanpa perlu follow dulu |
| Kontrol di arena | Otomatis/simulasi server, viewer cuma "masuk" | **Komentar** jadi satu-satunya input kendali (arah & tabrak) — lihat §4 |
| Peran gift | Memicu power-up & jadi tiket ikut/gabung lagi | **Cuma nambah poin** pengirim di papan peringkat ("poin dukungan") — tidak menyentuh arena sama sekali |
| Peran tap (like) | Tidak disebutkan di game asli | **Tidak dipakai sama sekali** di mode ini (beda dari tebak/asosiasi/klu yang pakai tap untuk buka huruf) — supaya kendalinya murni dari komentar, tidak bercampur sinyal |
| Syarat klaim poin | — | Follow (opsional lewat `requireFollowToScore`, sama seperti mode pilihan ganda — bukan gerbang ketat seperti asosiasi) |

Konsekuensinya: sistem `powerUps` yang sudah ada (`fiftyFifty`,
`freezeTimer`, `stealPoint`, `giftGoal`) **tidak dipakai** di mode ini sama
sekali — gift punya jalur sendiri yang lebih sederhana (§6).

## 2. Alur ronde (state machine)

Mode `arena` berjalan sebagai mode kelima di `GameEngine`, sejajar dengan
`pilihan`/`tebak`/`asosiasi`/`klu` — host pindah ke sini dengan `!mode
arena`, dan overlay ikut auto-switch satu Browser Source seperti mode lain.
Tapi *di dalam* mode ini alurnya bukan tanya-jawab per soal, melainkan loop
sendiri:

1. **lobby** (`arena.lobbyDurationSec`, usul 20 detik) — arena kosong,
   banner "Ketik `kiri` / `kanan` / `gas` / `tabrak` buat ikut balapan!"
   tampil dengan hitung mundur. Siapa pun yang komentar salah satu dari 4
   kata kunci itu (atau `1`-`4`, lihat §4) langsung dapat mobil dan masuk
   arena di slot awal acak.
2. **battle** — arena mulai di 3 *tier* (lihat §5), tick setiap
   `arena.tickSec` (usul 4 detik): semua komentar kendali yang masuk sejak
   tick sebelumnya diterapkan sekaligus (bukan satu-satu real-time — biar
   deterministik dan gampang disimulasikan). Penonton baru masih bisa ikut
   kapan saja di fase ini (komentar valid pertama mereka = join + langsung
   jadi gerakan pertamanya).
3. Tier luar runtuh di jadwal tertentu atau kalau sisa pemain sedikit
   (lihat §5) — siapa pun yang masih di tier itu saat runtuh **tersingkir**.
4. Begitu cuma tersisa tier paling dalam (atau sisa pemain ≤ ambang
   `arena.suddenDeathAt`, usul 4), masuk **sudden death**: `tabrak` yang
   kena langsung menyingkirkan, tidak ada tier lagi buat mundur.
5. Ronde selesai kalau tersisa 1 mobil (menang), 0 mobil (semua saling
   menyingkirkan di tick yang sama → seri, lihat §13), atau batas waktu
   keras `arena.maxRoundSec` (usul 180 detik) tercapai dengan >1 mobil
   tersisa → semua yang tersisa dianggap menang bersama.
6. **reveal** (`arena.revealDurationSec`, usul 10 detik) — kartu hasil:
   pemenang + urutan tersingkir + poin yang didapat tiap orang.
7. **cooldown** singkat (usul 5 detik, "Ronde berikutnya sebentar lagi...")
   lalu balik ke langkah 1. Tidak perlu host campur tangan — jalan terus
   selama live, sama seperti filosofi auto-loop Bumper Brawl asli.

Mekanisme lintas-mode yang sudah ada (`!pause`/`!lanjut`, `!testing`,
`!end`, papan peringkat berkala `leaderboardEveryNQuestions`, kartu
sambutan/MVP live sebelumnya) tetap berlaku — `!pause` membekukan tick
timer seperti membekukan timer soal di mode lain.

## 3. Kenapa tidak ada fisika sungguhan

Arena ini **bukan** simulasi fisika real-time (beda dari Bumper Brawl asli
yang jalan di game server ScrollPlay) — biar bisa dibangun dengan stack yang
sama seperti mode lain (Node + Socket.io ngirim state, overlay cuma
me-render). Posisi mobil disederhanakan jadi **slot diskrit** di atas
cincin yang punya beberapa *tier* (lihat §5), dan tick-nya diproses
sekaligus per batch komentar, bukan per-frame. Ini cukup untuk kesan "tabrak
mobil, arena mengecil, yang terakhir menang" tanpa perlu physics engine.

## 4. Ikut & kendali lewat komentar

Satu-satunya input penonton. Dikenali bebas besar-kecil huruf, dan boleh
angka atau kata (konsisten dengan pola "A/1" yang penonton sudah biasa dari
mode pilihan ganda):

| Komentar | Alias angka | Efek |
|---|---|---|
| `kiri` | `1` | Pindah 1 slot berlawanan arah jarum jam di tier yang sama |
| `kanan` | `2` | Pindah 1 slot searah jarum jam di tier yang sama |
| `gas` (atau `maju`) | `3` | Pindah 1 tier ke dalam (lebih aman, menjauh dari tepi) |
| `tabrak` | `4` | Lihat §5 — menyerang siapa pun yang berbagi slot, atau kalau slot kosong dianggap dorongan maju ekstra (sama efeknya seperti `gas`) |

- **Join otomatis**: komentar valid pertama dari penonton yang belum
  punya mobil = mereka langsung masuk arena (slot & tier awal acak di tier
  tengah) **dan** komentar itu langsung dihitung sebagai gerakan pertama
  mereka. Tidak ada kata kunci "join" terpisah — biar sesederhana mungkin.
- **Gabung lagi setelah tersingkir**: boleh, kapan saja selama ronde belum
  masuk sudden death (sama prinsipnya dengan Bumper Brawl asli yang izinkan
  rejoin sampai sudden death — bedanya di sini gratis lewat komentar, bukan
  gift).
- **Satu gerakan per tick per penonton**: kalau seseorang komentar beberapa
  kali sebelum tick berikutnya diproses, cuma komentar **terakhir** yang
  valid yang dipakai (beda dari mode kuis yang "tercepat menang" — di sini
  ini kontrol berkelanjutan, bukan lomba jawab).
- Tidak butuh follow untuk ikut atau mengendalikan mobil — follow cuma
  relevan saat klaim poin di akhir ronde (§6), biar makin banyak yang mau
  coba-coba ikut.
- Arena punya batas (`arena.maxPlayers`, usul 24 — lihat §5). Kalau penuh,
  komentar join dari penonton baru diabaikan; mereka dapat pesan sekali per
  penonton per live ("arena penuh, coba ronde selanjutnya!"), sama gaya
  dengan pesan gerbang follow di mode asosiasi.

## 5. Arena: tier, slot, dan tabrakan

- Arena = cincin dengan **3 tier** konsentris: **Dalam** (paling aman),
  **Tengah**, **Luar** (paling dekat tepi). Tiap tier punya
  `arena.slotsPerTier` slot (usul 8, seperti posisi jam 12-3-6-9 dst) —
  jadi kapasitas maksimum 24 mobil (`3 × 8`), sesuai `arena.maxPlayers`.
- `kiri`/`kanan` memindah slot *di dalam* tier yang sama (orbit). `gas`
  memindah 1 tier ke dalam (Luar→Tengah→Dalam); sudah di Dalam, `gas` tidak
  berefek (sudah paling aman).
- **Tabrak**: kalau ada mobil lain di slot yang sama saat tick diproses,
  penyerang mendorong **semua** mobil lain di slot itu keluar 1 tier
  (Dalam→Tengah→Luar→laut). Kalau slotnya kosong, `tabrak` diperlakukan
  sama seperti `gas` (dorongan maju tanpa target). Dua mobil yang saling
  `tabrak` di tick yang sama (keduanya satu slot) ya saling terdorong
  keluar sekaligus — bisa saja dua-duanya tersingkir bersamaan kalau
  posisinya sudah di Luar. Ini yang bikin endgame seru.
- **Tier runtuh**: dijadwalkan (`arena.shrinkEverySec`, usul 30 detik sejak
  battle mulai) — tier Luar runtuh duluan, lalu Tengah, menyisakan Dalam
  saja. Siapa pun yang masih ada di tier yang runtuh saat itu juga
  **tersingkir**, terlepas dari tabrakan. Tier runtuh **lebih cepat** kalau
  sisa pemain sudah sedikit (`arena.earlyShrinkBelow`, usul 10 pemain
  tersisa → percepat runtuh tier berikutnya) biar ronde yang sepi tidak
  molor.
- **Sudden death**: begitu cuma tier Dalam yang tersisa, tidak ada lagi
  tempat mundur — `tabrak` yang kena = tersingkir seketika (terdorong
  "keluar dari Dalam" berarti langsung jatuh, tidak ada tier di luarnya
  lagi untuk ditempati).
- Tersingkir ditampilkan sebagai mobil yang "jatuh ke laut" + kartu kecil
  nama/foto terbang sebentar (pola tiker yang sama seperti mode
  asosiasi/klu), bukan langsung hilang begitu saja.

## 6. Skor & poin

Dua jalur poin yang **tidak saling tumpang tindih** — keduanya masuk ke
papan peringkat gabungan yang sama (`data/scores.json`), seperti mode lain:

**a) Poin bertahan (dari gameplay arena, lewat komentar)**

- Setiap kali tersingkir (termasuk kalau belum pernah survive satu tier
  pun), penonton dapat `arena.basePoints` (usul 5) + `arena.tierBonus`
  (usul 10) dikali jumlah tier yang berhasil dilewati sebelum tersingkir.
  Contoh: tersingkir pas tier Luar runtuh = 5 + 0 = 5 poin. Tersingkir di
  tier Tengah (sudah lolos dari runtuhnya tier Luar) = 5 + 10 = 15 poin.
  Tersingkir di sudden death (sudah lolos 2 kali) = 5 + 20 = 25 poin.
- **Pemenang** (mobil terakhir yang masih ada) dapat semua poin bertahan
  itu **plus** `arena.winBonus` (usul 50) di atasnya.
- Kalau ronde berakhir karena batas waktu keras dengan >1 mobil tersisa,
  `winBonus` dibagi rata ke semua yang tersisa (dibulatkan ke bawah) —
  dicatat sebagai keputusan desain, bukan harga mati (lihat §13).
- Tunduk ke `requireFollowToScore` yang sudah ada: kalau belum follow saat
  tersingkir/menang, poin ditahan sampai mereka follow (selama ronde itu
  belum masuk fase reveal) — perilaku sama seperti mode pilihan ganda,
  **bukan** gerbang ketat ala asosiasi (supaya penonton baru tetap bisa
  coba-coba main tanpa dipaksa follow dulu).

**b) Poin dukungan (dari gift, sama sekali di luar arena)**

- Selama mode `arena` aktif, gift masuk **tidak** memicu power-up/clue
  seperti mode lain — langsung dikonversi jadi poin lewat
  `arena.pointsPerDiamond` (usul 2): `poin = diamondCount * 2`, ditambahkan
  langsung ke skor pengirim di `data/scores.json`, tidak peduli mereka
  sedang main di arena atau tidak, dan tidak peduli status follow (gift
  sudah jadi sinyal dukungan yang kuat sendiri).
  - Contoh: Rose (1 diamond) → +2 poin. Galaxy (1000 diamond) → +2000 poin.
- Overlay menampilkan toast kecil "terima kasih" ("X mengirim Rose → +2
  poin dukungan!") supaya pengirim tetap terasa diapresiasi walau gift-nya
  tidak mengubah apa pun di arena — ini yang dimaksud "gift cuma buat
  naikin poin", persis seperti yang diminta.
- Tidak perlu `!mvparena` terpisah — karena poinnya masuk papan yang sama,
  `!mvpkuis`/`!peringkat` yang sudah ada otomatis ikut menghitungnya.

## 7. Event realtime (`socket.io`, event `game:state`)

Mengikuti pola *tell, don't reveal* yang sudah ada di mode lain:

```jsonc
// Lobby mulai
{ "type": "arenaLobby", "durationSec": 20 }

// Battle mulai — snapshot semua mobil & tier yang ada
{
  "type": "arenaBattleStart",
  "roundNumber": 7,
  "tiers": 3,
  "slotsPerTier": 8,
  "cars": [
    { "userId": "...", "nickname": "...", "avatar": "...", "tier": 1, "slot": 3 }
  ]
}

// Satu tick selesai diproses — posisi baru + yang baru join tick ini
{
  "type": "arenaTick",
  "cars": [ { "userId": "...", "tier": 1, "slot": 4 } ],
  "joined": [ { "userId": "...", "nickname": "...", "avatar": "...", "tier": 1, "slot": 7 } ],
  "collisions": [ { "attackerId": "...", "targets": ["..."] } ]
}

// Tier runtuh
{ "type": "arenaShrink", "tierRemoved": 3, "eliminated": [ { "userId": "...", "nickname": "..." } ] }

// Sudden death mulai
{ "type": "arenaSuddenDeath" }

// Seseorang tersingkir lewat tabrakan (di luar event shrink)
{ "type": "arenaEliminated", "nickname": "...", "avatar": "...", "pointsAwarded": 15, "cause": "tabrak" | "shrink" }

// Ronde selesai
{
  "type": "arenaReveal",
  "roundNumber": 7,
  "winners": [ { "nickname": "...", "pointsAwarded": 85, "score": 310 } ],
  "order": [ { "nickname": "...", "tiersSurvived": 2, "pointsAwarded": 25 } ],
  "durationSec": 10
}

// Gift masuk saat mode arena aktif (bukan clue/power-up)
{ "type": "arenaGiftPoints", "nickname": "...", "diamonds": 1, "pointsAwarded": 2 }
```

Event yang dipakai ulang tanpa perubahan: `paused`/`resumed`, `leaderboard`,
`mvp`, `welcome`, `mode`, `endCard`, `rank` (`!myrank`). Event `taps` dan
`powerUp` **tidak dikirim** di mode ini (sesuai §1 — tap & gift-power-up
memang tidak dipakai).

## 8. Tampilan (`public/arena.html`)

Overlay baru, 1080×1920, background transparan, auto-switch dengan 4
overlay lain lewat satu Browser Source (§2):

- **Atas**: nomor ronde + jumlah mobil yang masih hidup ("12 tersisa").
- **Tengah**: arena bulat dilihat dari atas, 3 cincin konsentris (Dalam di
  tengah, Luar di pinggir), tiap cincin dibagi 8 slot. Mobil = foto profil
  bulat kecil + nama singkat, diposisikan lewat sudut (slot × 45°) dan jarak
  dari pusat (tier). Cincin yang baru runtuh memudar + animasi "retak/jatuh
  ke laut" sebentar sebelum hilang dari tampilan.
- **Pita bawah arena**: legenda kendali — "`kiri`/`1` `kanan`/`2` `gas`/`3`
  `tabrak`/`4`" — selalu terlihat selama battle, supaya penonton baru yang
  baru nonton tetap tahu caranya ikut tanpa harus scroll ke komentar lama.
- **Saat lobby**: arena kosong + hitung mundur besar + banner "Ketik `kiri`
  / `kanan` / `gas` / `tabrak` buat ikut balapan!".
- **Toast tersingkir**: kartu kecil terbang dari slot posisi terakhir mobil
  itu ke luar layar (reuse gaya tiker asosiasi/klu), aksen merah.
- **Toast dukungan gift**: kartu kecil beda warna (aksen gift/emas) di
  pojok, "+N poin dukungan", terpisah dari toast tersingkir biar tidak
  campur makna.
- **Reveal**: kartu pemenang penuh (foto + nama + total poin ronde ini),
  disusul daftar urutan tersingkir singkat.
- Query demo mengikuti pola yang sudah ada: `arena.html?demo`,
  `?demo=pause`, `?demo=end`.

## 9. Perintah host & endpoint

| Perintah chat (akun host) | Endpoint HTTP | Efek |
|---|---|---|
| `!mode arena` | `GET /mode/arena` | Pindah ke mode ini; ronde lobby berikutnya otomatis mulai |

Perintah lintas-mode yang sudah ada (`!start`, `!welcome`, `!pause`,
`!lanjut`, `!peringkat`, `!testing`, `!end`, `!myrank`, `!mvpkuis`, `!mvp`)
tetap berfungsi sama persis.

## 10. Perubahan `config.json`

```jsonc
{
  "arena": {
    "lobbyDurationSec": 20,
    "tickSec": 4,
    "slotsPerTier": 8,
    "maxPlayers": 24,
    "shrinkEverySec": 30,
    "earlyShrinkBelow": 10,
    "suddenDeathAt": 4,
    "maxRoundSec": 180,
    "revealDurationSec": 10,
    "cooldownSec": 5,
    "basePoints": 5,
    "tierBonus": 10,
    "winBonus": 50,
    "pointsPerDiamond": 2
  }
}
```

`powerUps` yang sudah ada **tidak dipakai** di mode ini (§1) — tidak perlu
field tambahan di sana.

## 11. Struktur file baru

```
lib/
└─ arenaGame.js     # state arena per ronde: slot/tier tiap mobil, parsing
                       komentar kendali, resolusi tabrak & shrink, skor
public/
└─ arena.html         # overlay baru (Browser Source OBS)
```

`lib/game.js` tambah `"arena"` ke `MODES`, method `_arenaTick()` dipanggil
dari interval tick (bukan timer per-soal seperti mode lain), dan cabang
baru di handler komentar/gift untuk rute ke `arenaGame.js`.

## 12. Contoh jalannya satu ronde (ilustrasi, bukan spesifikasi ketat)

1. Lobby 20 detik, 9 penonton komentar `gas`/`kiri`/dst → 9 mobil masuk di
   tier Tengah, slot acak.
2. Battle mulai. Tick #1: beberapa `kanan`/`kiri` menggeser posisi, dua
   orang ketemu di slot yang sama lalu salah satunya komentar `tabrak` →
   korban terdorong ke tier Luar.
3. Detik 30: tier Luar runtuh. 2 mobil yang masih di sana (termasuk korban
   tabrakan barusan) tersingkir, masing-masing dapat 5 poin (belum pernah
   lolos tier mana pun secara efektif → base saja).
4. Battle lanjut di tier Tengah+Dalam saja. Seseorang kirim Rose di tengah
   ini → langsung +2 poin dukungan buat pengirim, arena tidak terpengaruh
   sama sekali.
5. Detik 60: tier Tengah runtuh (dipercepat karena sisa pemain sudah < 10).
   Sisa 3 mobil di tier Dalam → **sudden death**.
6. Tick sudden death: A `tabrak` B di slot yang sama → B tersingkir
   (dapat 5 + 10×2 = 25 poin, sudah lolos 2 runtuh). Tersisa A dan C.
7. Tick berikutnya: C `tabrak` A tapi A sudah pindah slot lewat `kanan` di
   komentar terakhirnya sebelum tick ini → tidak kena siapa-siapa. Round
   terus sampai akhirnya A berhasil `tabrak` C → **A menang**.
8. Reveal: A dapat 5 + 20 (2 tier) + 50 (winBonus) = 75 poin. Urutan
   tersingkir lain ditampilkan dengan poin masing-masing.
9. Cooldown 5 detik → lobby ronde berikutnya mulai lagi otomatis.

## 13. Hal yang masih perlu diputuskan saat implementasi

- **Kalau 0 mobil tersisa di tick yang sama** (dua mobil saling tabrak dan
  keduanya pas di tier terluar yang tersisa) — usul: tidak ada pemenang
  ronde itu, langsung ke reveal "seri, tidak ada yang menang ronde ini"
  dengan poin bertahan tetap dibagikan seperti biasa ke yang tersingkir.
- **Pembagian `winBonus` saat time-cap dengan >1 survivor** — dibagi rata
  (usul di §6) atau masing-masing dapat penuh? Lebih mudah dirasakan lewat
  playtest daripada didebat di atas kertas.
- **Angka pasti** `tickSec`, `slotsPerTier`, `shrinkEverySec`, dan nilai
  poin — semua di §10 adalah usulan awal, wajar dikalibrasi setelah dicoba
  live (terutama `tickSec`: terlalu cepat bikin komentar menumpuk belum
  terbaca, terlalu lambat bikin terasa lelet dibanding chat yang ramai).
- **Mobil yang belum pernah join sampai sudden death** — boleh join di
  sudden death juga (langsung high-risk, tidak ada tier buat mundur), atau
  ditutup total begitu sudden death mulai (lebih mirip Bumper Brawl asli)?
  Usul desain ini: masih dibuka (konsisten dengan "komentar kapan saja =
  ikut"), tapi ini pantas didiskusikan lagi kalau terasa terlalu gampang
  menang dengan join telat.
- **Format nama slot/tier di overlay** (apakah perlu label "Dalam/Tengah/
  Luar" terlihat ke penonton, atau cukup visual cincinnya saja) — keputusan
  visual, lebih mudah diputuskan saat benar-benar melihat tata letaknya.
